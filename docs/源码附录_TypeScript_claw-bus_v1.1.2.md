# 源码附录：claw-bus TypeScript 版（v1.1.2）

> 对应指南：`Agent消息总线_协议接口指南_v1.md`
> 版本：v1.1.2，与 Python 版 agent-bus-channel-plugin 功能对等
> 维护方：OpenClaw 团队（小绿）
> 测试：37/37 通过，协议对齐审查完成

---

## 目录

- [A.1 types.ts — 核心类型定义](#a1-typests--核心类型定义)
- [A.2 config.ts — 配置管理](#a2-configts--配置管理)
- [A.3 auth.ts — 认证注册](#a3-authts--认证注册)
- [A.4 message.ts — 消息管理](#a4-messagets--消息管理)
- [A.5 utils.ts — 文件工具](#a5-utilsts--文件工具)
- [A.6 file-transfer.ts — 文件传输](#a6-file-transferts--文件传输)
- [A.7 poll-connection.ts — HTTP 轮询](#a7-poll-connectionts--http-轮询)
- [A.8 ws-connection.ts — WebSocket](#a8-ws-connectionts--websocket)
- [A.9 index.ts — 工厂入口](#a9-indexts--工厂入口)

---

## A.1 types.ts — 核心类型定义

```typescript
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
```

---

## A.2 config.ts — 配置管理

```typescript
import type { BusChannelConfig } from './types';

/** 配置默认值 */
const DEFAULTS = {
  pollInterval: 3,
  reconnectInterval: 3,
  maxReconnectInterval: 30,
  maxReconnectAttempts: 10,
  heartbeatInterval: 30,
  fileMode: 'sandbox' as const,
  maxFileSizeMb: 10,
};

/**
 * 配置管理器。
 * 只负责验证和补全 BusChannelConfig 对象。
 * 不负责从文件/环境变量读取（那是集成层的事）。
 */
export class ConfigManager {
  /**
   * 验证并补全配置。
   * @throws 当必填字段缺失时抛出错误
   */
  validate(raw: Partial<BusChannelConfig>): BusChannelConfig {
    const errors: string[] = [];

    // 必填字段检查
    if (!raw.busUrl) errors.push('busUrl 是必填字段');
    if (!raw.agentId) errors.push('agentId 是必填字段');
    if (!raw.agentToken) errors.push('agentToken 是必填字段');

    if (errors.length > 0) {
      throw new Error(`配置错误：\n  - ${errors.join('\n  - ')}`);
    }

    // 模式校验
    if (raw.mode && !['websocket', 'poll'].includes(raw.mode)) {
      throw new Error(`配置错误：mode 必须是 "websocket" 或 "poll"，收到 "${raw.mode}"`);
    }

    // WS 模式下检查 busWsUrl
    const mode = raw.mode || 'websocket';
    if (mode === 'websocket' && !raw.busWsUrl) {
      throw new Error('配置错误：WS 模式下 busWsUrl 是必填字段');
    }

    // 补全默认值
    return {
      mode,
      busUrl: raw.busUrl!,
      busWsUrl: raw.busWsUrl,
      agentId: raw.agentId!,
      agentToken: raw.agentToken!,
      pollInterval: raw.pollInterval ?? DEFAULTS.pollInterval,
      reconnectInterval: raw.reconnectInterval ?? DEFAULTS.reconnectInterval,
      maxReconnectInterval: raw.maxReconnectInterval ?? DEFAULTS.maxReconnectInterval,
      maxReconnectAttempts: raw.maxReconnectAttempts ?? DEFAULTS.maxReconnectAttempts,
      heartbeatInterval: raw.heartbeatInterval ?? DEFAULTS.heartbeatInterval,
      fileMode: raw.fileMode ?? DEFAULTS.fileMode,
      fileApiUrl: raw.fileApiUrl,
      maxFileSizeMb: raw.maxFileSizeMb ?? DEFAULTS.maxFileSizeMb,
      shareDir: raw.shareDir,
      skipRegistrationIfTokenSet: raw.skipRegistrationIfTokenSet,
    };
  }
}
```

---

## A.3 auth.ts — 认证注册

```typescript
import { BusAuthError } from './types';

/**
 * 认证管理：Agent 注册 + Token 管理。
 */

interface RegisterResponse {
  agent_id?: string;
  token?: string;
  error?: string;
}

/**
 * AuthManager
 * 负责 Agent 在总线上的注册和 Header 构建。
 */
export class AuthManager {
  private _registered = false;
  private _token: string;
  private readonly _skipRegistrationIfTokenSet: boolean;

  private readonly _agentId: string;

  constructor(
    private readonly busUrl: string,
    agentId: string,
    agentToken: string,
    skipRegistrationIfTokenSet: boolean = true,
  ) {
    this._agentId = agentId;
    this._token = agentToken;
    this._skipRegistrationIfTokenSet = skipRegistrationIfTokenSet;
  }

  /** Agent ID */
  get agentId(): string {
    return this._agentId;
  }

  /** 当前有效的 Token */
  get token(): string {
    return this._token;
  }

  /** 是否已注册 */
  get registered(): boolean {
    return this._registered;
  }

  /**
   * 注册 Agent 到总线。
   *
   * 遇到 HTTP 409（Agent 已注册）时静默跳过，
   * 与 Python 版行为一致。
   *
   * 当 skipRegistrationIfTokenSet=true 且 agentToken 非空时，
   * 直接跳过注册（假设 Token 已由管理员预先配置）。
   */
  async register(): Promise<void> {
    // Token 已设置时跳过注册
    if (this._skipRegistrationIfTokenSet && this._token) {
      this._registered = true;
      return;
    }

    const url = `${this.busUrl}/api/agents/register`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: this.agentId,
        name: this.agentId,
        token: this._token,
      }),
    });

    if (res.status === 409) {
      // Agent 已注册，静默跳过
      this._registered = true;
      return;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new BusAuthError(`注册 Agent 失败 (${res.status}): ${body}`);
    }

    const data: RegisterResponse = (await res.json()) as RegisterResponse;
    if (data.error) {
      throw new BusAuthError(`注册 Agent 失败: ${data.error}`);
    }

    this._registered = true;
  }

  /**
   * 续期当前 Agent 的 Token。
   */
  async renewToken(adminToken: string): Promise<void> {
    const url = `${this.busUrl}/api/agents/${this.agentId}/token/renew`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: '{}',
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BusAuthError(`Token 续期失败 (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { token: string };
    this._token = data.token;
  }

  /**
   * 构建 HTTP 认证 Headers。
   * 符合规范：Authorization: Bearer <token>
   */
  buildAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this._token}`,
      'X-Agent-Id': this.agentId,
      'Content-Type': 'application/json',
    };
  }

  /**
   * 构建 WebSocket 连接的认证 Headers。
   *
   * Node.js 18+ 的 WebSocket 实现支持自定义 headers，
   * 不需要将 Token 暴露在 URL query 中。
   */
  buildWsAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this._token}`,
      'X-Agent-Id': this.agentId,
    };
  }
}
```

---

## A.4 message.ts — 消息管理

```typescript
import type { BusMessage } from './types';

/**
 * 简单 LRU 缓存，用于消息去重。
 * 保留最近 N 条 message_id。
 */
class LRUCache {
  private cache = new Map<string, number>();

  constructor(private readonly maxSize: number = 1000) {}

  has(key: string): boolean {
    return this.cache.has(key);
  }

  set(key: string): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, Date.now());
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

// =================================================================
// SessionContext
// =================================================================

/**
 * 会话上下文管理器。
 *
 * 按 (fromAgent, sessionId) 组合维护独立的会话上下文。
 * 不传 sessionId 时使用默认会话。
 * 不同发送方的相同 sessionId 不会冲突。
 */
export class SessionContext {
  private contexts = new Map<string, Record<string, unknown>>();

  private static makeKey(fromAgent: string, sessionId?: string): string {
    return `${fromAgent}::${sessionId || '__default__'}`;
  }

  /** 获取指定会话的上下文。不存在时自动创建空上下文。 */
  getContext(fromAgent: string, sessionId?: string): Record<string, unknown> {
    const key = SessionContext.makeKey(fromAgent, sessionId);
    if (!this.contexts.has(key)) {
      this.contexts.set(key, {});
    }
    return this.contexts.get(key)!;
  }

  /** 设置会话上下文（完整替换）。 */
  setContext(fromAgent: string, sessionId: string | undefined, data: Record<string, unknown>): void {
    const key = SessionContext.makeKey(fromAgent, sessionId);
    this.contexts.set(key, data);
  }

  /** 更新会话上下文（合并已有数据）。 */
  updateContext(fromAgent: string, sessionId: string | undefined, data: Record<string, unknown>): Record<string, unknown> {
    const ctx = this.getContext(fromAgent, sessionId);
    Object.assign(ctx, data);
    return ctx;
  }

  /** 结束指定会话，清除上下文。 */
  endSession(fromAgent: string, sessionId: string): void {
    const key = SessionContext.makeKey(fromAgent, sessionId);
    this.contexts.delete(key);
  }

  /** 当前活跃的会话数。 */
  get activeCount(): number {
    return this.contexts.size;
  }
}

// =================================================================
// MessageManager
// =================================================================

/**
 * MessageManager
 * 消息去重 + session_id 上下文管理。
 */
export class MessageManager {
  /** 消息去重缓存（最近 1000 条 message_id） */
  private dedupCache = new LRUCache(1000);

  /** 会话上下文管理器 */
  private sessions = new SessionContext();

  /** 用户设置的消息处理器 */
  private handler: ((msg: BusMessage) => Promise<void>) | null = null;

  // ===== 去重 =====

  /**
   * 检查消息是否重复。
   * 重复返回 true，首次见到返回 false 并标记已处理。
   */
  isDuplicate(messageId: string): boolean {
    if (this.dedupCache.has(messageId)) {
      return true;
    }
    this.dedupCache.set(messageId);
    return false;
  }

  /**
   * 清除去重缓存（用于测试或重连后重置）。
   */
  clearDedupCache(): void {
    this.dedupCache.clear();
  }

  // ===== 会话上下文 =====

  /** 获取 SessionContext 引用（供外部直接操作会话上下文）。 */
  get sessionContext(): SessionContext {
    return this.sessions;
  }

  // ===== 消息处理器 =====

  /**
   * 设置消息处理器。
   * 收到消息后会先去重，再交给 processor。
   */
  setMessageHandler(handler: (msg: BusMessage) => Promise<void>): void {
    this.handler = handler;
  }

  /**
   * 处理一条入站消息。
   * 先去重 → 非重复则更新会话上下文 → 交给 handler。
   */
  async handleMessage(msg: BusMessage): Promise<void> {
    if (this.isDuplicate(msg.message_id)) {
      return;
    }

    // 注册/刷新会话上下文
    if (msg.session_id) {
      this.sessions.getContext(msg.from_agent, msg.session_id);
    }

    if (this.handler) {
      await this.handler(msg);
    }
  }
}
```

---

## A.5 utils.ts — 文件工具

```typescript
// ===== claw-bus — 文件工具方法 =====
// 与 Python 版对齐：扩展名统一使用无点小写格式，如 "pdf" 而非 ".pdf"

/**
 * 判断文件扩展名是否属于总线支持的类型。
 */
export function isSupportedFileType(filePath: string): boolean {
  const supportedExtensions = new Set([
    // 文档
    'txt', 'md', 'json', 'xml', 'csv',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf',
    // 代码
    'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb',
    'sh', 'bat', 'ps1', 'sql', 'yaml', 'yml', 'toml', 'ini', 'cfg',
    // 媒体
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp',
    'mp3', 'wav', 'ogg', 'flac', 'aac',
    'mp4', 'mov', 'avi', 'mkv', 'webm',
    // 压缩
    'zip', 'tar', 'gz', '7z', 'rar',
  ]);

  const ext = getFileExtension(filePath);
  return supportedExtensions.has(ext);
}

/**
 * 获取文件扩展名（小写，无点）。
 * 例如 "report.pdf" → "pdf"，"image.JPG" → "jpg"。
 */
export function getFileExtension(filePath: string): string {
  const idx = filePath.lastIndexOf('.');
  if (idx === -1) return '';
  return filePath.slice(idx + 1).toLowerCase();
}
```

---

## A.6 file-transfer.ts — 文件传输

```typescript
import * as fs from 'node:fs/promises';
import type { BusChannelConfig, SendResult } from './types';
import { AuthManager } from './auth';

type FileMode = 'sandbox' | 'base64' | 'share';

/**
 * 文件传输管理器。
 *
 * 支持三种传输模式，由配置决定，Agent 无感知：
 * - sandbox：通过独立文件沙箱 API 上传/下载，安全隔离
 * - base64：BASE64 内嵌直传，无沙箱时的兜底方案
 * - share：共享目录（内网场景）
 *
 * 自动检测降级：沙箱不可用时降级为 BASE64。
 */
export class FileTransfer {
  private fileMode: FileMode;
  private fileApiUrl: string | undefined;
  private maxFileSizeMb: number;
  private shareDir: string | undefined;

  constructor(
    private readonly config: BusChannelConfig,
    private readonly auth: AuthManager,
  ) {
    this.fileMode = config.fileMode || 'sandbox';
    this.fileApiUrl = config.fileApiUrl;
    this.maxFileSizeMb = config.maxFileSizeMb || 10;
    this.shareDir = config.shareDir;
  }

  // =================================================================
  // 公开 API
  // =================================================================

  /**
   * 上传文件并发送给目标 Agent。
   */
  async sendFile(to: string, filePath: string, caption?: string): Promise<SendResult> {
    try {
      await fs.access(filePath);
      const fileName = filePath.split('/').pop() || 'unknown';

      const { fileId, error } = await this.upload(filePath, fileName);
      if (error) {
        return { success: false, error };
      }

      const url = `${this.config.busUrl}/api/messages/send`;
      const headers = this.auth.buildAuthHeaders();

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to,
          type: 'file',
          content: caption || fileName,
          file_id: fileId,
          caption,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return { success: false, error: `发送文件消息失败 (${res.status}): ${body}` };
      }

      const data = (await res.json()) as { message_id?: string };
      return { success: true, message_id: data.message_id };
    } catch (e) {
      return { success: false, error: `文件发送失败: ${String(e)}` };
    }
  }

  /**
   * 上传文件到总线。
   */
  async upload(filePath: string, fileName: string): Promise<{ fileId?: string; error?: string }> {
    const stat = await fs.stat(filePath);
    const fileSizeMb = stat.size / (1024 * 1024);

    const mode = this.detectMode(fileSizeMb);

    switch (mode) {
      case 'sandbox':
        return this.uploadViaSandbox(filePath, fileName);
      case 'base64':
        return this.uploadViaBase64(filePath, fileName);
      case 'share':
        return this.uploadViaShare(filePath, fileName);
    }
  }

  /**
   * 从总线下载文件。
   * 仅沙箱模式支持按 file_id 下载。
   */
  async download(fileId: string): Promise<{ data?: Buffer; error?: string }> {
    const mode = this.fileMode;

    if (mode === 'sandbox' && this.fileApiUrl) {
      return this.downloadViaSandbox(fileId);
    }

    if (mode === 'share') {
      return { error: '共享目录模式不支持按 file_id 下载，请直接访问共享目录' };
    }

    return { error: 'BASE64 直传模式下文件已内嵌在消息中，无需额外下载' };
  }

  // =================================================================
  // 模式选择
  // =================================================================

  /**
   * 检测使用的传输模式。
   * 沙箱不可用时自动降级。
   */
  private detectMode(fileSizeMb: number): FileMode {
    if (fileSizeMb > this.maxFileSizeMb) {
      if (this.shareDir) return 'share';
      if (this.fileApiUrl) return 'sandbox';
      return 'base64';
    }

    if (this.fileMode === 'sandbox' && this.fileApiUrl) return 'sandbox';
    if (this.fileMode === 'share' && this.shareDir) return 'share';

    return 'base64';
  }

  // =================================================================
  // 方式A：沙箱传输
  // =================================================================

  private async uploadViaSandbox(filePath: string, fileName: string): Promise<{ fileId?: string; error?: string }> {
    if (!this.fileApiUrl) {
      return { error: '沙箱 API 地址未配置' };
    }

    try {
      const fileBuffer = await fs.readFile(filePath);
      const url = `${this.fileApiUrl}/api/files/upload`;
      const headers = this.auth.buildAuthHeaders();

      const formData = new FormData();
      const blob = new Blob([fileBuffer]);
      formData.append('file', blob as unknown as string, fileName);

      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: headers.Authorization },
        body: formData as unknown as string,
      });

      if (!res.ok) {
        const body = await res.text();
        return { error: `沙箱上传失败 (${res.status}): ${body}` };
      }

      const data = (await res.json()) as { file_id?: string };
      return { fileId: data.file_id };
    } catch (e) {
      return { error: `沙箱上传异常: ${String(e)}` };
    }
  }

  private async downloadViaSandbox(fileId: string): Promise<{ data?: Buffer; error?: string }> {
    if (!this.fileApiUrl) {
      return { error: '沙箱 API 地址未配置' };
    }

    try {
      const url = `${this.fileApiUrl}/api/files/${fileId}`;
      const headers = this.auth.buildAuthHeaders();

      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: headers.Authorization },
      });

      if (!res.ok) {
        const body = await res.text();
        return { error: `沙箱下载失败 (${res.status}): ${body}` };
      }

      const buffer = Buffer.from(new Uint8Array(await res.arrayBuffer()));
      return { data: buffer };
    } catch (e) {
      return { error: `沙箱下载异常: ${String(e)}` };
    }
  }

  // =================================================================
  // 方式B：BASE64 直传
  // =================================================================

  private async uploadViaBase64(filePath: string, fileName: string): Promise<{ fileId?: string; error?: string }> {
    try {
      const fileBuffer = await fs.readFile(filePath);
      const base64Content = fileBuffer.toString('base64');

      const url = `${this.config.busUrl}/api/files/upload`;
      const headers = this.auth.buildAuthHeaders();

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          file_name: fileName,
          content: base64Content,
          encoding: 'base64',
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return { error: `BASE64 上传失败 (${res.status}): ${body}` };
      }

      const data = (await res.json()) as { file_id?: string };
      return { fileId: data.file_id };
    } catch (e) {
      return { error: `BASE64 上传异常: ${String(e)}` };
    }
  }

  // =================================================================
  // 方式C：共享目录
  // =================================================================

  private async uploadViaShare(filePath: string, fileName: string): Promise<{ fileId?: string; error?: string }> {
    if (!this.shareDir) {
      return { error: '共享目录未配置' };
    }

    try {
      const destPath = `${this.shareDir}/${fileName}`;
      await fs.cp(filePath, destPath);
      return { fileId: `share://${fileName}` };
    } catch (e) {
      return { error: `共享目录复制失败: ${String(e)}` };
    }
  }
}
```

---

## A.7 poll-connection.ts — HTTP 轮询

```typescript
import type { BusChannelConfig, BusMessage, OutboundMessage, SendResult } from './types';
import { AuthManager } from './auth';
import { MessageManager } from './message';

