// 从包名导入，验证发布入口的类型声明；此文件仅由 tsc 检查，不执行网络请求。
import {
  MCQueryError,
  MCServerQuery,
  measureQueryLatency,
  parseMOTD,
  queryBasicStatus,
  queryStatus,
  queryStatusWithLatency,
} from 'query-mc';
import type {
  MCQueryBasicStatus,
  MCQueryErrorCode,
  MCQueryFullPlayers,
  MCQueryHost,
  MCQueryOptions,
  MCQueryPlayers,
  MCQueryStatus,
  MCQueryStatusWithLatency,
} from 'query-mc';

const options: MCQueryOptions = { timeout: 1000 };
const server = new MCServerQuery('localhost', '25565', options);
const defaultPortServer = new MCServerQuery('localhost', undefined, options);
const host: string = server.host;
const port: number = server.port;
const status: Promise<MCQueryStatus> = server.getStatus();
const basicStatus: Promise<MCQueryBasicStatus> = server.getBasicStatus();
const timedStatus: Promise<MCQueryStatusWithLatency> = server.getStatusWithLatency();
const version: Promise<string> = server.getVersion();
const online: Promise<number> = server.getOnlinePlayerCount();
const max: Promise<number> = server.getMaxPlayerCount();
const motd: Promise<string> = server.getMOTD();
const playerList: Promise<string[]> = server.getPlayerList();
const plugins: Promise<string[]> = server.getPlugins();
const map: Promise<string> = server.getMap();
const latency: Promise<number> = server.measureLatency();

const functionalStatus: Promise<MCQueryStatus> = queryStatus('localhost');
const functionalBasic: Promise<MCQueryBasicStatus> = queryBasicStatus('localhost', '25565', options);
const functionalTimed: Promise<MCQueryStatusWithLatency> = queryStatusWithLatency('localhost', 25565, options);
const functionalLatency: Promise<number> = measureQueryLatency('localhost', undefined, options);
const text: string = parseMOTD('§a欢迎\n来到服务器');
const players: MCQueryPlayers = { online: 1, max: 20 };
const fullPlayers: MCQueryFullPlayers = { ...players, list: ['Alex'] };
const reportedHost: MCQueryHost = { ip: '127.0.0.1', port: 25565 };
const code: MCQueryErrorCode = new MCQueryError('TIMEOUT', 'Timed out').code;
const cause: unknown = new MCQueryError('NETWORK_ERROR', 'Failed', { cause: new Error('socket') }).cause;

// @ts-expect-error 端口不能是布尔值。
new MCServerQuery('localhost', true);
// @ts-expect-error 请求超时使用数值毫秒。
queryStatus('localhost', 25565, { timeout: '1000' });
// @ts-expect-error Query 没有 TCP 握手协议编号选项。
queryBasicStatus('localhost', 25565, { protocolVersion: -1 });
// @ts-expect-error 地址只读，修改地址应新建实例。
server.host = 'example.com';
// @ts-expect-error 端口只读。
server.port = 25566;
// @ts-expect-error Query 的 MOTD 是字符串，不使用聊天组件。
parseMOTD({ text: 'Hello' });
// @ts-expect-error Basic Stat 不提供玩家名称列表。
const basicPlayerList = ({} as MCQueryBasicStatus).players.list;
// @ts-expect-error Query 不提供服务器图标。
server.getIcon();

void [
  defaultPortServer, host, port, status, basicStatus, timedStatus, version, online, max,
  motd, playerList, plugins, map, latency, functionalStatus, functionalBasic,
  functionalTimed, functionalLatency, text, players, fullPlayers, reportedHost,
  code, cause, basicPlayerList,
];
