# QueryMC

用于查询 Minecraft Java Edition 服务器的 Node.js 库，实现基于 UDP 的 Query（GameSpy4）协议，支持 Basic Stat 和 Full Stat。源码使用 TypeScript，发布为 ESM，附带 `.d.ts`、声明映射及源码映射，无运行时依赖。运行环境为 Node.js 22+。

可通过 `MCServerQuery` 实例保存服务器地址和查询选项，也可直接调用函数式 API。支持查询 MOTD、版本名称、在线人数、玩家名称、地图、服务端软件及插件，并测量 Stat 请求的往返时间。Query 不支持 Bedrock，也不提供服务器图标、玩家 UUID 或协议版本编号。

## 服务端配置

Java Edition 服务端需要在 `server.properties` 中启用 Query，并在修改后重启服务器：

```properties
enable-query=true
query.port=25565
```

防火墙、云安全组及端口转发需要放行对应的 **UDP** 端口。游戏连接使用 TCP，能进入服务器不代表 Query 已启用或 UDP 端口已开放。`query.port` 可与游戏端口不同，调用时应传入实际 Query 端口。

省略端口时使用 UDP `25565`。本库不通过 `_minecraft._tcp` SRV 记录发现 Query 地址，因为该记录指向游戏的 TCP 服务，不能确定独立的 Query 端口。

支持标准 Minecraft 单数据报 Full Stat；非标准 GameSpy 多包分片会报告 `PROTOCOL_ERROR`。库不自动重试，UDP 丢包或超时后可由调用方决定是否重试。

## 构建和本地安装

```sh
pnpm install
pnpm test
pnpm pack
```

`pnpm pack` 会先构建，再生成 `query-mc-1.0.0.tgz`。在使用此库的项目中安装该文件：

```sh
pnpm add /path/to/query-mc-1.0.0.tgz
```

库入口为 `dist/index.js`，类型入口为 `dist/index.d.ts`。导入库不会联网或执行示例程序。项目已配置打包入口，尚未发布到 npm。

## 使用实例

```ts
import { MCQueryError, MCServerQuery } from 'query-mc';

const server = new MCServerQuery('localhost', '25565', {
  timeout: 5000,
});

try {
  const status = await server.getStatusWithLatency();

  console.log(status.version); // 版本名称，例如 "1.21.1"
  console.log(`${status.players.online}/${status.players.max}`);
  console.log(status.players.list); // 服务器公开的玩家名称
  console.log(status.map);
  console.log(status.software, status.plugins);
  console.log(status.motd);    // 已移除颜色代码的正文，保留换行
  console.log(status.latency); // Stat 往返时间，单位毫秒，可含小数
} catch (error) {
  if (error instanceof MCQueryError) {
    console.error(error.code, error.message);
  } else {
    throw error;
  }
}
```

**每次方法调用都会创建独立的 UDP socket，执行 challenge 和状态查询，不读取缓存，也不自动轮询。** 构造函数只验证和保存参数；请求完成或失败后会释放 socket，无需手动关闭实例。需要多个字段时，优先使用 `getStatus()` 或 `getStatusWithLatency()`，即可获取同一份状态快照。

```ts
const basic = await server.getBasicStatus();        // 基础状态
const version = await server.getVersion();          // string
const online = await server.getOnlinePlayerCount(); // number
const max = await server.getMaxPlayerCount();       // number
const motd = await server.getMOTD();                // string
const players = await server.getPlayerList();       // string[]
const plugins = await server.getPlugins();          // string[]
const map = await server.getMap();                  // string
const latency = await server.measureLatency();      // number，毫秒
```

上述字段方法均获取一次 Full Stat。仅需基础信息时，可使用 `getBasicStatus()` 读取人数、MOTD、地图等字段。

## 函数式 API

```ts
import {
  measureQueryLatency,
  parseMOTD,
  queryBasicStatus,
  queryStatus,
  queryStatusWithLatency,
} from 'query-mc';

const status = await queryStatus('localhost', 25565);
const basic = await queryBasicStatus('localhost', '25565', { timeout: 3000 });
const timed = await queryStatusWithLatency('localhost', 25565);
const milliseconds = await measureQueryLatency('localhost', 25565);

// 纯函数，不联网；Query 的 hostname/MOTD 是字符串。
const text = parseMOTD('§a欢迎\n§l来到服务器');
// "欢迎\n来到服务器"
```

## API 签名

```ts
new MCServerQuery(host: string, port?: number | string, options?: MCQueryOptions)

queryStatus(host: string, port?: number | string, options?: MCQueryOptions): Promise<MCQueryStatus>
queryBasicStatus(host: string, port?: number | string, options?: MCQueryOptions): Promise<MCQueryBasicStatus>
queryStatusWithLatency(host: string, port?: number | string, options?: MCQueryOptions): Promise<MCQueryStatusWithLatency>
measureQueryLatency(host: string, port?: number | string, options?: MCQueryOptions): Promise<number>
parseMOTD(text: string): string
```

`host` 接受主机名、IPv4 或不带方括号的 IPv6 地址，例如 `::1`；不接受 URL、空字符串、空白字符或带端口的地址。`port` 接受 `1–65535` 的整数或仅包含十进制数字的字符串，例如 `'25565'`。省略端口时如需设置选项，将第二个参数设为 `undefined`：

```ts
const server = new MCServerQuery('localhost', undefined, { timeout: 3000 });
```

