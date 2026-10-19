import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createSocket } from 'node:dgram';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  MCServerQuery,
  MCQueryError,
  queryStatus,
  queryBasicStatus,
  queryStatusWithLatency,
  measureQueryLatency,
  parseMOTD,
} from '../dist/index.js';
import {
  TEST_HOST,
  assertPortReleased,
  basicPacket,
  bindSocket,
  challengePacket,
  closeSocket,
  fullFields,
  fullPacket,
  mockQueryServer,
} from './helpers/query-server.mjs';

const execFileAsync = promisify(execFile);
const examplePath = fileURLToPath(new URL('../examples/query.mjs', import.meta.url));

// 每个用例另有整体截止时间，防止通信或清理逻辑异常导致测试进程挂起。
function testCase(name, run) {
  test(name, { timeout: 3000 }, run);
}

function expectedBasic(online = 3) {
  return {
    motd: '欢迎来到测试服\n第二行',
    gameType: 'SMP',
    map: '世界',
    players: { online, max: 20 },
    host: { ip: '192.0.2.10', port: 25566 },
  };
}

function expectedFull(online = 3) {
  return {
    ...expectedBasic(online),
    players: { online, max: 20, list: ['Alex', '玩家乙'] },
    gameId: 'MINECRAFT',
    version: '1.21.4',
    software: 'Paper',
    plugins: ['WorldEdit 7.3.10', 'LuckPerms 5.4.150'],
    raw: fullFields({ online }),
  };
}

function hasErrorCode(code) {
  return (error) => {
    assert.ok(error instanceof MCQueryError);
    assert.equal(error.name, 'MCQueryError');
    assert.equal(error.code, code);
    return true;
  };
}

testCase('Full Stat 返回中文 MOTD、玩家、插件和原始扩展字段', async (t) => {
  const { port, requests } = await mockQueryServer(t);
  const result = await new MCServerQuery(TEST_HOST, port, { timeout: 500 }).getStatus();
  assert.deepEqual(result, expectedFull());
  assert.deepEqual(requests.map((request) => request.packets), [[9, 0]]);
  assert.equal(requests[0].kind, 'full');
  await assertPortReleased(requests[0].peer);
});

testCase('Basic Stat 使用基础请求并以小端读取服务端报告的端口', async (t) => {
  const { port, requests } = await mockQueryServer(t);
  const result = await new MCServerQuery(TEST_HOST, port, { timeout: 500 }).getBasicStatus();
  assert.deepEqual(result, expectedBasic());
  assert.equal(requests[0].kind, 'basic');
  await assertPortReleased(requests[0].peer);
});

testCase('负 Challenge 按有符号大端整数回传', async (t) => {
  const { port } = await mockQueryServer(t, { challenge: -123456789 });
  assert.deepEqual(await queryStatus(TEST_HOST, port, { timeout: 500 }), expectedFull());
});

testCase('空玩家列表与空插件字段返回空数组', async (t) => {
  const { port } = await mockQueryServer(t, {
    onStat({ session, send }) {
      send(fullPacket(session, { online: 0, plugins: '', players: [] }));
    },
  });
  const result = await queryStatus(TEST_HOST, port, { timeout: 500 });
  assert.deepEqual(result.players, { online: 0, max: 20, list: [] });
  assert.equal(result.software, '');
  assert.deepEqual(result.plugins, []);
});

testCase('每个 getter 都独立查询，并暴露规范化后的地址和端口', async (t) => {
  const { port, requests } = await mockQueryServer(t, {
    onStat({ request, session, send }) {
      send(fullPacket(session, { online: request.index }));
    },
  });
  const client = new MCServerQuery(TEST_HOST, String(port), { timeout: 500 });
  assert.equal(client.host, TEST_HOST);
  assert.equal(client.port, port);
  assert.equal(requests.length, 0, '构造实例时不会发送数据');
  assert.equal(await client.getVersion(), '1.21.4');
  assert.equal(await client.getOnlinePlayerCount(), 2);
  assert.equal(await client.getOnlinePlayerCount(), 3);
  assert.equal(await client.getMaxPlayerCount(), 20);
  assert.equal(await client.getMOTD(), '欢迎来到测试服\n第二行');
  assert.deepEqual(await client.getPlayerList(), ['Alex', '玩家乙']);
  assert.deepEqual(await client.getPlugins(), ['WorldEdit 7.3.10', 'LuckPerms 5.4.150']);
  assert.equal(await client.getMap(), '世界');
  assert.deepEqual(await client.getStatus(), expectedFull(9));
  assert.equal(requests.length, 9);
  assert.ok(requests.every((request) => request.kind === 'full'));
  for (const request of requests) await assertPortReleased(request.peer);
});

