// ========================================================
// Agent 消息总线 — 中继层 配置模块
// 所有配置从环境变量读取，支持 12-Factor App 部署
// ========================================================

export interface RelayConfig {
  /** 中继 HTTP 服务端口（VPS 端，接收远端 Agent 的 REST 请求） */
  relayPort: number;
  /** 中继 HTTP 服务监听地址 */
  listenHost: string;

  /** TCP 隧道端口（VPS 端监听，NAS 端连接） */
  tunnelPort: number;
  /** TCP 隧道监听地址（VPS 端）或 VPS 公网 IP（NAS 端） */
  tunnelHost: string;

  /** NAS 本地总线地址（中继转发目标） */
  busHost: string;
  /** NAS 本地总线端口 */
  busPort: number;

  /** 中继客户端模式：tunnel = TCP 长连接，poll = HTTP 轮询 */
  mode: 'tunnel' | 'poll';

  /** 中继 Token，简单的访问控制 */
  relayToken: string;
}

export function loadConfig(): RelayConfig {
  return {
    relayPort: parseInt(process.env.RELAY_PORT ?? '4324', 10),
    listenHost: process.env.LISTEN_HOST ?? '0.0.0.0',
    tunnelPort: parseInt(process.env.TUNNEL_PORT ?? '4323', 10),
    tunnelHost: process.env.TUNNEL_HOST ?? '0.0.0.0',
    busHost: process.env.BUS_HOST ?? 'localhost',
    busPort: parseInt(process.env.BUS_PORT ?? '4322', 10),
    mode: (process.env.MODE as 'tunnel' | 'poll') ?? 'tunnel',
    relayToken: process.env.RELAY_TOKEN ?? '',
  };
}
