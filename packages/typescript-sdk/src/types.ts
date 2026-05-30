// ===== claw-bus TypeScript 版 — 核心类型定义 =====
// 对应规范：Agent 总线渠道插件规范 v1.1
// 对齐 Python 版 types.py

// ========== 配置 ==========

export interface BusChannelConfig {
  /** 连接模式 */
  mode: 'websocket' | 'poll';

  /** HTTP API 地址（两种模式都需要） */
  busUrl: string;

  /** WebSocket 地址（WS 模式需要） */
  busWsUrl?: string;

  /** 本 Agent 在总线上的身份标识（UTF-8） */
  agentId: string;

  /** 认证 Token */
  agentToken: string;

  /** 轮询间隔（秒），默认 3 */
  pollInterval?: number;

  /** 断线重连间隔（秒），默认 3，作为指数退避基数 */
  reconnectInterval?: number;

  /** 重连退避最大间隔（秒），默认 30 */
  maxReconnectInterval?: number;

  /** 最大重连次数，默认 10，超过停止重连 */
  maxReconnectAttempts?: number;

  /** 心跳间隔（秒），默认 30 */
  heartbeatInterval?: number;

  /** 文件传输模式 */
  fileMode?: FileMode;

  /** 沙箱 API 地址 */
  fileApiUrl?: string;

  /** 文件大小上限（MB） */
  maxFileSizeMb?: number;

  /** 共享目录路径 */
  shareDir?: string;

  /** 错误回调（重连失败、连接异常时触发） */
  onError?: ErrorCallback;

  /**
   * Token 已设置时跳过注册（默认 true）。
   * 启用时，agentToken 非空字符串就直接标记为已注册，不再调用 POST /api/agents/register。
   */
  skipRegistrationIfTokenSet?: boolean;
}

// ========== 消息 ==========

/** 入站消息（总线 → 插件 → Agent） */
export interface BusMessage {
  /** 消息唯一 ID（去重用） */
  message_id: string;

  /** 发送方 Agent ID（UTF-8） */
  from_agent: string;

  /** 发送方类型：agent=Agent 间通信, user=用户面板 */
  sender_type: 'agent' | 'user';

  /** 接收方 Agent ID（UTF-8） */
  to_agent: string;

  /** 消息类型 */
  type: 'text' | 'file' | 'task' | 'query';

  /** 消息内容（文本或文件引用） */
  content: string;

  /** ISO 8601 时间戳 */
  sent_at: string;

  /** 引用消息 ID（回复时使用） */
  ref_id?: string;

  /** 会话标识（支持多会话，不传=默认会话） */
  session_id?: string;

  // ===== 文件消息专有字段 =====
  /** 文件 ID（单文件） */
  file_id?: string;

  /** 文件 ID 列表（多文件） */
  file_ids?: string[];

  /** 文件名 */
  file_name?: string;

  /** 文件大小（字节） */
  file_size?: number;

  /** 文件描述/说明 */
  caption?: string;
}

/** 出站消息（Agent → 插件 → 总线） */
export interface OutboundMessage {
  /** 目标 Agent ID（UTF-8） */
  to: string;

  /** 消息类型 */
  type: 'text' | 'file' | 'task' | 'query';

  /** 消息内容 */
  content: string;

  /** 回复引用（可选） */
  ref_id?: string;

  /** 会话标识（可选，多会话支持） */
  session_id?: string;

  /** 文件 ID（单文件） */
  file_id?: string;

  /** 文件 ID 列表（多文件） */
  file_ids?: string[];

  /** 文件描述（文件消息时） */
  caption?: string;
}

/** 发送结果 */
export interface SendResult {
  success: boolean;
  message_id?: string;
  error?: string;
}

// ========== 插件接口 ==========

/**
 * BusChannelPlugin 核心接口。
 * 所有 Agent 统一实现此接口接入总线。
 */
export interface BusChannelPlugin {
  // ===== 生命周期 =====

  /** 连接到总线。返回是否连接成功。 */
  connect(config?: BusChannelConfig): Promise<boolean>;

  /** 断开与总线的连接。 */
  disconnect(): Promise<void>;

  /** 检查是否已连接。 */
  isConnected(): boolean;

  /** 返回本 Agent 在总线上的 ID。 */
  getAgentId(): string;

  // ===== 消息处理 =====

  /**
   * 设置消息处理器。
   * handler 收到消息后自行调用 send() 回复。
   * 插件只负责"收到消息通知你"，不负责帮你把回复发出去。
   */
  setMessageHandler(handler: (msg: BusMessage) => Promise<void>): void;

  /** 发送消息到总线。 */
  send(msg: OutboundMessage): Promise<SendResult>;

  /** 发送文件到总线（自动上传 + 发消息）。文件类型从扩展名自动推断。 */
  sendFile(to: string, filePath: string, caption?: string): Promise<SendResult>;
}

// ========== 文件传输 ==========

/** 文件传输模式 */
export type FileMode = 'sandbox' | 'base64' | 'share';

// ========== WebSocket 帧 ==========

/** WS 帧类型 */
export type WsFrameType = 'message' | 'ping' | 'pong' | 'ack' | 'error' | 'connected' | 'session_end';

/** WS 帧结构 */
export interface WsFrame {
  ws_type: WsFrameType;
  payload?: Record<string, unknown>;
  message_id?: string;
  code?: string;
  request_id?: string;
}

// ========== 错误类型 ==========

/** 总线认证错误（注册失败、Token 无效） */
export class BusAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusAuthError';
  }
}

/** 总线连接错误（建连失败、心跳超时、重连耗尽） */
export class BusConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusConnectionError';
  }
}

/** 总线文件传输错误（文件不存在、大小超限、上传失败） */
export class BusFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusFileError';
  }
}

// ========== 事件回调 ==========

/** 连接状态变化回调 */
export type ConnectionStateCallback = (state: 'connected' | 'disconnected' | 'reconnecting') => void;

/** 错误回调 */
export type ErrorCallback = (error: Error) => void;
