import { WebSocketServer, WebSocket, RawData } from 'ws';
import { createServer, Server as HttpServer } from 'http';
import { ConnectionPool } from './connection-pool.js';
import { Heartbeat } from './heartbeat.js';
import type { BusMessage, WsFrame, WsAuthMessage, ApiResponse } from '../types/index.js';
import type { AgentStore } from '../storage/agent-store.js';
import type { MessageStore } from '../storage/message-store.js';
import type { BusServerConfig } from '../types/index.js';
import { createHmac } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

export class WsGateway {
  private wss: WebSocketServer | null = null;
  private pool: ConnectionPool;
  private heartbeat: Heartbeat;
  private agentStore: AgentStore;
  private messageStore: MessageStore;
  private config: BusServerConfig;
  private readonly AUTH_TIMEOUT = 5000;

  constructor(
    pool: ConnectionPool,
    heartbeat: Heartbeat,
    agentStore: AgentStore,
    messageStore: MessageStore,
    config: BusServerConfig,
  ) {
    this.pool = pool;
    this.heartbeat = heartbeat;
    this.agentStore = agentStore;
    this.messageStore = messageStore;
    this.config = config;
  }

  start(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    this.heartbeat.start(this.config.heartbeatCheckInterval, this.config.heartbeatTimeoutSeconds);
  }

