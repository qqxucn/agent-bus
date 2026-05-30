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

        const raw = (await res.json()) as Record<string, unknown>;

        // 兼容多种收件箱响应格式：{ messages: [] } / { data: { messages: [] } } / { data: [] } / 数组
        let messages: BusMessage[] = [];
        const data = raw.data && typeof raw.data === 'object'
          ? (raw.data as Record<string, unknown>)
          : raw;

        if (Array.isArray(data)) {
          messages = data as BusMessage[];
        } else if (Array.isArray(raw)) {
          messages = raw as BusMessage[];
        } else if (data && 'messages' in data && Array.isArray(data.messages)) {
          messages = data.messages as BusMessage[];
        } else if ('messages' in raw && Array.isArray(raw.messages)) {
          messages = raw.messages as BusMessage[];
        }

        for (const msg of messages) {
          await this.messageMgr.handleMessage(msg);
        }

        hasMore = (data?.has_more === true) || (raw?.has_more === true);
        pageToken = (data?.next_page_token as string) || (raw?.next_page_token as string) || undefined;

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
