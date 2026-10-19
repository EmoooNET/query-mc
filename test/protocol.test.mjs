import assert from 'node:assert/strict';
import test from 'node:test';
import { MCQueryError } from '../dist/errors.js';
import { parseMOTD } from '../dist/motd.js';
import {
  createHandshake,
  createStatRequest,
  decodeResponse,
  decodeChallenge,
  decodeBasicStat,
  decodeFullStat,
} from '../dist/protocol/packets.js';

const sessionId = 0x01020304;
const standardProperties = {
  hostname: '§a中文服务器\n第二行',
  gametype: 'SMP',
  game_id: 'MINECRAFT',
  version: '1.21.5',
  plugins: 'Paper on 1.21.5: Example 1.0; Other 2.0',
  map: '世界',
  numplayers: '2',
  maxplayers: '20',
  hostport: '25565',
  hostip: '127.0.0.1',
};

function strings(...values) {
  return Buffer.from(`${values.join('\0')}\0`);
}

function fullPayload(properties = Object.entries(standardProperties), players = ['Alex', 'Steve']) {
  return Buffer.concat([
    Buffer.from('splitnum\0\x80\0', 'latin1'),
    strings(...properties.flat()),
    Buffer.from('\0\x01player_\0\0', 'latin1'),
    ...players.map((name) => strings(name)),
    Buffer.from([0]),
  ]);
}

function expectProtocolError(callback) {
  assert.throws(callback, (error) => error instanceof MCQueryError && error.code === 'PROTOCOL_ERROR');
}

test('请求包使用固定 magic、big endian session/challenge 和 Full Stat padding', () => {
  assert.equal(createHandshake(sessionId).toString('hex'), 'fefd0901020304');
  assert.equal(createStatRequest(sessionId, 9513307, false).toString('hex'), 'fefd00010203040091295b');
  assert.equal(createStatRequest(sessionId, -1, true).toString('hex'), 'fefd0001020304ffffffff00000000');
});

test('响应头无 magic，并忽略不属于当前 session 的数据', () => {
  const response = Buffer.from('090102030431323300', 'hex');
  assert.deepEqual(decodeResponse(response, sessionId), { type: 9, payload: strings('123') });
  assert.equal(decodeResponse(response, 0), undefined);
  assert.equal(decodeResponse(Buffer.from('ff00000000', 'hex'), sessionId), undefined);
  expectProtocolError(() => decodeResponse(Buffer.from('ff01020304', 'hex'), sessionId));
  expectProtocolError(() => decodeResponse(Buffer.alloc(4), sessionId));
});

test('challenge 严格读取有符号 int32 字符串', () => {
  for (const token of ['0', '9513307', '-2147483648', '2147483647']) {
    assert.equal(decodeChallenge(strings(token)), Number(token));
  }
  for (const token of ['', '123abc', '1.5', ' 1', '+1', '2147483648', '-2147483649']) {
    expectProtocolError(() => decodeChallenge(strings(token)));
  }
  expectProtocolError(() => decodeChallenge(Buffer.from('123')));
  expectProtocolError(() => decodeChallenge(strings('123', 'extra')));
});

test('Basic Stat 按字段读取 UTF-8；hostport 使用 little endian 且允许零字节', () => {
  const port = Buffer.alloc(2);
  port.writeUInt16LE(256);
  const payload = Buffer.concat([strings('§b中文\nMOTD', 'SMP', '世界', '2', '20'), port, strings('0.0.0.0')]);
  assert.deepEqual(decodeBasicStat(payload), {
    motd: '中文\nMOTD', gameType: 'SMP', map: '世界',
    players: { online: 2, max: 20 }, host: { ip: '0.0.0.0', port: 256 },
  });
});

test('Basic Stat 拒绝缺字段、截断 port、无效整数和多余数据', () => {
  expectProtocolError(() => decodeBasicStat(strings('MOTD', 'SMP')));
  expectProtocolError(() => decodeBasicStat(Buffer.concat([strings('MOTD', 'SMP', 'world', '2', '20'), Buffer.from([1])])));
  expectProtocolError(() => decodeBasicStat(strings('MOTD', 'SMP', 'world', '2x', '20')));
  expectProtocolError(() => decodeBasicStat(strings('MOTD', 'SMP', 'world', '9007199254740992', '20')));
  expectProtocolError(() => decodeBasicStat(Buffer.concat([strings('MOTD', 'SMP', 'world', '2', '20'), Buffer.alloc(2), strings('ip'), Buffer.from([1])])));
});

