import { isIP } from 'node:net';
import type { MCQueryOptions } from './types.js';

export interface ConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly timeout: number;
}

function validateHost(host: string): void {
  if (typeof host !== 'string' || host.length === 0 || host.length > 255 || /\s|\0/.test(host)) {
    throw new TypeError('host must be a non-empty hostname or IP address (at most 255 characters)');
  }
  // IPv6 允许冒号；域名不接受 URL、端口、路径或方括号形式的地址。
  if (isIP(host) !== 0) return;
  if (/[:/\\?#@\[\]]/.test(host)) {
    throw new TypeError('host must be a hostname or an unbracketed IP address, without a URL or port');
  }
}

function normalizePort(port: number | string | undefined): number {
  const requested = port === undefined ? 25565 : port;
  if (typeof requested !== 'number' && (typeof requested !== 'string' || !/^\d+$/.test(requested))) {
    throw new TypeError('port must be an integer or a decimal integer string');
  }
  const numeric = Number(requested);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    throw new RangeError('port must be between 1 and 65535');
  }
  return numeric;
}

export function normalizeOptions(
  host: string,
  port: number | string | undefined,
  options: MCQueryOptions,
): ConnectionOptions {
  validateHost(host);
  const numericPort = normalizePort(port);
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  const timeout = options.timeout === undefined ? 5000 : options.timeout;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
    throw new RangeError('timeout must be an integer between 1 and 2147483647 milliseconds');
  }
  return Object.freeze({ host, port: numericPort, timeout });
}
