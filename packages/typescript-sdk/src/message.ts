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