testCase('同一个实例支持并发调用，每个查询都有自己的 UDP socket', async (t) => {
  const { port, requests } = await mockQueryServer(t, {
    onChallenge({ later, reply }) {
      later(reply, 20);
    },
    onStat({ request, session, send, later }) {
      later(() => send(fullPacket(session, { online: request.index })), 20);
    },
  });
  const client = new MCServerQuery(TEST_HOST, port, { timeout: 500 });
  const results = await Promise.all(Array.from({ length: 8 }, () => client.getStatus()));
  assert.deepEqual(results.map((result) => result.players.online).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(requests.map((request) => request.peer.port)).size, 8);
  assert.ok(requests.every((request) => request.packets.join(',') === '9,0'));
});

testCase('延迟只统计 Stat 往返，不包含 Challenge 等待时间', async (t) => {
  const { port } = await mockQueryServer(t, {
    onChallenge({ later, reply }) {
      later(reply, 120);
    },
    onStat({ later, reply }) {
      later(reply, 30);
    },
  });
  const start = performance.now();
  const result = await new MCServerQuery(TEST_HOST, port, { timeout: 600 }).getStatusWithLatency();
  const elapsed = performance.now() - start;
  const { latency, ...status } = result;
  assert.deepEqual(status, expectedFull());
  assert.ok(Number.isFinite(latency) && latency >= 20, `Stat 延迟为 ${latency} ms`);
  assert.ok(elapsed - latency >= 90, 'Challenge 的 120 ms 等待没有计入 Stat 延迟');
});

testCase('函数 API 和实例 measureLatency 返回状态或毫秒延迟', async (t) => {
  const { port, requests } = await mockQueryServer(t);
  const options = { timeout: 500 };
  assert.deepEqual(await queryStatus(TEST_HOST, port, options), expectedFull());
  assert.deepEqual(await queryBasicStatus(TEST_HOST, port, options), expectedBasic());
  const { latency, ...status } = await queryStatusWithLatency(TEST_HOST, port, options);
  assert.deepEqual(status, expectedFull());
  assert.ok(Number.isFinite(latency) && latency >= 0);
  const measured = [
    await measureQueryLatency(TEST_HOST, port, options),
    await new MCServerQuery(TEST_HOST, port, options).measureLatency(),
  ];
  assert.ok(measured.every((value) => Number.isFinite(value) && value >= 0));
  assert.equal(requests.length, 5, '每次函数或方法调用执行一轮新查询');
  assert.ok(requests.every((request) => request.packets.join(',') === '9,0'));
});

testCase('错误 session 与 Stat 阶段重复的 Challenge 包被忽略', async (t) => {
  const { port, requests } = await mockQueryServer(t, {
    onChallenge({ session, send, later, reply }) {
      const otherSession = Buffer.from(session);
      otherSession[0] ^= 0x80;
      send(challengePacket(otherSession));
      later(reply, 5);
    },
    onStat({ session, send, later, reply }) {
      const otherSession = Buffer.from(session);
      otherSession[0] ^= 0x80;
      send(challengePacket(session));
      send(fullPacket(otherSession));
      later(reply, 5);
    },
  });
  assert.deepEqual(await queryStatus(TEST_HOST, port, { timeout: 500 }), expectedFull());
  assert.deepEqual(requests[0].packets, [9, 0], '忽略无关数据包时不会自动重试');
});

testCase('已连接的 UDP socket 忽略其他来源伪造的响应', async (t) => {
  const rogue = createSocket('udp4');
  await bindSocket(rogue, TEST_HOST);
  t.after(() => closeSocket(rogue));
  const { port } = await mockQueryServer(t, {
    onChallenge({ session, peer, later, reply }) {
      rogue.send(challengePacket(session, 'not-a-number'), peer.port, peer.address);
      later(reply, 15);
    },
  });
  assert.deepEqual(await queryStatus(TEST_HOST, port, { timeout: 500 }), expectedFull());
});

for (const phase of ['challenge', 'stat']) {
  testCase(`${phase} 阶段超时抛出 TIMEOUT，释放 socket 且不重试`, async (t) => {
    const behavior = phase === 'challenge' ? { onChallenge() {} } : { onStat() {} };
    const { port, requests } = await mockQueryServer(t, behavior);
    await assert.rejects(queryStatus(TEST_HOST, port, { timeout: 70 }), hasErrorCode('TIMEOUT'));
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].packets, phase === 'challenge' ? [9] : [9, 0]);
    await assertPortReleased(requests[0].peer);
  });
}

