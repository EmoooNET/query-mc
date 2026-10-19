import { MCQueryError } from '../errors.js';

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** 顺序读取 Query 字段，集中处理越界与字符串结束标记。 */
export class PacketReader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  readString(field: string): string {
    const end = this.buffer.indexOf(0, this.offset);
    if (end === -1) {
      throw protocolError(`${field} 缺少 NUL 结束标记。`);
    }

    const bytes = this.buffer.subarray(this.offset, end);
    this.offset = end + 1;

    try {
      return utf8.decode(bytes);
    } catch (cause) {
      throw new MCQueryError('PROTOCOL_ERROR', `${field} 不是有效的 UTF-8 字符串。`, { cause });
    }
  }

  readUInt16LE(field: string): number {
    this.requireBytes(2, field);
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  expectBytes(expected: Buffer, field: string): void {
    this.requireBytes(expected.length, field);
    const actual = this.buffer.subarray(this.offset, this.offset + expected.length);
    if (!actual.equals(expected)) {
      throw protocolError(`${field} 与 Query 协议不符。`);
    }
    this.offset += expected.length;
  }

  expectEnd(): void {
    if (this.offset !== this.buffer.length) {
      throw protocolError('Query 响应包含多余的数据。');
    }
  }

  private requireBytes(length: number, field: string): void {
    if (this.offset + length > this.buffer.length) {
      throw protocolError(`${field} 的数据不完整。`);
    }
  }
}

export function protocolError(message: string): MCQueryError {
  return new MCQueryError('PROTOCOL_ERROR', message);
}

/** 字符串数值必须完整有效，避免 parseInt 将 20players 误读为 20。 */
export function readUnsignedInteger(value: string, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!/^\d+$/.test(value)) {
    throw protocolError(`${field} 必须是非负十进制整数。`);
  }

  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > max) {
    throw protocolError(`${field} 超出允许的整数范围。`);
  }
  return result;
}
