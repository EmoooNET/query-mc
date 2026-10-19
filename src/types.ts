/** 每次请求独立使用的配置。 */
export interface MCQueryOptions {
  /** 整次查询的超时时间（毫秒），包含 DNS、challenge 和状态查询。默认 5000。 */
  timeout?: number;
}

export interface MCQueryPlayers {
  online: number;
  max: number;
}

export interface MCQueryFullPlayers extends MCQueryPlayers {
  /** 服务器返回的玩家名称；可能被服务端隐藏，不保证等于在线人数。 */
  list: string[];
}

/** 服务端在响应中报告的游戏地址，可能与实际查询的 UDP 地址不同。 */
export interface MCQueryHost {
  ip: string;
  port: number;
}

/** Basic Stat 提供的基础信息。 */
export interface MCQueryBasicStatus {
  /** 已移除 § 颜色及格式代码的正文，保留换行。 */
  motd: string;
  gameType: string;
  map: string;
  players: MCQueryPlayers;
  host: MCQueryHost;
}

/** Full Stat 提供的详细信息；Query 不提供协议版本编号、UUID 或服务器图标。 */
export interface MCQueryStatus extends MCQueryBasicStatus {
  players: MCQueryFullPlayers;
  gameId: string;
  version: string;
  /** plugins 原始字段中的服务端软件名；原版通常返回空字符串。 */
  software: string;
  plugins: string[];
  /** 保留所有原始键值，便于读取非标准扩展和带颜色的 hostname。 */
  raw: Record<string, string>;
}

export interface MCQueryStatusWithLatency extends MCQueryStatus {
  /** Stat 请求发出至响应到达的时间（毫秒），不包含 DNS 和 challenge。 */
  latency: number;
}
