// ========================================================
// Agent 消息总线 — 中继层 TCP 隧道服务端（存根）
// MVP 阶段暂不实现，预留接口
// 未来用于将 VPS 收到的 REST 请求通过 TCP 长连接
// 转发到 NAT 后的 NAS 内网总线
// ========================================================

import type { TunnelRequest, TunnelResponse } from '../types.js';

/**
 * 创建 TCP 隧道服务端（VPS 端）
 *
 * NAS 端主动建立 TCP 长连接到 VPS，VPS 把来自 Agent 的 REST 请求
 * 通过这个长连接转发到 NAS，NAS 调用本地总线后返回结果。
 *
 * @param port  监听端口
 * @param onRequest 转发请求回调
 * @returns 隧道服务控制对象
 */
export function createTunnelServer(
  _port: number,
  _onRequest: (req: TunnelRequest) => Promise<TunnelResponse>,
): { send: (req: TunnelRequest) => Promise<TunnelResponse>; stop: () => void } {
  // ── MVP 暂不实现 ──
  // 实现要点：
  // 1. net.createServer 监听端口
  // 2. 维护一个 nasSocket 引用（只允许一台 NAS 连接）
  // 3. 接收入站 JSON 行协议消息，匹配 pending 队列
  // 4. 超时清理队列（30s）
  console.warn('[Tunnel] TCP tunnel server is a stub — MVP not implemented');
  return {
    send: async (_req: TunnelRequest): Promise<TunnelResponse> => {
      throw new Error('Tunnel server not implemented (MVP stub)');
    },
    stop: () => {
      // noop
    },
  };
}
