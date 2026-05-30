// ========================================================
// Agent 消息总线 — 总线服务端 共享类型定义
// 版本: v1.1
// ========================================================

// ========== 基本类型 ==========

export interface AgentInfo {
  agent_id: string;
  display_name?: string;
  status: 'online' | 'offline' | 'busy';
  mode: 'websocket' | 'poll';
  last_heartbeat: string;
  connected_at: string;
  token_hash: string;
}

export interface AgentRegisterRequest {
  agent_id: string;
  display_name?: string;
  token: string;
}

export interface AgentRegisterResponse {
  success: boolean;
  agent_id: string;
  token: string;
  message?: string;
}

// ========== 消息类型 ==========

export type MessageType = 'text' | 'file' | 'task' | 'query';

export interface BusMessage {
  message_id: string;
  from_agent: string;
  sender_type: 'agent' | 'user';
  to_agent: string;
  type: MessageType;
  content: string;
  sent_at: string;
  ref_id?: string;
  session_id?: string;
  file_id?: string;
  file_ids?: string[];
  file_name?: string;
  file_size?: number;
  caption?: string;
}

export interface OutboundMessage {
  to: string;
  type: MessageType;
  content: string;
  ref_id?: string;
  session_id?: string;
  file_id?: string;
  file_ids?: string[];
  caption?: string;
}

export interface SendResult {
  success: boolean;
  message_id?: string;
  error?: string;
}

export interface StoredMessage extends BusMessage {
  status: 'pending' | 'delivered' | 'read';
  delivered_at?: string;
  read_at?: string;
}

// ========== WebSocket 协议 ==========

export type WsFrameType = 'message' | 'ping' | 'pong' | 'ack' | 'error' | 'connected' | 'session_end';

export interface WsFrame {
  ws_type: WsFrameType;
  payload?: Record<string, unknown>;
  message_id?: string;
  code?: string;
  request_id?: string;
}

export interface WsAuthMessage {
  type: 'auth';
  agent_id: string;
  token: string;
}

// ========== REST API 请求/响应 ==========

export interface SendMessageRequest {
  from: string;
  to: string;
  type: MessageType;
  content: string;
  ref_id?: string;
  session_id?: string;
  file_id?: string;
  file_ids?: string[];
  caption?: string;
}

export interface InboxQuery {
  agent_id?: string;
  limit?: number;
  offset?: number;
  since?: string;
  /** 拉取后自动标记为已读（默认 false） */
  mark_read?: boolean;
}

export interface InboxResponse {
  messages: StoredMessage[];
  total: number;
  has_more: boolean;
}

// ========== 管理面板 API ==========

export interface AgentListItem {
  agent_id: string;
  display_name?: string;
  status: 'online' | 'offline' | 'busy';
  mode: 'websocket' | 'poll';
  last_heartbeat: string;
  connected_at: string;
  message_count: number;
}

export interface SystemStats {
  total_agents: number;
  online_agents: number;
  total_messages: number;
  total_files: number;
  storage_used_mb: number;
  messages_today: number;
  uptime_seconds: number;
  version: string;
}

export interface MessageLogQuery {
  agent_id?: string;
  limit?: number;
  offset?: number;
  since?: string;
  until?: string;
}

export interface MessageLogEntry {
  message_id: string;
  from_agent: string;
  to_agent: string;
  type: MessageType;
  content_preview: string;
  sent_at: string;
  status: 'pending' | 'delivered' | 'read';
}

// ========== 消息搜索 ==========

export interface MessageSearchRequest {
  agent_id?: string;
  type?: MessageType;
  keyword?: string;
  time_start?: string;
  time_end?: string;
  page?: number;
  page_size?: number;
}

export interface MessageSearchResponse {
  messages: StoredMessage[];
  total: number;
  page: number;
  page_size: number;
}

// ========== 文件 ==========

export interface FileInfo {
  file_id: string;
  file_name: string;
  file_size: number;
  uploaded_by: string;
  uploaded_at: string;
}

// ========== 配置 ==========

export interface BusServerConfig {
  httpPort: number;
  dbPath: string;
  adminToken: string;
  agentTokenSecret: string;
  heartbeatTimeoutSeconds: number;
  heartbeatCheckInterval: number;
  maxInboxMessages: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// ========== 工具类型 ==========

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data?: T;
}