/**
 * HTTP 轮询连接管理器。
 * 负责：定时拉取收件箱、分页处理、逐条消息派发、独立心跳。
 */
export class PollConnection {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _isRunning = false;

  constructor(
    private readonly config: BusChannelConfig,
    private readonly auth: AuthManager,
    private readonly messageMgr: MessageManager,
  ) {}

  // ========== 启动/停止 ==========

  async start(): Promise<void> {
    this._isRunning = true;

    // 启动前先检查心跳，确保总线可访问
    const ok = await this.ping();
    if (!ok) {
      this._isRunning = false;
      throw new Error('总线心跳检查失败，无法建立轮询连接');
    }

    // 立即拉取一次
    await this.pollOnce();

    // 定时轮询
    const pollInterval = (this.config.pollInterval || 3) * 1000;
    this.pollTimer = setInterval(() => {
      this.pollOnce().catch((e) => {
        console.error(`[claw-bus] 轮询错误: ${String(e)}`);
      });
    }, pollInterval);

    // 独立心跳（验证总线存活）
    const heartbeatInterval = (this.config.heartbeatInterval || 30) * 1000;
    this.heartbeatTimer = setInterval(async () => {
      try {
        const ok = await this.ping();
        if (!ok) {
          console.warn('[claw-bus] 轮询心跳失败');
        }
      } catch (e) {
        console.error(`[claw-bus] 轮询心跳异常: ${String(e)}`);
      }
    }, heartbeatInterval);
  }

