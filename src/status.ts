import { parseMOTD } from './motd.js';
import { PacketReader, protocolError, readUnsignedInteger } from './protocol/codec.js';
import type { MCQueryBasicStatus, MCQueryStatus } from './types.js';

const FULL_STAT_PREFIX = Buffer.from('splitnum\0\x80\0', 'latin1');
const PLAYER_PREFIX = Buffer.from('\x01player_\0\0', 'latin1');

export function decodeBasicStat(payload: Buffer): MCQueryBasicStatus {
  const reader = new PacketReader(payload);
  const motd = reader.readString('motd');
  const gameType = reader.readString('gametype');
  const map = reader.readString('map');
  const online = readUnsignedInteger(reader.readString('numplayers'), 'numplayers');
  const max = readUnsignedInteger(reader.readString('maxplayers'), 'maxplayers');
  // Basic Stat 唯独 hostport 使用小端，不能将整个响应作为字符串切分。
  const port = reader.readUInt16LE('hostport');
  const ip = reader.readString('hostip');
  reader.expectEnd();

  return {
    motd: parseMOTD(motd),
    gameType,
    map,
    players: { online, max },
    host: { ip, port },
  };
}

export function decodeFullStat(payload: Buffer): MCQueryStatus {
  const reader = new PacketReader(payload);
  // 0x80 表示单包结束；这里不尝试拼装服务端私有的分片扩展。
  reader.expectBytes(FULL_STAT_PREFIX, 'Full Stat splitnum 标记（仅支持标准单包响应）');
  const raw = readProperties(reader);
  reader.expectBytes(PLAYER_PREFIX, '玩家列表标记');
  const list = readPlayers(reader);
  reader.expectEnd();
  return createFullStatus(raw, list);
}

function readProperties(reader: PacketReader): Record<string, string> {
  const entries: Array<[string, string]> = [];
  const keys = new Set<string>();

  while (true) {
    const key = reader.readString('属性名');
    if (key === '') {
      // fromEntries 将 __proto__ 等扩展键创建为普通数据属性。
      return Object.fromEntries(entries);
    }
    if (keys.has(key)) {
      throw protocolError(`Full Stat 包含重复属性：${key}。`);
    }

    keys.add(key);
    entries.push([key, reader.readString(`属性 ${key}`)]);
  }
}

function readPlayers(reader: PacketReader): string[] {
  const players: string[] = [];

  while (true) {
    const name = reader.readString('玩家名称或玩家列表结束标记');
    if (name === '') {
      return players;
    }
    players.push(name);
  }
}

function createFullStatus(raw: Record<string, string>, list: string[]): MCQueryStatus {
  const motd = readProperty(raw, 'hostname');
  const online = readUnsignedInteger(readProperty(raw, 'numplayers'), 'numplayers');
  const max = readUnsignedInteger(readProperty(raw, 'maxplayers'), 'maxplayers');
  const port = readUnsignedInteger(readProperty(raw, 'hostport'), 'hostport', 0xffff);
  const software = parseSoftware(readProperty(raw, 'plugins'));

  return {
    motd: parseMOTD(motd),
    gameType: readProperty(raw, 'gametype'),
    map: readProperty(raw, 'map'),
    players: { online, max, list },
    host: { ip: readProperty(raw, 'hostip'), port },
    gameId: readProperty(raw, 'game_id'),
    version: readProperty(raw, 'version'),
    software: software.name,
    plugins: software.plugins,
    raw,
  };
}

function readProperty(raw: Record<string, string>, key: string): string {
  const value = raw[key];
  if (!Object.hasOwn(raw, key) || value === undefined) {
    throw protocolError(`Full Stat 缺少属性：${key}。`);
  }
  return value;
}

function parseSoftware(value: string): { name: string; plugins: string[] } {
  const separator = value.indexOf(':');
  if (separator === -1) {
    return { name: value.trim(), plugins: [] };
  }

  const name = value.slice(0, separator).trim();
  const plugins = value.slice(separator + 1).split(';').map((plugin) => plugin.trim()).filter(Boolean);
  return { name, plugins };
}
