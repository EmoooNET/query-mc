import { PacketReader, protocolError } from './codec.js';

export { decodeBasicStat, decodeFullStat } from '../status.js';

const MAGIC = 0xfefd;
const STAT = 0x00;
const HANDSHAKE = 0x09;
const RESPONSE_HEADER_SIZE = 5;

export interface QueryResponse {
  type: number;
  payload: Buffer;
}

export function createHandshake(sessionId: number): Buffer {
  return createRequest(HANDSHAKE, sessionId, 7);
}

export function createStatRequest(sessionId: number, challenge: number, full: boolean): Buffer {
  let size = 11;
  if (full) {
    size = 15;
  }

  const packet = createRequest(STAT, sessionId, size);
  packet.writeInt32BE(challenge, 7);
  // Buffer.alloc 已将 Full Stat 末尾的四字节 padding 填为 0。
  return packet;
}

/** 不同会话的响应属于迟到包；交给调用方继续等待当前请求。 */
export function decodeResponse(packet: Buffer, sessionId: number): QueryResponse | undefined {
  if (packet.length < RESPONSE_HEADER_SIZE) {
    throw protocolError('Query 响应头不完整。');
  }
  if (packet.readUInt32BE(1) !== sessionId) {
    return undefined;
  }

  const type = packet.readUInt8(0);
  if (type !== HANDSHAKE && type !== STAT) {
    throw protocolError(`未知的 Query 响应类型：${type}。`);
  }

  return { type, payload: packet.subarray(RESPONSE_HEADER_SIZE) };
}

export function decodeChallenge(payload: Buffer): number {
  const reader = new PacketReader(payload);
  const token = reader.readString('challenge');
  reader.expectEnd();

  // 部分实现会生成负 challenge，因此不能按无符号整数处理。
  if (!/^-?\d+$/.test(token)) {
    throw protocolError('challenge 必须是有符号十进制整数。');
  }

  const challenge = Number(token);
  if (!Number.isInteger(challenge) || challenge < -0x80000000 || challenge > 0x7fffffff) {
    throw protocolError('challenge 超出 int32 范围。');
  }
  return challenge;
}

function createRequest(type: number, sessionId: number, size: number): Buffer {
  const packet = Buffer.alloc(size);
  packet.writeUInt16BE(MAGIC, 0);
  packet.writeUInt8(type, 2);
  packet.writeUInt32BE(sessionId, 3);
  return packet;
}
