import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import { createMessageController } from '../../src/api/message-controller.js';
import type { BusServerConfig, BusMessage } from '../../src/types/index.js';

const TEST_CONFIG: BusServerConfig = {
  httpPort: 4322,
  dbPath: ':memory:',
  adminToken: 'admin-token',
  agentTokenSecret: 'test-secret',
  heartbeatTimeoutSeconds: 60,
  heartbeatCheckInterval: 15,
  maxInboxMessages: 200,
  logLevel: 'info',
};

function createMockMessageStore() {
  const messages = new Map<string, BusMessage>();

  return {
    saveMessage: vi.fn((msg: BusMessage) => {
      const id = msg.message_id || 'mock-id';
      messages.set(id, msg);
      return id;
    }),
    fetchInbox: vi.fn((query: any) => {
      const msgs = Array.from(messages.values())
        .filter((m) => m.to_agent === query.agent_id)
        .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())
        .slice(query.offset ?? 0, (query.offset ?? 0) + Math.min(query.limit ?? 50, 200));
      return {
        messages: msgs.map((m) => ({ ...m, status: 'delivered' as const })),
        total: messages.size,
        has_more: false,
      };
    }),
    getMessage: vi.fn((id: string) => {
      const m = messages.get(id);
      return m ? { ...m, status: 'pending' as const } : null;
    }),
    getMessageCount: vi.fn(() => messages.size),
    getFileCount: vi.fn(() => 0),
    getTodayCount: vi.fn(() => 0),
    getAgentMessageCount: vi.fn(() => 0),
    queryMessages: vi.fn(),
    searchMessages: vi.fn((query: any) => ({
      messages: [],
      total: 0,
      page: query.page ?? 1,
      page_size: query.page_size ?? 20,
    })),
  };
}

function createMockCore() {
  return {
    pushToAgent: vi.fn().mockResolvedValue(true),
    getAgentStatus: vi.fn((id: string) => 'offline'),
    getOnlineAgents: vi.fn(() => []),
  };
}

/**
 * Helper to make an HTTP request against an Express app without supertest.
 */
function request(app: express.Express, method: string, path: string, body?: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        return reject(new Error('Could not get server address'));
      }
      const port = addr.port;
      const options: http.RequestOptions = {
        hostname: 'localhost',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body ? Buffer.byteLength(JSON.stringify(body), 'utf8') : 0,
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode ?? 200, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 200, body: data });
          }
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  });
}

