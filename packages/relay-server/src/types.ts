// ========================================================
// Agent 消息总线 — 中继层 共享类型定义
// ========================================================

// ========== REST 代理 ==========

export interface ProxyResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface ProxyError {
  code: string;
  message: string;
  detail?: string;
}

// ========== TCP 隧道协议 ==========

/** 隧道请求（VPS → NAS） */
export interface TunnelRequest {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

/** 隧道响应（NAS → VPS） */
export interface TunnelResponse {
  id: string;
  type: 'response';
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** 隧道心跳 PING */
export interface TunnelPing {
  id: string;
  type: 'ping';
}

/** 隧道心跳 PONG */
export interface TunnelPong {
  id: string;
  type: 'pong';
}

export type TunnelMessage = TunnelResponse | TunnelPing | TunnelPong;
