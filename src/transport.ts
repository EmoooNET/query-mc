import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import type { Socket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import { MCQueryError } from './errors.js';
import type { ConnectionOptions } from './options.js';
import {
  createHandshake,
  createStatRequest,
  decodeBasicStat,
  decodeChallenge,
  decodeFullStat,
  decodeResponse,
} from './protocol/packets.js';
import type { MCQueryBasicStatus, MCQueryStatus, MCQueryStatusWithLatency } from './types.js';

interface ExchangeResult<T> {
  status: T;
  latency: number;
}

type DecodeStatus<T> = (payload: Buffer) => T;

/** 一次请求的状态只属于这个对象，并发调用不会共享 socket、challenge 或计时器。 */
class QueryRequest<T> {
  readonly #options: ConnectionOptions;
  readonly #full: boolean;
  readonly #decode: DecodeStatus<T>;
  // 原版服务端只保留每个字节的低四位，因此在发送前就限制 session 的取值。
  readonly #sessionId = randomBytes(4).readUInt32BE() & 0x0f0f0f0f;
  #socket: Socket | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #resolve: ((result: ExchangeResult<T>) => void) | undefined;
  #reject: ((error: MCQueryError) => void) | undefined;
  #settled = false;
  #phase: 'challenge' | 'stat' = 'challenge';
  #statStarted = 0;

  constructor(options: ConnectionOptions, full: boolean, decode: DecodeStatus<T>) {
    this.#options = options;
    this.#full = full;
    this.#decode = decode;
  }

  run(): Promise<ExchangeResult<T>> {
    return new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
      // 共用一个总时限，收到 challenge 或无关报文都不会重新计时。
      this.#timer = setTimeout(() => {
        this.#fail(new MCQueryError('TIMEOUT', `Server query timed out after ${this.#options.timeout} ms`));
      }, this.#options.timeout);
      void this.#connect();
    });
  }

  async #connect(): Promise<void> {
    try {
      const address = await this.#resolveAddress();
      // 系统 DNS 查询不能取消；迟到的结果不会在超时后创建 socket 或发送请求。
      if (this.#settled) return;
      const socketType = address.family === 6 ? 'udp6' : 'udp4';
      const socket = createSocket(socketType);
      this.#socket = socket;
      socket.on('message', (packet) => this.#handleMessage(packet));
      socket.on('error', (cause) => this.#networkError(cause));
      socket.once('close', () => {
        this.#fail(new MCQueryError('CONNECTION_CLOSED', 'Query socket closed before a complete response arrived'));
      });
      // 连接 UDP socket 后由系统过滤其他来源的包，握手与 Stat 也会使用同一源端口。
      socket.connect(this.#options.port, address.address, () => this.#sendHandshake());
    } catch (cause) {
      this.#networkError(cause);
    }
  }

  async #resolveAddress(): Promise<{ address: string; family: number }> {
    const family = isIP(this.#options.host);
    if (family !== 0) return { address: this.#options.host, family };
    // 使用系统解析器以支持 hosts 文件；Query 端口独立于 TCP Ping，不查询其 SRV。
    return lookup(this.#options.host);
  }

  #sendHandshake(): void {
    if (this.#settled) return;
    this.#send(createHandshake(this.#sessionId));
  }

  #send(packet: Buffer): void {
    if (this.#settled) return;
    try {
      this.#socket?.send(packet, (cause) => {
        if (cause) this.#networkError(cause);
      });
    } catch (cause) {
      this.#networkError(cause);
    }
  }

  #handleMessage(packet: Buffer): void {
    if (this.#settled) return;
    try {
      const response = decodeResponse(packet, this.#sessionId);
      if (response === undefined) return;
      if (this.#phase === 'challenge') {
        this.#handleChallenge(response.type, response.payload);
        return;
      }
      // UDP 可能重复或乱序；已进入 Stat 阶段的 challenge 不再触发新请求。
      if (response.type !== 0) return;
      const receivedAt = performance.now();
      const status = this.#decode(response.payload);
      this.#succeed({ status, latency: receivedAt - this.#statStarted });
    } catch (cause) {
      if (cause instanceof MCQueryError) {
        this.#fail(cause);
        return;
      }
      const detail = cause instanceof Error ? cause.message : 'Invalid Query response';
      this.#fail(new MCQueryError('PROTOCOL_ERROR', detail, { cause }));
    }
  }

  #handleChallenge(type: number, payload: Buffer): void {
    if (type !== 9) return;
    const challenge = decodeChallenge(payload);
    const request = createStatRequest(this.#sessionId, challenge, this.#full);
    this.#phase = 'stat';
    this.#statStarted = performance.now();
    this.#send(request);
  }

  #networkError(cause: unknown): void {
    this.#fail(new MCQueryError(
      'NETWORK_ERROR',
      `Could not query ${this.#options.host}:${this.#options.port}`,
      { cause },
    ));
  }

  #succeed(result: ExchangeResult<T>): void {
    if (this.#settled) return;
    this.#cleanup();
    this.#resolve?.(result);
  }

  #fail(error: MCQueryError): void {
    if (this.#settled) return;
    this.#cleanup();
    this.#reject?.(error);
  }

  #cleanup(): void {
    this.#settled = true;
    clearTimeout(this.#timer);
    // DNS 阶段可能还没有 socket；连接启动失败时 close 也可能同步抛错。
    try {
      this.#socket?.close();
    } catch {
      // 未绑定的 socket 不持有端口，无需继续释放。
    }
  }
}

export function requestStatus(options: ConnectionOptions, mode: 'basic'): Promise<MCQueryBasicStatus>;
export function requestStatus(options: ConnectionOptions, mode: 'full'): Promise<MCQueryStatus>;
export async function requestStatus(
  options: ConnectionOptions,
  mode: 'basic' | 'full',
): Promise<MCQueryBasicStatus | MCQueryStatus> {
  if (mode === 'basic') {
    return (await new QueryRequest(options, false, decodeBasicStat).run()).status;
  }
  return (await new QueryRequest(options, true, decodeFullStat).run()).status;
}

export async function requestStatusWithLatency(options: ConnectionOptions): Promise<MCQueryStatusWithLatency> {
  const { status, latency } = await new QueryRequest(options, true, decodeFullStat).run();
  return { ...status, latency };
}