testCase('timeout 使用整次请求的共同截止时间，不在 Challenge 后重置', async (t) => {
  const { port, requests } = await mockQueryServer(t, {
    onChallenge({ later, reply }) {
      later(reply, 75);
    },
    onStat({ later, reply }) {
      later(reply, 75);
    },
  });
  await assert.rejects(queryStatus(TEST_HOST, port, { timeout: 120 }), hasErrorCode('TIMEOUT'));
  assert.deepEqual(requests[0].packets, [9, 0]);
  await assertPortReleased(requests[0].peer);
});

const malformedChallenges = [
  ['非十进制 Challenge', (session) => challengePacket(session, '123abc')],
  ['超出 int32 范围的 Challenge', (session) => challengePacket(session, 2147483648)],
  ['缺少终止符的 Challenge', (session) => challengePacket(session).subarray(0, -1)],
  ['带多余字节的 Challenge', (session) => Buffer.concat([challengePacket(session), Buffer.from([1])])],
];

for (const [label, makePacket] of malformedChallenges) {
  testCase(`${label} 抛出 PROTOCOL_ERROR 并释放 socket`, async (t) => {
    const { port, requests } = await mockQueryServer(t, {
      onChallenge({ session, send }) {
        send(makePacket(session));
      },
    });
    await assert.rejects(queryStatus(TEST_HOST, port, { timeout: 500 }), hasErrorCode('PROTOCOL_ERROR'));
    assert.deepEqual(requests[0].packets, [9]);
    await assertPortReleased(requests[0].peer);
  });
}

const malformedStats = [
  ['仅有响应头', (session) => Buffer.concat([Buffer.from([0]), session])],
  ['截断的 Full Stat', (session) => fullPacket(session).subarray(0, -1)],
  ['错误的 Full Stat 分隔标记', (session) => {
    const packet = fullPacket(session);
    packet[5] = 0x78;
    return packet;
  }],
  ['负的玩家数量', (session) => fullPacket(session, { fields: { ...fullFields(), numplayers: '-1' } })],
  ['非整数玩家数量', (session) => fullPacket(session, { fields: { ...fullFields(), numplayers: '1.5' } })],
  ['非法服务端端口', (session) => fullPacket(session, { fields: { ...fullFields(), hostport: '65536' } })],
];

for (const [label, makePacket] of malformedStats) {
  testCase(`${label} 抛出 PROTOCOL_ERROR 并释放 socket`, async (t) => {
    const { port, requests } = await mockQueryServer(t, {
      onStat({ session, send }) {
        send(makePacket(session));
      },
    });
    await assert.rejects(queryStatus(TEST_HOST, port, { timeout: 500 }), hasErrorCode('PROTOCOL_ERROR'));
    assert.deepEqual(requests[0].packets, [9, 0]);
    await assertPortReleased(requests[0].peer);
  });
}

testCase('Basic Stat 缺少 hostip 终止符时抛出 PROTOCOL_ERROR', async (t) => {
  const { port } = await mockQueryServer(t, {
    onStat({ session, send }) {
      send(basicPacket(session).subarray(0, -1));
    },
  });
  await assert.rejects(queryBasicStatus(TEST_HOST, port, { timeout: 500 }), hasErrorCode('PROTOCOL_ERROR'));
});

testCase('localhost 域名通过 DNS 解析并访问 UDP 服务器', async (t) => {
  // 与客户端使用同一个系统 DNS 策略，避免假定 localhost 固定优先 IPv4。
  const { lookup } = await import('node:dns/promises');
  const address = await lookup('localhost');
  const family = address.family === 6 ? 'udp6' : 'udp4';
  const { port } = await mockQueryServer(t, { family, host: address.address });
  assert.deepEqual(await queryStatus('localhost', port, { timeout: 500 }), expectedFull());
});

testCase('支持未加方括号的 IPv6 地址', async (t) => {
  let server;
  try {
    server = await mockQueryServer(t, { family: 'udp6', host: '::1' });
  } catch (error) {
    if (error.code !== 'EAFNOSUPPORT' && error.code !== 'EADDRNOTAVAIL') throw error;
    t.skip('运行环境未启用 IPv6 回环地址');
    return;
  }
  assert.deepEqual(await queryStatus('::1', server.port, { timeout: 500 }), expectedFull());
  await assertPortReleased(server.requests[0].peer, 'udp6');
});

testCase('DNS 解析失败时返回 NETWORK_ERROR，并保留解析器错误', async (t) => {
  // 控制系统解析器结果，避免测试依赖外部 DNS、网络连接或缓存状态。
  const cause = Object.assign(new Error('测试域名不存在'), { code: 'ENOTFOUND' });
  const lookup = t.mock.method(dns, 'lookup', async (host) => {
    assert.equal(host, 'query-mc-test.invalid');
    throw cause;
  });
  syncBuiltinESMExports();
  t.after(() => {
    lookup.mock.restore();
    syncBuiltinESMExports();
  });

  await assert.rejects(queryStatus('query-mc-test.invalid', 25565, { timeout: 500 }), (error) => {
    assert.ok(error instanceof MCQueryError);
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.cause, cause);
    return true;
  });
  assert.equal(lookup.mock.callCount(), 1);
});