  stop(): void {
    this.heartbeat.stop();
    this.pool.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  async pushToAgent(agentId: string, message: BusMessage): Promise<boolean> {
    const ws = this.pool.getConnection(agentId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    return this.sendFrame(ws, {
      ws_type: 'message',
      request_id: uuidv4(),
      payload: message as unknown as Record<string, unknown>,
    });
  }

  private handleConnection(ws: WebSocket, req: import('http').IncomingMessage): void {
    // Try header auth first (SDK style)
    const auth = req.headers['authorization'];
    const agentIdHeader = req.headers['x-agent-id'] as string | undefined;

    if (auth && agentIdHeader) {
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
            const decodedId = decodeURIComponent(agentIdHeader);
      this.authenticate(ws, token, decodedId);
      return;
    }

    // Try query param fallback (browser)
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const tokenParam = url.searchParams.get('token');
    const agentIdParam = url.searchParams.get('agent_id');
    if (tokenParam && agentIdParam) {
      this.authenticate(ws, tokenParam, agentIdParam);
      return;
    }

    // Wait for auth frame
    this.waitForAuthMessage(ws);
  }

  private authenticate(ws: WebSocket, token: string, agentId: string): void {
    // Admin token bypass - agent not in DB, no token validation needed
    if (token === this.config.adminToken) {
      this.registerConnection(ws, agentId);
      return;
    }

    const agent = this.agentStore.getAgent(agentId);
    if (!agent) {
      this.sendFrame(ws, { ws_type: 'error', code: 'auth_failed', payload: { detail: 'agent not found' } });
      ws.close(4001, 'auth_failed');
      return;
    }

    const expectedToken = this.createAgentToken(agentId);
    if (token !== expectedToken) {
      this.sendFrame(ws, { ws_type: 'error', code: 'auth_failed', payload: { detail: 'invalid token' } });
      ws.close(4001, 'auth_failed');
      return;
    }

    this.registerConnection(ws, agentId);
  }

  private waitForAuthMessage(ws: WebSocket): void {
    const timer = setTimeout(() => {
      this.sendFrame(ws, { ws_type: 'error', code: 'auth_failed', payload: { detail: 'auth timeout' } });
      ws.close(4002, 'auth_timeout');
    }, this.AUTH_TIMEOUT);

    const onMsg = (data: RawData) => {
      try {
        const frame = JSON.parse(data.toString()) as any;
        if (frame.type === 'auth') {
          clearTimeout(timer);
          ws.off('message', onMsg);
          const auth = frame as WsAuthMessage;
          this.authenticate(ws, auth.token, auth.agent_id);
        }
      } catch { /* ignore parse errors */ }
    };
    ws.on('message', onMsg);
  }

  private registerConnection(ws: WebSocket, agentId: string): void {
    this.pool.register(agentId, ws);
    this.heartbeat.updateHeartbeat(agentId);
    // admin not in agent store, skip updateAgentStatus
    if (agentId !== 'admin') {
      this.agentStore.updateAgentStatus(agentId, 'online');
    }

    this.sendFrame(ws, { ws_type: 'connected', payload: { agent_id: agentId } });
    this.listenMessages(ws, agentId);
  }

  private listenMessages(ws: WebSocket, agentId: string): void {
    ws.on('message', async (data: RawData) => {
      try {
        const frame = JSON.parse(data.toString()) as WsFrame;
        await this.handleFrame(ws, frame, agentId);
      } catch {
        this.sendFrame(ws, { ws_type: 'error', code: 'invalid_format' }).catch(() => {});
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      console.log('[ws-gateway] Agent', agentId, 'closed: code=' + code + ' reason=' + reason.toString());
      this.pool.unregister(agentId);
      this.heartbeat.removeHeartbeat(agentId);
      this.agentStore.updateAgentStatus(agentId, 'offline');
    });

    ws.on('error', (err: Error) => {
      console.log('[ws-gateway] Agent', agentId, 'error:', err.message);
      this.pool.unregister(agentId);
      this.heartbeat.removeHeartbeat(agentId);
      this.agentStore.updateAgentStatus(agentId, 'offline');
    });
  }

  private async handleFrame(ws: WebSocket, frame: WsFrame, agentId: string): Promise<void> {
    switch (frame.ws_type) {
      case 'ping':
        await this.sendFrame(ws, { ws_type: 'pong' });
        this.heartbeat.updateHeartbeat(agentId);
        this.agentStore.updateHeartbeat(agentId);
        break;
      case 'pong':
        this.heartbeat.updateHeartbeat(agentId);
        this.agentStore.updateHeartbeat(agentId);
        break;
      case 'message':
        await this.handleIncomingMessage(ws, frame, agentId);
        break;
      case 'ack':
        if (frame.message_id) {
          // ack tracking - optional in v1
        }
        break;
    }
  }

  private async handleIncomingMessage(ws: WebSocket, frame: WsFrame, fromAgent: string): Promise<void> {
    const payload = frame.payload ?? {};
    const msg: BusMessage = {
      message_id: uuidv4(),
      from_agent: fromAgent,
      sender_type: 'agent',
      to_agent: (payload as any).to ?? '',
      type: (payload as any).type ?? 'text',
      content: (payload as any).content ?? '',
      sent_at: new Date().toISOString(),
      ref_id: (payload as any).ref_id,
      session_id: (payload as any).session_id,
    };

    if (!msg.to_agent) return;

    this.messageStore.saveMessage(msg);

    // Ack to sender
    await this.sendFrame(ws, {
      ws_type: 'ack',
      message_id: msg.message_id,
      request_id: frame.request_id,
    });

    // Push to target if online
    if (this.pool.isOnline(msg.to_agent)) {
      const targetWs = this.pool.getConnection(msg.to_agent);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        this.sendFrame(targetWs, {
          ws_type: 'message',
          request_id: uuidv4(),
          payload: msg as unknown as Record<string, unknown>,
        }).catch(() => {});
      }
    }
  }

  private createAgentToken(agentId: string): string {
    return createHmac('sha256', this.config.agentTokenSecret)
      .update(agentId)
      .digest('hex');
  }

  private async sendFrame(ws: WebSocket, frame: WsFrame): Promise<boolean> {
    return new Promise((resolve) => {
      if (ws.readyState !== WebSocket.OPEN) { resolve(false); return; }
      ws.send(JSON.stringify(frame), (err) => resolve(err === null));
    });
  }
}
