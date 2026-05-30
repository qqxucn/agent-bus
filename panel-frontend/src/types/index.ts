// ========================================================
// Agent 消息总线 — 管理面板 类型定义
// 与 bus-server types/index.ts 对齐
// ========================================================

/** Agent 信息（列表用） */
export interface AgentListItem {
  agent_id: string;
  display_name?: string;
  status: 'online' | 'offline' | 'busy';
  mode: 'websocket' | 'poll';
  last_heartbeat: string;
  connected_at: string;
  message_count: number;
}

/** 系统统计 */
export interface SystemStats {
  total_agents: number;
  online_agents: number;
  total_messages: number;
  messages_today: number;
  uptime_seconds: number;
  version: string;
}

/** 消息类型 */
export type MessageType = 'text' | 'file' | 'task' | 'query';

/** 消息状态 */
export type MessageStatus = 'pending' | 'delivered' | 'read';

/** 收件箱消息 */
export interface StoredMessage {
  message_id: string;
  from_agent: string;
  sender_type: 'agent' | 'user';
  to_agent: string;
  type: MessageType;
  content: string;
  status: MessageStatus;
  sent_at: string;
  delivered_at?: string;
  read_at?: string;
  ref_id?: string;
  session_id?: string;
  file_id?: string;
  file_ids?: string[];
  file_name?: string;
  file_size?: number;
  caption?: string;
}

/** 收件箱响应 */
export interface InboxResponse {
  messages: StoredMessage[];
  total: number;
  has_more: boolean;
}

/** 发送消息请求 */
export interface SendMessageRequest {
  from: string;
  to: string;
  type: MessageType;
  content: string;
  ref_id?: string;
  session_id?: string;
}

/** API 统一响应 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data?: T;
}

/** 健康检查响应 */
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'down';
  uptime: string;
  agents_online: number;
  agents_total: number;
}

/** 文件信息 */
export interface FileInfo {
  file_id: string;
  file_name: string;
  file_size: number;
  mode: string;
  uploaded_at: string;
  uploaded_by: string;
}

/** WS 帧类型 */
export type WsFrameType =
  | 'message'
  | 'ping'
  | 'pong'
  | 'ack'
  | 'error'
  | 'connected'
  | 'session_end';

/** WS 帧结构 */
export interface WsFrame {
  ws_type: WsFrameType;
  payload?: Record<string, unknown>;
  message_id?: string;
  code?: string;
  request_id?: string;
}

/** 消息日志条目 */
export interface MessageLogEntry {
  message_id: string;
  from_agent: string;
  to_agent: string;
  type: MessageType;
  content_preview: string;
  sent_at: string;
  status: MessageStatus;
}

/** 聊天会话 */
export interface ChatSession {
  agent_id: string;
  display_name: string;
  status: 'online' | 'offline' | 'busy';
  messages: StoredMessage[];
  has_more: boolean;
  loading: boolean;
}