testCase('DNS 等待也计入 timeout，迟到的解析结果不会再发送 UDP', async (t) => {
  const { port, requests } = await mockQueryServer(t);
  let finishLookup;
  const lookupFinished = new Promise((resolve) => { finishLookup = resolve; });
  const lookup = t.mock.method(dns, 'lookup', async (host) => {
    assert.equal(host, 'slow-query-mc-test.invalid');
    await new Promise((resolve) => setTimeout(resolve, 70));
    finishLookup();
    return { address: TEST_HOST, family: 4 };
  });
  syncBuiltinESMExports();
  t.after(() => {
    lookup.mock.restore();
    syncBuiltinESMExports();
  });

  await assert.rejects(queryStatus('slow-query-mc-test.invalid', port, { timeout: 15 }), hasErrorCode('TIMEOUT'));
  await lookupFinished;
  // 留出一个网络事件周期，确保迟到解析不会悄悄创建 socket 并发送握手。
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(lookup.mock.callCount(), 1);
  assert.equal(requests.length, 0);
});

testCase('命令行示例读取传入地址并输出查询结果', async (t) => {
  const { port, requests } = await mockQueryServer(t);
  const { stdout, stderr } = await execFileAsync(process.execPath, [examplePath, TEST_HOST, String(port)], { timeout: 1500 });
  assert.equal(stderr, '');
  assert.match(stdout, new RegExp(`${TEST_HOST}:${port} \\(UDP\\)`));
  assert.match(stdout, /1\.21\.4/);
  assert.match(stdout, /WorldEdit 7\.3\.10/);
  assert.match(stdout, /欢迎来到测试服\n第二行/);
  assert.deepEqual(requests[0].packets, [9, 0]);
});

testCase('命令行示例遇到协议错误时输出原因并以退出码 1 结束', async (t) => {
  const { port } = await mockQueryServer(t, {
    onChallenge({ session, send }) {
      send(challengePacket(session, 'invalid'));
    },
  });
  await assert.rejects(
    execFileAsync(process.execPath, [examplePath, TEST_HOST, String(port)], { timeout: 1500 }),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /PROTOCOL_ERROR/);
      return true;
    },
  );
});

testCase('构造函数同步验证地址、端口、超时及配置对象', async () => {
  assert.equal(new MCServerQuery('localhost').port, 25565);
  assert.equal(new MCServerQuery('localhost', '25565').port, 25565);
  for (const host of ['', 'local host', 'localhost\0', 'https://localhost', 'localhost:25565', '[::1]', 'a'.repeat(256), null, 123]) {
    assert.throws(() => new MCServerQuery(host), /host/i);
  }
  for (const port of ['', '25565abc', ' 25565', '1.5', '0x63', 0, -1, 65536, NaN, Infinity, 1.5, {}, true]) {
    assert.throws(() => new MCServerQuery('localhost', port), /port/i);
  }
  for (const timeout of [0, -1, 1.5, NaN, Infinity, '100', 2147483648]) {
    assert.throws(() => new MCServerQuery('localhost', 25565, { timeout }), /timeout/i);
  }
  for (const options of [null, [], 123, 'options']) {
    assert.throws(() => new MCServerQuery('localhost', 25565, options), /options/i);
  }
});

testCase('函数 API 以 Promise rejection 报告无效参数', async () => {
  for (const query of [queryStatus, queryBasicStatus, queryStatusWithLatency, measureQueryLatency]) {
    let promise;
    assert.doesNotThrow(() => { promise = query('localhost', 'invalid'); });
    await assert.rejects(promise, /port/i);
  }
});

testCase('MCQueryError 暴露稳定的错误名称、代码和底层 cause', () => {
  const cause = new Error('底层网络错误');
  const error = new MCQueryError('NETWORK_ERROR', '查询失败', { cause });
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'MCQueryError');
  assert.equal(error.code, 'NETWORK_ERROR');
  assert.equal(error.message, '查询失败');
  assert.equal(error.cause, cause);
});

testCase('parseMOTD 去除标准颜色、样式与十六进制格式并保留中文换行', () => {
  assert.equal(parseMOTD('§a欢迎§l来到§r服务器\n§x§1§2§3§4§5§6彩色文字'), '欢迎来到服务器\n彩色文字');
  assert.equal(parseMOTD('普通文字'), '普通文字');
  assert.equal(parseMOTD(''), '');
});
