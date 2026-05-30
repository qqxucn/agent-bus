import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import { createAgentController } from '../../src/api/agent-controller.js';
import type { BusServerConfig, AgentInfo, AgentListItem } from '../../src/types/index.js';

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

function createMockAgentStore() {
  const agents = new Map<string, AgentInfo>();

  return {
    saveAgent: vi.fn((agent: AgentInfo) => {
      agents.set(agent.agent_id, agent);
    }),
    getAgent: vi.fn((id: string) => agents.get(id) ?? null),
    listAgents: vi.fn(() => {
      return Array.from(agents.values()).map((a) => ({
        agent_id: a.agent_id,
        display_name: a.display_name,
        status: a.status,
        mode: a.mode,
        last_heartbeat: a.last_heartbeat,
        connected_at: a.connected_at,
        message_count: 0,
      } as AgentListItem));
    }),
    deleteAgent: vi.fn((id: string) => {
      agents.delete(id);
    }),
    updateAgentStatus: vi.fn(),
    updateHeartbeat: vi.fn(),
    getAgentCount: vi.fn(() => agents.size),
    getOnlineCount: vi.fn(() => 0),
  };
}

/**
 * Helper to make an HTTP request against an Express app without supertest.
 * Works with Express 5 (which doesn't have app.request()).
 */
function request(app: express.Express, method: string, path: string, body?: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    // Create an HTTP server from the app
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

describe('AgentController', () => {
  let app: express.Express;
  let agentStore: ReturnType<typeof createMockAgentStore>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    agentStore = createMockAgentStore();
    const controller = createAgentController(TEST_CONFIG, agentStore);
    app.use('/api/agents', controller);
  });

  describe('POST /api/agents/register', () => {
    it('should register a new agent and return a token', async () => {
      const { status, body } = await request(app, 'POST', '/api/agents/register', { agent_id: 'new-agent' });
      expect(status).toBe(200);
      expect(body.code).toBe(0);
      expect(body.data.success).toBe(true);
      expect(body.data.agent_id).toBe('new-agent');
      expect(body.data.token).toBeTruthy();
      expect(typeof body.data.token).toBe('string');
      expect(agentStore.saveAgent).toHaveBeenCalledOnce();
    });

    it('should register with display_name', async () => {
      const { body } = await request(app, 'POST', '/api/agents/register', {
        agent_id: 'named-agent',
        display_name: 'My Named Agent',
      });
      expect(body.code).toBe(0);
      expect(body.data.agent_id).toBe('named-agent');
    });

    it('should return error if agent_id is missing', async () => {
      const { body } = await request(app, 'POST', '/api/agents/register', {});
      expect(body.code).toBe(1002);
    });

    it('should allow re-registration with matching token', async () => {
      const { body: body1 } = await request(app, 'POST', '/api/agents/register', { agent_id: 're-register' });
      const token = body1.data.token;

      const { body: body2 } = await request(app, 'POST', '/api/agents/register', {
        agent_id: 're-register',
        token,
      });
      expect(body2.code).toBe(0);
      expect(body2.data.agent_id).toBe('re-register');
    });

    it('should return 409 if re-registering with wrong token', async () => {
      await request(app, 'POST', '/api/agents/register', { agent_id: 'conflict-agent' });

      const { status, body } = await request(app, 'POST', '/api/agents/register', {
        agent_id: 'conflict-agent',
        token: 'wrong-token',
      });
      expect(status).toBe(409);
      expect(body.code).toBe(1005);
    });
  });

  describe('GET /api/agents', () => {
    it('should return empty list when no agents', async () => {
      const { body } = await request(app, 'GET', '/api/agents');
      expect(body.code).toBe(0);
      expect(body.data).toEqual([]);
    });

    it('should return list of agents', async () => {
      await request(app, 'POST', '/api/agents/register', { agent_id: 'agent-list-1' });
      await request(app, 'POST', '/api/agents/register', { agent_id: 'agent-list-2' });

      const { body } = await request(app, 'GET', '/api/agents');
      expect(body.code).toBe(0);
      expect(body.data).toHaveLength(2);
    });
  });

  describe('GET /api/agents/:id', () => {
    it('should return agent by id without token_hash', async () => {
      await request(app, 'POST', '/api/agents/register', { agent_id: 'get-by-id' });

      const { body } = await request(app, 'GET', '/api/agents/get-by-id');
      expect(body.code).toBe(0);
      expect(body.data.agent_id).toBe('get-by-id');
      expect(body.data).not.toHaveProperty('token_hash');
    });

    it('should return agent_not_found for non-existent agent', async () => {
      const { body } = await request(app, 'GET', '/api/agents/non-existent');
      expect(body.code).toBe(1003);
      expect(body.message).toBe('agent_not_found');
    });
  });

  describe('DELETE /api/agents/:id', () => {
    it('should delete an agent', async () => {
      await request(app, 'POST', '/api/agents/register', { agent_id: 'to-delete' });

      const { body } = await request(app, 'DELETE', '/api/agents/to-delete');
      expect(body.code).toBe(0);
      expect(agentStore.getAgent('to-delete')).toBeNull();
    });

    it('should succeed even if agent does not exist', async () => {
      const { body } = await request(app, 'DELETE', '/api/agents/non-existent');
      expect(body.code).toBe(0);
    });
  });
});