describe('MessageController', () => {
  let app: express.Express;
  let messageStore: ReturnType<typeof createMockMessageStore>;
  let core: ReturnType<typeof createMockCore>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    messageStore = createMockMessageStore();
    core = createMockCore();
    const controller = createMessageController(TEST_CONFIG, messageStore, core);
    app.use('/api/messages', controller);
  });

  describe('POST /api/messages/send', () => {
    it('should send a valid text message', async () => {
      const { status, body } = await request(app, 'POST', '/api/messages/send', {
        from: 'agent-sender',
        to: 'agent-receiver',
        type: 'text',
        content: 'Hello from test!',
      });
      expect(body.code).toBe(0);
      expect(body.data.success).toBe(true);
      expect(body.data.message_id).toBeTruthy();
      expect(messageStore.saveMessage).toHaveBeenCalledOnce();
    });

    it('should reject missing required fields', async () => {
      const { body } = await request(app, 'POST', '/api/messages/send', {
        from: 'agent-sender',
        to: 'agent-receiver',
      });
      expect(body.code).toBe(1002);
      expect(messageStore.saveMessage).not.toHaveBeenCalled();
    });

    it('should reject invalid message type', async () => {
      const { body } = await request(app, 'POST', '/api/messages/send', {
        from: 'agent-sender',
        to: 'agent-receiver',
        type: 'invalid-type',
        content: 'test',
      });
      expect(body.code).toBe(1002);
    });

    it('should reject message exceeding max length', async () => {
      const longContent = 'x'.repeat(65537);
      const { body } = await request(app, 'POST', '/api/messages/send', {
        from: 'agent-sender',
        to: 'agent-receiver',
        type: 'text',
        content: longContent,
      });
      expect(body.code).toBe(2001);
      expect(body.message).toBe('message_too_large');
    });

    it('should push to online agent if online', async () => {
      core.getAgentStatus.mockReturnValue('online');

      const { body } = await request(app, 'POST', '/api/messages/send', {
        from: 'agent-sender',
        to: 'online-agent',
        type: 'text',
        content: 'Push me!',
      });
      expect(body.code).toBe(0);
      expect(core.pushToAgent).toHaveBeenCalledWith('online-agent', expect.any(Object));
    });

    it('should not push to offline agent', async () => {
      core.getAgentStatus.mockReturnValue('offline');

      await request(app, 'POST', '/api/messages/send', {
        from: 'agent-sender',
        to: 'offline-agent',
        type: 'text',
        content: 'Do not push',
      });
      expect(core.pushToAgent).not.toHaveBeenCalled();
    });

    it('should handle file type messages', async () => {
      const { body } = await request(app, 'POST', '/api/messages/send', {
        from: 'agent-sender',
        to: 'agent-receiver',
        type: 'file',
        content: 'file content',
        file_id: 'file-abc',
        caption: 'My file',
        ref_id: 'ref-123',
        session_id: 'session-456',
      });
      expect(body.code).toBe(0);
      expect(messageStore.saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'file', file_id: 'file-abc', caption: 'My file' }),
      );
    });
  });

  describe('GET /api/messages/inbox', () => {
    it('should return inbox for an agent', async () => {
      await request(app, 'POST', '/api/messages/send', {
        from: 'sender',
        to: 'inbox-agent',
        type: 'text',
        content: 'Check your inbox!',
      });

      const { body } = await request(app, 'GET', '/api/messages/inbox?agent_id=inbox-agent');
      expect(body.code).toBe(0);
      expect(body.data.messages).toBeDefined();
    });

    it('should return error if agent_id is missing', async () => {
      const { body } = await request(app, 'GET', '/api/messages/inbox');
      expect(body.code).toBe(1002);
    });

    it('should respect limit and offset query params', async () => {
      const { body } = await request(app, 'GET', '/api/messages/inbox?agent_id=test-agent&limit=5&offset=10');
      expect(body.code).toBe(0);
      expect(messageStore.fetchInbox).toHaveBeenCalledWith(
        expect.objectContaining({ agent_id: 'test-agent', limit: 5, offset: 10 }),
      );
    });

    it('should pass since parameter', async () => {
      const since = '2024-01-01T00:00:00.000Z';
      const { body } = await request(app, 'GET', `/api/messages/inbox?agent_id=test-agent&since=${encodeURIComponent(since)}`);
      expect(body.code).toBe(0);
      expect(messageStore.fetchInbox).toHaveBeenCalledWith(
        expect.objectContaining({ since }),
      );
    });
  });

  describe('POST /api/messages/search', () => {
    it('should search messages', async () => {
      const { body } = await request(app, 'POST', '/api/messages/search', {
        keyword: 'test',
        page: 1,
        page_size: 20,
      });
      expect(body.code).toBe(0);
      expect(body.data).toBeDefined();
      expect(messageStore.searchMessages).toHaveBeenCalledWith({ keyword: 'test', page: 1, page_size: 20 });
    });

    it('should search with filters', async () => {
      const { body } = await request(app, 'POST', '/api/messages/search', {
        agent_id: 'agent-x',
        type: 'file',
        keyword: 'document',
        time_start: '2024-01-01T00:00:00.000Z',
        time_end: '2024-12-31T00:00:00.000Z',
      });
      expect(body.code).toBe(0);
      expect(messageStore.searchMessages).toHaveBeenCalledWith({
        agent_id: 'agent-x',
        type: 'file',
        keyword: 'document',
        time_start: '2024-01-01T00:00:00.000Z',
        time_end: '2024-12-31T00:00:00.000Z',
      });
    });
  });
});
