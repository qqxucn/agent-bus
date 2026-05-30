import WebSocket from 'ws';
import type { BusChannelConfig, OutboundMessage, SendResult, WsFrame, BusMessage } from './types';
import { BusConnectionError } from './types';
import { AuthManager } from './auth';
import { MessageManager } from './message';

/**
 * WebSocket 连接管理器。
 *
 * 核心职责：
 * 1. 建立/断开 WS 连接（Token 通过 headers 传递，不暴露在 URL 中）
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
   * 超时：10 秒未确认则 reject 并抛出 BusConnectionError
   */
  async connect(): Promise<void> {
    const url = this.config.busWsUrl;
    if (!url) {
      throw new BusConnectionError('WebSocket URL 未配置 (busWsUrl)');
    }

    // 通过 headers 传递认证信息，不暴露在 URL query 中
    const wsHeaders = this.auth.buildWsAuthHeaders();
    this.ws = new WebSocket(url, { headers: wsHeaders });

    return new Promise<void>((resolve, reject) => {
      const ws = this.ws!; // 在 promise 闭包内取本地引用，避免 TS 的空值报错
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

      // 绑定临时一次性的消息监听（仅用于 connected 帧握手）
      ws.on('open', onOpen);
      ws.on('close', onClose);
      ws.on('error', onError);
      ws.on('message', onMessage);
    });
  }

  /**
   * 绑定的消息分发处理器（connect 成功后注册）。
   * ws 包的 message 事件传递原始数据字符串，不含 MessageEvent 包装。
   */
  private handleMessageBound = (data: string): void => {
    this.handleFrame(data);
  };

  /**
   * 绑定的断线处理（connected 确认后注册）。
   */
  private handleDisconnectBound = (): void => {
    console.log('[claw-bus] 连接断开');
    this._isConnected = false;
    this.stopHeartbeat();
    if (this.shouldReconnect) {
      // 启动重连循环（不 await，不阻塞 disconnect）
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
    // 此处不再需要，保持接口兼容
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
      payload: {
        ...msg,
        from: this.auth.agentId,
      } as Record<string, unknown>,
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
          resolve({ success: true }); // reject 也降级为 success
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
          // 回复 pong（服务端发起的心跳探测）
          this.ws?.send(JSON.stringify({ ws_type: 'pong' }));
          break;
        case 'pong':
          this.handlePong();
          break;
        case 'connected':
          // 连接确认，connect() 中已处理
          break;
        case 'ack': {
          // 消息确认，按 request_id 查找并 resolve
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
    // handleMessage 内部完成去重 + handler 调用
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

    // 设置 pong 超时定时器（10 秒）
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
   * 启动重连循环（async while 替代之前的递归 + setTimeout）。
   *
   * 每次重连尝试间 await sleep(backoff)，可被 disconnect() 通过
   * shouldReconnect = false 干净打断。
   */
  private async startReconnectLoop(): Promise<void> {
    // 如果已有重连循环在运行，不重复启动
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
        1000, // 下限 1 秒保护，防止用户设为 0 时无限快速重连
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

      // sleep 期间可能被 disconnect() 取消
      if (!this.shouldReconnect) break;

      try {
        await this.connect();
        console.log('[claw-bus] 重连成功');
        break; // 成功则退出循环
      } catch (e) {
        console.warn(`[claw-bus] 重连失败: ${String(e)}`);
        // 继续循环，尝试下一次
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
