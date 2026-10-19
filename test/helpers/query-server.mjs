import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';

export const TEST_HOST = '127.0.0.1';
export const TEST_CHALLENGE = 123456789;

// 测试独立拼接协议字节，不复用库内的编码、解码函数。
export function challengePacket(session, challenge = TEST_CHALLENGE) {
  return Buffer.concat([Buffer.from([9]), session, Buffer.from(`${challenge}\0`)]);
}

export function basicPacket(session, { online = 3 } = {}) {
  const port = Buffer.alloc(2);
  port.writeUInt16LE(25566);
  const fields = ['§a欢迎来到§l测试服\n§r第二行', 'SMP', '世界', String(online), '20'];
  return Buffer.concat([
    Buffer.from([0]),
    session,
    Buffer.from(`${fields.join('\0')}\0`),
    port,
    Buffer.from('192.0.2.10\0'),
  ]);
}

export function fullFields({ online = 3, plugins = 'Paper: WorldEdit 7.3.10; LuckPerms 5.4.150' } = {}) {
  return {
    hostname: '§a欢迎来到§l测试服\n§r第二行',
    gametype: 'SMP',
    game_id: 'MINECRAFT',
    version: '1.21.4',
    plugins,
    map: '世界',
    numplayers: String(online),
    maxplayers: '20',
    hostport: '25566',
    hostip: '192.0.2.10',
    custom_key: '扩展值',
  };
}

export function fullPacket(session, options = {}) {
  const fields = options.fields ?? fullFields(options);
  const players = options.players ?? ['Alex', '玩家乙'];
  const entries = Object.entries(fields).flat();
  return Buffer.concat([
    Buffer.from([0]),
    session,
    Buffer.from('splitnum\0', 'ascii'),
    Buffer.from([0x80, 0]),
    Buffer.from(`${entries.join('\0')}\0\0`),
    Buffer.from('\x01player_\0\0', 'ascii'),
    Buffer.from(`${players.join('\0')}\0`),
    players.length === 0 ? Buffer.alloc(0) : Buffer.from([0]),
  ]);
}

export async function bindSocket(socket, host) {
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, host, () => {
      socket.removeListener('error', reject);
      resolve();
    });
  });
}

export async function closeSocket(socket) {
  try {
    await new Promise((resolve) => socket.close(resolve));
  } catch (error) {
    if (error.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') throw error;
  }
}

// 重绑客户端刚使用的端口，验证成功、超时和解析失败后都已关闭 socket。
export async function assertPortReleased(peer, family = 'udp4') {
  assert.ok(peer, '服务器已记录客户端端口');
  const probe = createSocket(family);
  try {
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.bind(peer.port, peer.address, resolve);
    });
  } finally {
    await closeSocket(probe);
  }
}

export async function mockQueryServer(t, options = {}) {
  const family = options.family ?? 'udp4';
  const host = options.host ?? TEST_HOST;
  const challenge = options.challenge ?? TEST_CHALLENGE;
  const socket = createSocket(family);
  const failures = [];
  const requests = [];
  const peers = new Map();
  const timers = new Set();
  let closed = false;

  function later(callback, delay) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!closed) callback();
    }, delay);
    timers.add(timer);
  }

  function send(data, peer) {
    if (closed) return;
    socket.send(data, peer.port, peer.address, (error) => {
      if (error) failures.push(error);
    });
  }

  function beginChallenge(bytes, peer, session) {
    assert.equal(bytes.length, 7, 'Challenge 请求只有魔数、类型和 session');
    const request = { index: requests.length + 1, session, peer, packets: [9] };
    requests.push(request);
    peers.set(`${peer.address}:${peer.port}`, request);
    const reply = () => send(challengePacket(session, challenge), peer);
    const context = { request, session, peer, send: (data) => send(data, peer), later, reply };
    if (options.onChallenge) {
      options.onChallenge(context);
      return;
    }
    reply();
  }

  function receiveStat(bytes, peer, session) {
    const request = peers.get(`${peer.address}:${peer.port}`);
    assert.ok(request, 'Stat 复用发起 Challenge 的同一个 UDP socket');
    assert.deepEqual(session, request.session, '两阶段使用相同的 session');
    assert.deepEqual(request.packets, [9], '每次查询只发送一次 Challenge 和 Stat');
    assert.ok(bytes.length === 11 || bytes.length === 15, 'Stat 使用 Basic 或 Full 的标准长度');
    assert.equal(bytes.readInt32BE(7), challenge, 'Challenge 按有符号大端 int32 编码');
    request.packets.push(0);
    request.kind = bytes.length === 15 ? 'full' : 'basic';
    if (request.kind === 'full') {
      assert.deepEqual(bytes.subarray(11), Buffer.alloc(4), 'Full Stat 以四字节零填充结尾');
    }
    const reply = () => {
      const response = request.kind === 'full' ? fullPacket(session) : basicPacket(session);
      send(response, peer);
    };
    const context = { request, session, peer, send: (data) => send(data, peer), later, reply };
    if (options.onStat) {
      options.onStat(context);
      return;
    }
    reply();
  }

  socket.on('error', (error) => failures.push(error));
  socket.on('message', (bytes, peer) => {
    try {
      assert.ok(bytes.length >= 7, '请求包含完整头部');
      assert.deepEqual(bytes.subarray(0, 2), Buffer.from([0xfe, 0xfd]), '请求以 FE FD 开头');
      const session = Buffer.from(bytes.subarray(3, 7));
      assert.ok([...session].every((byte) => byte <= 15), 'session 每个字节只使用低四位');
      if (bytes[2] === 9) {
        beginChallenge(bytes, peer, session);
        return;
      }
      assert.equal(bytes[2], 0, '状态请求类型为 0');
      receiveStat(bytes, peer, session);
    } catch (error) {
      failures.push(error);
    }
  });

  await bindSocket(socket, host);
  t.after(async () => {
    closed = true;
    for (const timer of timers) clearTimeout(timer);
    await closeSocket(socket);
    assert.deepEqual(failures, [], '假服务器收到的客户端请求符合协议');
  });
  return { host, port: socket.address().port, requests };
}
