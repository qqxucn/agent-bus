/**
 * WebSocket 客户端
 * 负责面板与总线之间的实时通信
 */
import { CONFIG } from '../config';
import type { WsFrame, StoredMessage } from '../types';

export type WsMessageHandler = (msg: StoredMessage) => void;
export type WsStatusHandler = (status: 'connected' | 'disconnected' | 'reconnecting') => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  private messageHandler: WsMessageHandler | null = null;
  private statusHandler: WsStatusHandler | null = null;

  onMessage(handler: WsMessageHandler): void {
    this.messageHandler = handler;
  }

  onStatusChange(handler: WsStatusHandler): void {
    this.statusHandler = handler;
  }

  /** 建立 WebSocket 连接 */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.destroyed = false;

    const token = localStorage.getItem('admin_token');
    if (!token) return;

    const url = `${CONFIG.wsUrl}?token=${encodeURIComponent(token)}&agent_id=${CONFIG.adminAgentId}`;

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.statusHandler?.('connected');
      // 启动心跳
      this.startPing();
    };

    this.ws.onmessage = (event) => {
      try {
        const frame: WsFrame = JSON.parse(event.data);
        this.handleFrame(frame);
      } catch {
        // ignore malformed frames
      }
    };

    this.ws.onclose = () => {
      this.stopPing();
      if (!this.destroyed) {
        this.statusHandler?.('disconnected');
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose 会触发，不需要重复处理
    };
  }

  /** 断开连接 */
  disconnect(): void {
    this.destroyed = true;
    this.clearReconnect();
    this.stopPing();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private handleFrame(frame: WsFrame): void {
    switch (frame.ws_type) {
      case 'message':
        if (frame.payload && this.messageHandler) {
          this.messageHandler(frame.payload as unknown as StoredMessage);
        }
        break;
      case 'ping':
        // 回复 pong
        this.sendFrame({ ws_type: 'pong' });
        break;
      case 'pong':
        // 心跳成功，无事可做
        break;
      case 'connected':
        // 连接确认，无事可做
        break;
      case 'error':
        console.warn('[WS] 收到错误帧:', frame.code, frame.payload);
        break;
      default:
        break;
    }
  }

  private sendFrame(frame: WsFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.sendFrame({ ws_type: 'ping' });
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.clearReconnect();
    if (this.reconnectAttempt >= CONFIG.wsReconnectMaxAttempts) {
      console.warn('[WS] 重连次数已达上限');
      return;
    }
    const delay = Math.min(
      CONFIG.wsReconnectInitial * Math.pow(CONFIG.wsReconnectFactor, this.reconnectAttempt),
      CONFIG.wsReconnectMax,
    );
    this.reconnectAttempt++;
    this.statusHandler?.('reconnecting');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