test('Full Stat 按键名解析，无需依赖字段顺序，保留原始 MOTD 和扩展', () => {
  const properties = [...Object.entries(standardProperties).reverse(), ['custom', 'value']];
  const result = decodeFullStat(fullPayload(properties));
  assert.deepEqual(result, {
    motd: '中文服务器\n第二行', gameType: 'SMP', map: '世界',
    players: { online: 2, max: 20, list: ['Alex', 'Steve'] },
    host: { ip: '127.0.0.1', port: 25565 }, gameId: 'MINECRAFT', version: '1.21.5',
    software: 'Paper on 1.21.5', plugins: ['Example 1.0', 'Other 2.0'],
    raw: { ...standardProperties, custom: 'value' },
  });
});

test('Full Stat 空玩家名单合法，在线人数和名单长度相互独立', () => {
  const payload = fullPayload(Object.entries(standardProperties), []);
  assert.deepEqual(decodeFullStat(payload).players, { online: 2, max: 20, list: [] });
});

test('Full Stat 区分空 plugins、只有软件名和分号插件列表', () => {
  for (const [value, name, plugins] of [
    ['', '', []],
    ['Vanilla', 'Vanilla', []],
    ['Paper: One; ; Two;', 'Paper', ['One', 'Two']],
  ]) {
    const fields = { ...standardProperties, plugins: value };
    const result = decodeFullStat(fullPayload(Object.entries(fields)));
    assert.equal(result.software, name);
    assert.deepEqual(result.plugins, plugins);
  }
});

test('Full Stat raw 安全保留特殊属性名', () => {
  const properties = [...Object.entries(standardProperties), ['__proto__', 'extension'], ['constructor', 'custom']];
  const raw = decodeFullStat(fullPayload(properties)).raw;
  assert.equal(Object.getPrototypeOf(raw), Object.prototype);
  assert.equal(Object.hasOwn(raw, '__proto__'), true);
  assert.equal(raw.__proto__, 'extension');
  assert.equal(raw.constructor, 'custom');
});

test('Full Stat 拒绝重复或缺少标准属性、无效字段值', () => {
  expectProtocolError(() => decodeFullStat(fullPayload([...Object.entries(standardProperties), ['hostname', 'other']])));
  expectProtocolError(() => decodeFullStat(fullPayload(Object.entries(standardProperties).filter(([key]) => key !== 'version'))));
  for (const [key, value] of [['numplayers', '-1'], ['maxplayers', '20x'], ['hostport', '65536']]) {
    const fields = { ...standardProperties, [key]: value };
    expectProtocolError(() => decodeFullStat(fullPayload(Object.entries(fields))));
  }
});

test('Full Stat 拒绝未知分片、损坏标记、缺失玩家结束字节及尾随数据', () => {
  const payload = fullPayload();
  const fragmented = Buffer.from(payload);
  fragmented[9] = 0;
  expectProtocolError(() => decodeFullStat(fragmented));
  expectProtocolError(() => decodeFullStat(Buffer.from('splitnum\0\x80', 'latin1')));
  expectProtocolError(() => decodeFullStat(payload.subarray(0, -1)));
  expectProtocolError(() => decodeFullStat(Buffer.concat([payload, Buffer.from([1])])));
  const damaged = Buffer.from(payload);
  const marker = damaged.indexOf(Buffer.from('\x01player_', 'latin1'));
  damaged[marker] = 2;
  expectProtocolError(() => decodeFullStat(damaged));
});

test('无效 UTF-8 以协议错误报告', () => {
  expectProtocolError(() => decodeChallenge(Buffer.from([0xc3, 0x28, 0])));
  expectProtocolError(() => decodeBasicStat(Buffer.from([0xff, 0])));
  const payload = fullPayload();
  const player = payload.indexOf('Alex');
  payload[player] = 0xff;
  expectProtocolError(() => decodeFullStat(payload));
});

test('Full Stat 任意截断点都报告协议错误', () => {
  const payload = fullPayload();
  for (let size = 0; size < payload.length; size += 1) {
    expectProtocolError(() => decodeFullStat(payload.subarray(0, size)));
  }
});

test('UTF-8 BOM 出现在字段内容中时原样保留', () => {
  const fields = { ...standardProperties, hostname: '\ufeffMOTD' };
  const result = decodeFullStat(fullPayload(Object.entries(fields)));
  assert.equal(result.raw.hostname, '\ufeffMOTD');
  assert.equal(result.motd, '\ufeffMOTD');
});

test('MOTD 移除 § 样式代码，保留换行与非格式内容', () => {
  assert.equal(parseMOTD('§A你好§l World§r\n§x§f§f§0§0§a§aRGB'), '你好 World\nRGB');
  assert.equal(parseMOTD('不完整 § 与未知 §z 代码'), '不完整 § 与未知 §z 代码');
});