  async stop(): Promise<void> {
    this._isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  // ========== 消息 ==========

  onMessage(_handler: (msg: BusMessage) => Promise<void>): void {
    // handler 统一通过 messageMgr.setMessageHandler() 接入
  }

  /**
   * 通过 HTTP POST 发送出站消息。
   * 请求体中包含 from 字段（总线据此识别发送方）。
   */
  async sendOutbound(msg: OutboundMessage): Promise<SendResult> {
    try {
      const url = `${this.config.busUrl}/api/messages/send`;
      const headers = this.auth.buildAuthHeaders();

      // 出站消息必须包含 from 字段
      const body = {
        ...msg,
        from: this.auth.agentId,
      };

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const body = await res.text();
        return { success: false, error: `HTTP ${res.status}: ${body}` };
      }

      const data = (await res.json()) as { message_id?: string };
      return {
        success: true,
        message_id: data.message_id,
      };
    } catch (e) {
      return { success: false, error: `发送失败: ${String(e)}` };
    }
  }

  // ========== 内部 ==========

  /**
   * 单次轮询：拉取收件箱 → 逐条处理 → 分页。
   *
   * HTTP 失败时会进行指数退避重试（最多 3 次），
   * 避免总线临时离线时密集请求。
   */
  private async pollOnce(): Promise<void> {
    if (!this._isRunning) return;

    let pageToken: string | undefined;
    let hasMore = true;
    let retries = 0;
    const maxRetries = 3;

    while (hasMore) {
      const limit = 20;
      const url = `${this.config.busUrl}/api/messages/inbox?limit=${limit}&mark_read=true${pageToken ? `&page_token=${pageToken}` : ''}`;
      const headers = this.auth.buildAuthHeaders();

      try {
        const res = await fetch(url, { headers });

        if (!res.ok) {
          const body = await res.text();
          // 非认证错误（401/403 需要上报，不重试）
          if (res.status === 401 || res.status === 403) {
            throw new Error(`拉取收件箱认证失败 (${res.status})`);
          }
          throw new Error(`拉取收件箱失败 (${res.status}): ${body}`);
        }

        // 成功后重置重试计数
        retries = 0;

        const data = (await res.json()) as { messages?: BusMessage[]; has_more?: boolean; next_page_token?: string };
        const messages: BusMessage[] = data.messages || [];

        for (const msg of messages) {
          await this.messageMgr.handleMessage(msg);
        }

        hasMore = data.has_more === true;
        pageToken = data.next_page_token;

        if (messages.length === 0) {
          hasMore = false;
        }
      } catch (e) {
        // 401/403 不重试，直接抛出
        const errMsg = e instanceof Error ? e.message : String(e);
        if (errMsg.includes('认证失败')) {
          throw e;
        }

        // 指数退避重试（最多 maxRetries 次）
        if (retries < maxRetries) {
          retries++;
          const backoff = Math.min(1000 * Math.pow(2, retries), 8000);
          console.warn(`[claw-bus] 轮询拉取失败，${backoff / 1000} 秒后重试 (第 ${retries}/${maxRetries} 次): ${errMsg}`);
          await this.sleep(backoff);
          continue; // 重试当前页
        }

        // 重试耗尽，记录日志但不 throw（下次 setInterval 会再试）
        console.error(`[claw-bus] 轮询拉取失败，放弃重试: ${errMsg}`);
        hasMore = false;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 心跳：GET /api/ping。
   * 返回 true 表示总线存活。
   */
  private async ping(): Promise<boolean> {
    try {
      const url = `${this.config.busUrl}/api/ping`;
      const headers = this.auth.buildAuthHeaders();
      const res = await fetch(url, { headers });
      return res.ok;
    } catch {
      return false;
    }
  }
}
```

---

## A.8 ws-connection.ts — WebSocket

```typescript
import WebSocket from 'ws';
import type { BusChannelConfig, OutboundMessage, SendResult, WsFrame, BusMessage } from './types';
import { BusConnectionError } from './types';
import { AuthManager } from './auth';
import { MessageManager } from './message';

/**
 * WebSocket 连接管理器。
 *
 * 核心职责：
 * 1. 建立/断开 WS 连接（Token 通过 headers 传递）
 * 2. 等待 connected 帧认证
 * 3. 消息监听与分发
 * 4. 心跳保活（30 秒间隔，10 秒 pong 超时，3 次失败断线）
 * 5. 断线自动重连（指数退避 + async while 循环 + 次数上限）
 */
export class WsConnection {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutivePongMisses = 0;
  private shouldReconnect = true;
  private reconnectAttempts = 0;

  /** 重连循环的 Promise 引用（用于并发控制） */
  private reconnectLoopPromise: Promise<void> | null = null;

  /** 显式跟踪连接状态，避免依赖 readyState 黑盒 */
  private _isConnected = false;

  /** 待确认的 ack（requestId → resolve/reject/timer） */
  private pendingAcks = new Map<string, {
    resolve: (result: SendResult) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private readonly config: BusChannelConfig,
    private readonly auth: AuthManager,
    private readonly messageMgr: MessageManager,
  ) {}

  /** 是否已连接 */
  get connected(): boolean {
    return this._isConnected;
  }

  // ========== 连接 ==========

  /**
   * 建立 WebSocket 连接。
   *
   * 时序：建连（headers 传 Token）→ 等待服务端 connected 帧确认 → resolve
   * 超时：10 秒未确认则 reject
   */
  async connect(): Promise<void> {
    const url = this.config.busWsUrl;
    if (!url) {
      throw new BusConnectionError('WebSocket URL 未配置 (busWsUrl)');
    }

    const wsHeaders = this.auth.buildWsAuthHeaders();
    this.ws = new WebSocket(url, { headers: wsHeaders });

    return new Promise<void>((resolve, reject) => {
      const ws = this.ws!;
      const timeout = setTimeout(() => {
        if (!this._isConnected) {
          ws.close();
          reject(new BusConnectionError('WebSocket 连接超时（10秒）'));
        }
      }, 10000);

      const cleanup = () => {
        if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return;
        ws.off('open', onOpen);
        ws.off('close', onClose);
        ws.off('error', onError);
        ws.off('message', onMessage);
      };

      const onOpen = () => {
        // 不直接 resolve，等待 connected 帧确认
      };

      const onClose = () => {
        cleanup();
        clearTimeout(timeout);
        this._isConnected = false;
        this.stopHeartbeat();
      };

      const onError = (err: Error) => {
        cleanup();
        clearTimeout(timeout);
        this.ws?.close();
        reject(new BusConnectionError(`WebSocket 连接失败: ${err.message}`));
      };

      const onMessage = (data: string) => {
        try {
          const frame: WsFrame = JSON.parse(data);

          // 等待 connected 帧
          if (frame.ws_type === 'connected') {
            cleanup();
            clearTimeout(timeout);
            this._isConnected = true;
            this.consecutivePongMisses = 0;
            this.reconnectAttempts = 0;

            // 重新注册 close/error 监听，确保断线后能感知
            this.ws!.on('close', this.handleDisconnectBound);
            this.ws!.on('error', this.handleDisconnectBound);

            // 收完 connected 后再注册常规消息监听
            this.ws!.on('message', this.handleMessageBound);
            this.startHeartbeat();
            resolve();
            return;
          }

          // connected 之前收到其他帧 → 拒绝
          if (!this._isConnected) {
            cleanup();
            clearTimeout(timeout);
            this.ws?.close();
            reject(new BusConnectionError(
              `WS 认证失败：期望 connected 帧，收到 ${frame.ws_type}`,
            ));
          }
        } catch {
          // 解析失败，暂不处理
        }
      };

      ws.on('open', onOpen);
      ws.on('close', onClose);
      ws.on('error', onError);
      ws.on('message', onMessage);
    });
  }

  private handleMessageBound = (data: string): void => {
    this.handleFrame(data);
  };

  private handleDisconnectBound = (): void => {
    console.log('[claw-bus] 连接断开');
    this._isConnected = false;
    this.stopHeartbeat();
    if (this.shouldReconnect) {
      this.startReconnectLoop().catch((e) => {
        console.error('[claw-bus] 重连循环异常退出:', e);
      });
    }
  };

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, '正常关闭');
      this.ws = null;
    }
    this._isConnected = false;
  }