| 实例方法 / 属性 | 返回类型 | 用途 |
| --- | --- | --- |
| `host` | `string`（只读） | 查询使用的主机名或 IP |
| `port` | `number`（只读） | Query UDP 端口，默认 `25565` |
| `getStatus()` | `Promise<MCQueryStatus>` | Full Stat |
| `getBasicStatus()` | `Promise<MCQueryBasicStatus>` | Basic Stat |
| `getStatusWithLatency()` | `Promise<MCQueryStatusWithLatency>` | Full Stat 与本次 Stat 往返时间 |
| `getVersion()` | `Promise<string>` | 版本名称 |
| `getOnlinePlayerCount()` | `Promise<number>` | 在线人数 |
| `getMaxPlayerCount()` | `Promise<number>` | 最大玩家人数 |
| `getMOTD()` | `Promise<string>` | MOTD 正文 |
| `getPlayerList()` | `Promise<string[]>` | 服务器公开的玩家名称 |
| `getPlugins()` | `Promise<string[]>` | 服务器公开的插件列表 |
| `getMap()` | `Promise<string>` | 地图名称 |
| `measureLatency()` | `Promise<number>` | 完成一次 Full Stat，返回 Stat 往返时间 |

### 配置与返回值

以下类型均可通过 `import type { ... } from 'query-mc'` 导入：

```ts
interface MCQueryOptions {
  timeout?: number; // 默认 5000；整次请求的超时时间，单位毫秒
}

interface MCQueryPlayers {
  online: number;
  max: number;
}

interface MCQueryFullPlayers extends MCQueryPlayers {
  list: string[];
}

interface MCQueryHost {
  ip: string;
  port: number;
}

interface MCQueryBasicStatus {
  motd: string;
  gameType: string;
  map: string;
  players: MCQueryPlayers;
  host: MCQueryHost;
}

interface MCQueryStatus extends MCQueryBasicStatus {
  players: MCQueryFullPlayers;
  gameId: string;
  version: string;
  software: string;
  plugins: string[];
  raw: Record<string, string>;
}

interface MCQueryStatusWithLatency extends MCQueryStatus {
  latency: number;
}
```

`players.list` 由服务器决定是否公开，不保证长度等于 `players.online`。空列表也可能表示服务器隐藏了玩家名。`plugins` 来自 Full Stat 的插件字段，服务端可能不公开；`software` 是该字段中报告的服务端软件名，原版通常为空字符串。

`host` 是服务端在响应中报告的游戏地址，可能与实例的 Query 地址不同。`raw` 保留 Full Stat 的原始字符串键值，包括带颜色代码的 `hostname`，便于读取非标准扩展。`motd` 移除 `§` 颜色与格式代码并保留换行；不会把字符串解释为 JSON 聊天组件。

`timeout` 接受 `1–2147483647` 的整数，覆盖 DNS、challenge 和状态查询的总耗时。`latency` 使用单调时钟，从 Stat 请求发出时计时，到对应的状态响应到达时结束，不包含 DNS 和 challenge。`measureLatency()` 会完成一次 Full Stat 查询并验证响应，返回本次 Stat 请求的往返时间。

超过总超时后请求即结束。系统 DNS 查询本身无法取消，但迟到的解析结果不会触发 UDP 请求。

### 错误处理

构造函数的参数错误同步抛出 `TypeError` / `RangeError`；异步函数的参数错误通过 Promise 拒绝返回。网络与协议错误使用 `MCQueryError`：

| `error.code` | 含义 |
| --- | --- |
| `TIMEOUT` | 整次请求超过时限，包括服务器未响应的情况 |
| `CONNECTION_CLOSED` | 完整响应到达前，本地 UDP socket 意外关闭 |
| `NETWORK_ERROR` | DNS、UDP 发送或底层 socket 错误 |
| `PROTOCOL_ERROR` | challenge、状态数据包或必需状态字段无效 |

底层错误保留在 `error.cause` 中；`MCQueryErrorCode` 也作为类型导出。

## 开发

```sh
pnpm build          # 生成 ESM、.d.ts 及映射文件
pnpm typecheck      # 仅检查源码类型
pnpm test:types     # 检查从包名导入的公开类型，需先构建
pnpm test           # 构建、检查公开类型、运行本地 UDP 模拟服务器测试
pnpm start          # 查询 localhost:25565（UDP）
pnpm start localhost 25566 # 查询指定主机和 Query 端口
pnpm pack           # 构建并生成本地安装包，不发布
```

示例程序读取命令行的主机与端口，失败时设置退出码为 `1`。测试使用本地模拟服务器，不依赖公网 Minecraft 服务器；类型测试仅由 `tsc` 检查，不执行其中的请求。

```text
src/
  index.ts            公开导出
  client.ts           实例方法与函数式 API
  types.ts            配置及返回值接口
  errors.ts           可识别的错误类型
  options.ts          参数验证
  transport.ts        UDP 生命周期、超时、challenge 与状态请求
  status.ts           响应字段验证与类型转换
  motd.ts             纯文本 MOTD 解析
  protocol/
    codec.ts          字符串和二进制字段读写
    packets.ts        Query 数据包编码与解码
examples/
  query.mjs           命令行查询示例
test/
  public-api.ts       包入口及公开类型检查
```

协议实现参考 Glowstone 的 [QueryHandler](https://github.com/GlowstoneMC/Glowstone/blob/dev/src/main/java/net/glowstone/net/query/QueryHandler.java)、[QueryServer](https://github.com/GlowstoneMC/Glowstone/blob/dev/src/main/java/net/glowstone/net/query/QueryServer.java) 及 Paper 的 [QueryThreadGs4 补丁](https://github.com/PaperMC/Paper/blob/main/paper-server/patches/sources/net/minecraft/server/rcon/thread/QueryThreadGs4.java.patch)。
