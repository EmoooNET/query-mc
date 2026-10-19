import { MCQueryError, MCServerQuery } from '../dist/index.js';

const host = process.argv[2] ?? 'localhost';
const port = process.argv[3] ?? 25565;

try {
  const server = new MCServerQuery(host, port);
  const status = await server.getStatusWithLatency();

  console.log('查询地址:', `${server.host}:${server.port} (UDP)`);
  console.log('版本:', status.version);
  console.log('服务端:', status.software || '未提供');
  console.log('玩家:', `${status.players.online}/${status.players.max}`);
  console.log('列表:', status.players.list.join(', ') || '无或未公开');
  console.log('地图:', status.map);
  console.log('插件:', status.plugins.join(', ') || '无或未公开');
  console.log('MOTD:', status.motd);
  console.log('Stat 延迟:', `${status.latency.toFixed(2)} ms`);
} catch (error) {
  if (error instanceof MCQueryError) {
    console.error('查询失败:', error.code, error.message);
  } else {
    console.error('查询失败:', error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
}