  // ========== 消息处理 ==========

  onMessage(handler: (msg: BusMessage) => Promise<void>): void {
    // handler 统一通过 messageMgr.setMessageHandler() 设置
  }

  /**
   * 通过 WS 发送出站消息。
   * 携带 request_id，等待 ack 帧获取 message_id（10 秒超时兜底）。
   */
  async sendOutbound(msg: OutboundMessage): Promise<SendResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: 'WebSocket 未连接' };
    }

    const requestId = crypto.randomUUID();

    const frame = {
      ws_type: 'message',
      request_id: requestId,
      payload: msg as unknown as Record<string, unknown>,
    };

    try {
      this.ws.send(JSON.stringify(frame));
    } catch (e) {
      return { success: false, error: `发送失败: ${String(e)}` };
    }

    // 等待 ack（10 秒超时兜底，超时视为成功但无 message_id）
    return new Promise<SendResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(requestId);
        resolve({ success: true });
      }, 10000);

      this.pendingAcks.set(requestId, {
        resolve: (result) => {
          clearTimeout(timer);
          this.pendingAcks.delete(requestId);
          resolve(result);
        },
        reject: () => {
          clearTimeout(timer);
          this.pendingAcks.delete(requestId);
          resolve({ success: true });
        },
        timer,
      });
    });
  }

  // ========== 帧处理 ==========

  private handleFrame(rawData: string): void {
    try {
      const frame: WsFrame = JSON.parse(rawData);

      switch (frame.ws_type) {
        case 'message':
          this.handleMessageFrame(frame.payload as unknown as BusMessage);
          break;
        case 'ping':
          this.ws?.send(JSON.stringify({ ws_type: 'pong' }));
          break;
        case 'pong':
          this.handlePong();
          break;
        case 'connected':
          break;
        case 'ack': {
          const ackRequestId = frame.request_id;
          if (ackRequestId && this.pendingAcks.has(ackRequestId)) {
            const pending = this.pendingAcks.get(ackRequestId)!;
            pending.resolve({
              success: true,
              message_id: frame.message_id,
            });
          }
          break;
        }
        case 'error':
          console.error(`[claw-bus] 总线错误: ${frame.code} - ${frame.message_id}`);
          break;
        default:
          console.warn(`[claw-bus] 未知帧类型: ${frame.ws_type}`);
      }
    } catch (e) {
      console.error(`[claw-bus] 帧解析失败: ${String(e)}, 原始数据: ${rawData}`);
    }
  }

  private handleMessageFrame(msg: BusMessage): void {
    this.messageMgr.handleMessage(msg).catch((e) => {
      console.error('[claw-bus] 消息处理失败:', e);
    });
  }

  // ========== 心跳 ==========

  private startHeartbeat(): void {
    const interval = (this.config.heartbeatInterval || 30) * 1000;

    this.heartbeatTimer = setInterval(() => {
      this.sendPing();
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({ ws_type: 'ping' }));

    this.pongTimer = setTimeout(() => {
      this.consecutivePongMisses++;
      console.warn(`[claw-bus] 心跳超时 (第 ${this.consecutivePongMisses} 次)`);

      if (this.consecutivePongMisses >= 3) {
        console.error('[claw-bus] 连续 3 次心跳超时，判定断线');
        this.ws?.close(4000, '心跳超时');
      }
    }, 10000);
  }

  private handlePong(): void {
    this.consecutivePongMisses = 0;
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  // ========== 重连 ==========

  /**
   * 启动重连循环（async while 替代递归回调）。
   *
   * 每次重连尝试间 await sleep(backoff)，可被 disconnect()
   * 通过 shouldReconnect = false 干净打断。
   */
  private async startReconnectLoop(): Promise<void> {
    if (this.reconnectLoopPromise) return;

    this.reconnectAttempts = 0;
    this.reconnectLoopPromise = this.runReconnectLoop();

    try {
      await this.reconnectLoopPromise;
    } finally {
      this.reconnectLoopPromise = null;
    }
  }

  private async runReconnectLoop(): Promise<void> {
    while (this.shouldReconnect) {
      const maxAttempts = this.config.maxReconnectAttempts || 10;
      if (this.reconnectAttempts >= maxAttempts) {
        const err = new BusConnectionError(
          `重连已达上限 (${maxAttempts}次)，停止重连`,
        );
        console.error(`[claw-bus] ${err.message}`);
        this.config.onError?.(err);
        this.shouldReconnect = false;
        break;
      }

      const baseIntervalMs = Math.max(
        (this.config.reconnectInterval || 3) * 1000,
        1000,
      );
      const maxIntervalMs = (this.config.maxReconnectInterval || 30) * 1000;
      const backoff = Math.min(
        baseIntervalMs * Math.pow(2, this.reconnectAttempts),
        maxIntervalMs,
      );

      this.reconnectAttempts++;
      console.log(
        `[claw-bus] ${backoff / 1000} 秒后重连... (第 ${this.reconnectAttempts} 次)`,
      );

      await this.sleep(backoff);

      if (!this.shouldReconnect) break;

      try {
        await this.connect();
        console.log('[claw-bus] 重连成功');
        break;
      } catch (e) {
        console.warn(`[claw-bus] 重连失败: ${String(e)}`);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

---

## A.9 index.ts — 工厂入口

```typescript
/**
 * claw-bus TypeScript 版 — 工厂入口
 *
 * createBusPlugin() 组装所有模块，返回 BusChannelPlugin 实例。
 * 通用层，不依赖 OpenClaw SDK。
 */

import type { BusChannelConfig, BusChannelPlugin, BusMessage, OutboundMessage, SendResult } from './types';
import { ConfigManager } from './config';
import { AuthManager } from './auth';
import { MessageManager } from './message';
import { WsConnection } from './ws-connection';
import { PollConnection } from './poll-connection';
import { FileTransfer } from './file-transfer';

export { ConfigManager } from './config';
export { AuthManager } from './auth';
export { MessageManager } from './message';
export { SessionContext } from './message';
export { WsConnection } from './ws-connection';
export { PollConnection } from './poll-connection';
export { FileTransfer } from './file-transfer';
export { isSupportedFileType, getFileExtension } from './utils';

export type {
  BusChannelConfig,
  BusChannelPlugin,
  BusMessage,
  OutboundMessage,
  SendResult,
  FileMode,
  WsFrame,
  WsFrameType,
  ConnectionStateCallback,
  ErrorCallback,
} from './types';

/**
 * 创建 BusChannelPlugin 实例。
 * 根据 mode 自动选择 WS 或 HTTP 轮询连接。
 */
export function createBusPlugin(config: BusChannelConfig): BusChannelPlugin {
  const configMgr = new ConfigManager();
  let validatedConfig = configMgr.validate(config);

  let auth = new AuthManager(
    validatedConfig.busUrl,
    validatedConfig.agentId,
    validatedConfig.agentToken,
    validatedConfig.skipRegistrationIfTokenSet,
  );
  let messageMgr = new MessageManager();
  let fileTransfer = new FileTransfer(validatedConfig, auth);
  let connection: WsConnection | PollConnection;

  function initConnection(cfg: BusChannelConfig): void {
    if (cfg.mode === 'websocket') {
      connection = new WsConnection(cfg, auth, messageMgr);
    } else {
      connection = new PollConnection(cfg, auth, messageMgr);
    }
  }

  initConnection(validatedConfig);

  let userHandler: ((msg: BusMessage) => Promise<void>) | null = null;

  messageMgr.setMessageHandler(async (msg) => {
    if (userHandler) {
      await userHandler(msg);
    }
  });

  return {
    async connect(overrideConfig?: BusChannelConfig): Promise<boolean> {
      try {
        if (overrideConfig) {
          validatedConfig = configMgr.validate(overrideConfig);
          auth = new AuthManager(
            validatedConfig.busUrl,
            validatedConfig.agentId,
            validatedConfig.agentToken,
            validatedConfig.skipRegistrationIfTokenSet,
          );
          messageMgr = new MessageManager();
          fileTransfer = new FileTransfer(validatedConfig, auth);
          initConnection(validatedConfig);
          messageMgr.setMessageHandler(async (msg) => {
            if (userHandler) await userHandler(msg);
          });
        }

        await auth.register();
        if (validatedConfig.mode === 'websocket') {
          await (connection as WsConnection).connect();
        } else {
          await (connection as PollConnection).start();
        }
        return true;
      } catch (e) {
        const errorMsg = `连接失败: ${String(e)}`;
        console.error(`[claw-bus] ${errorMsg}`);
        validatedConfig.onError?.(new Error(errorMsg));
        return false;
      }
    },

    async disconnect(): Promise<void> {
      try {
        if (validatedConfig.mode === 'websocket') {
          await (connection as WsConnection).disconnect();
        } else {
          await (connection as PollConnection).stop();
        }
      } catch (e) {
        console.error(`[claw-bus] 断开连接失败: ${String(e)}`);
      }
    },

    isConnected(): boolean {
      if (validatedConfig.mode === 'websocket') {
        return (connection as WsConnection).connected;
      }
      return (connection as PollConnection).isRunning;
    },

    getAgentId(): string {
      return validatedConfig.agentId;
    },

    setMessageHandler(handler: (msg: BusMessage) => Promise<void>): void {
      userHandler = handler;
    },

    async send(msg: OutboundMessage): Promise<SendResult> {
      return connection.sendOutbound(msg);
    },

    async sendFile(to: string, filePath: string, caption?: string): Promise<SendResult> {
      return fileTransfer.sendFile(to, filePath, caption);
    },
  };
}
```
