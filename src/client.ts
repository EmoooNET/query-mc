import { normalizeOptions } from './options.js';
import type { ConnectionOptions } from './options.js';
import { requestStatus, requestStatusWithLatency } from './transport.js';
import type { MCQueryBasicStatus, MCQueryOptions, MCQueryStatus, MCQueryStatusWithLatency } from './types.js';

/** 保存查询地址与配置；构造时不联网，每个方法独立发起一次实时请求。 */
export class MCServerQuery {
  readonly #options: ConnectionOptions;

  /** 端口省略时使用 UDP 25565；Query 端口需与服务器的 query.port 一致。 */
  constructor(host: string, port?: number | string, options: MCQueryOptions = {}) {
    this.#options = normalizeOptions(host, port, options);
  }

  get host(): string {
    return this.#options.host;
  }

  get port(): number {
    return this.#options.port;
  }

  /** 获取 Full Stat。需要多个字段时优先调用此方法，避免重复查询。 */
  getStatus(): Promise<MCQueryStatus> {
    return requestStatus(this.#options, 'full');
  }

  /** 获取 Basic Stat，仅包含 MOTD、地图、游戏类型、人数及服务端地址。 */
  getBasicStatus(): Promise<MCQueryBasicStatus> {
    return requestStatus(this.#options, 'basic');
  }

  /** 获取 Full Stat，并记录本次 Stat 请求的往返时间。 */
  getStatusWithLatency(): Promise<MCQueryStatusWithLatency> {
    return requestStatusWithLatency(this.#options);
  }

  async getVersion(): Promise<string> {
    return (await this.getStatus()).version;
  }

  async getOnlinePlayerCount(): Promise<number> {
    return (await this.getStatus()).players.online;
  }

  async getMaxPlayerCount(): Promise<number> {
    return (await this.getStatus()).players.max;
  }

  async getMOTD(): Promise<string> {
    return (await this.getStatus()).motd;
  }

  /** 名称列表由服务器提供，可能被隐藏，不保证与在线人数相同。 */
  async getPlayerList(): Promise<string[]> {
    return (await this.getStatus()).players.list;
  }

  async getPlugins(): Promise<string[]> {
    return (await this.getStatus()).plugins;
  }

  async getMap(): Promise<string> {
    return (await this.getStatus()).map;
  }

  /** 通过完整 Full Stat 测量 Stat 往返时间；Query 没有独立的 Ping 包。 */
  async measureLatency(): Promise<number> {
    return (await this.getStatusWithLatency()).latency;
  }
}

/** 无需持有实例，直接获取最新 Full Stat。 */
export async function queryStatus(
  host: string,
  port?: number | string,
  options: MCQueryOptions = {},
): Promise<MCQueryStatus> {
  return new MCServerQuery(host, port, options).getStatus();
}

/** 无需持有实例，直接获取最新 Basic Stat。 */
export async function queryBasicStatus(
  host: string,
  port?: number | string,
  options: MCQueryOptions = {},
): Promise<MCQueryBasicStatus> {
  return new MCServerQuery(host, port, options).getBasicStatus();
}

/** 同一次查询返回 Full Stat 和 Stat 往返时间。 */
export async function queryStatusWithLatency(
  host: string,
  port?: number | string,
  options: MCQueryOptions = {},
): Promise<MCQueryStatusWithLatency> {
  return new MCServerQuery(host, port, options).getStatusWithLatency();
}

/** 通过完整 Full Stat 测量往返时间，单位为毫秒。 */
export async function measureQueryLatency(
  host: string,
  port?: number | string,
  options: MCQueryOptions = {},
): Promise<number> {
  return new MCServerQuery(host, port, options).measureLatency();
}
