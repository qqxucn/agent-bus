// ========================================================
// Agent 消息总线 — 中继层 TCP 隧道客户端（存根）
// MVP 阶段暂不实现，预留接口
// 未来由 NAS 端主动连接 VPS 隧道服务端
// ========================================================

/**
 * 连接 VPS 隧道服务端（NAS 端）
 *
 * NAS 主动建立 TCP 长连接，接收 VPS 转发的请求，
 * 调用本地总线（localhost:4322）获取响应后返回给 VPS。
 *
 * @param vpsHost VPS 公网 IP
 * @param vpsPort 隧道端口（默认 4323）
 * @param busHost 本地总线地址（默认 localhost）
 * @param busPort 本地总线端口（默认 4322）
 * @returns 断开连接的回调函数
 */
export function connectTunnel(
  _vpsHost: string,
  _vpsPort: number,
  _busHost?: string,
  _busPort?: number,
): () => void {
  // ── MVP 暂不实现 ──
  // 实现要点：
  // 1. net.createConnection 连接 VPS
  // 2. 接收 VPS 发来的 JSON 行协议请求
  // 3. 调用 doLocalRequest() 转发到本地总线
  // 4. 将结果拼 JSON 写回 VPS
  // 5. 30 秒心跳保活
  console.warn('[TunnelC] TCP tunnel client is a stub — MVP not implemented');
  return () => {
    // disconnect noop
  };
}
