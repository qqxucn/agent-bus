import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { createAgentStore } from '../../src/storage/agent-store.js';
import type { AgentInfo, BusServerConfig } from '../../src/types/index.js';

const TEST_CONFIG: BusServerConfig = {
  httpPort: 4322,
  dbPath: ':memory:',
  adminToken: 'test-admin-token',
  agentTokenSecret: 'test-secret',
  heartbeatTimeoutSeconds: 60,
  heartbeatCheckInterval: 15,
  maxInboxMessages: 200,
  logLevel: 'info',
};

async function createTestDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    display_name TEXT,
    token_hash TEXT NOT NULL,
    status TEXT DEFAULT 'offline',
    mode TEXT DEFAULT 'poll',
    last_heartbeat TEXT,
    connected_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    from_agent TEXT NOT NULL,
    sender_type TEXT DEFAULT 'agent',
    to_agent TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    sent_at TEXT NOT NULL,
    delivered_at TEXT,
    read_at TEXT,
    ref_id TEXT,
    session_id TEXT,
    file_id TEXT,
    file_name TEXT,
    file_size INTEGER,
    caption TEXT
  )`);

  db.run('CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages(to_agent, sent_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)');

  const database = {
    db,
    save: () => {},
    close: () => { db.close(); },
  };

  return database;
}

describe('AgentStore', () => {
  let store: ReturnType<typeof createAgentStore>;
  let db: any;

  beforeEach(async () => {
    const testDb = await createTestDb();
    db = testDb;
    store = createAgentStore(testDb, TEST_CONFIG);
  });

  describe('saveAgent', () => {
    it('should save a new agent', () => {
      const agent: AgentInfo = {
        agent_id: 'agent-1',
        display_name: 'Agent 1',
        status: 'offline',
        mode: 'poll',
        last_heartbeat: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        token_hash: 'hash123',
      };

      store.saveAgent(agent);
      const retrieved = store.getAgent('agent-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.agent_id).toBe('agent-1');
      expect(retrieved!.display_name).toBe('Agent 1');
      expect(retrieved!.status).toBe('offline');
      expect(retrieved!.token_hash).toBe('hash123');
    });

    it('should update an existing agent with REPLACE', () => {
      const agent: AgentInfo = {
        agent_id: 'agent-1',
        display_name: 'Agent 1',
        status: 'offline',
        mode: 'poll',
        last_heartbeat: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        token_hash: 'hash123',
      };
      store.saveAgent(agent);

      const updated: AgentInfo = {
        agent_id: 'agent-1',
        display_name: 'Agent 1 Updated',
        status: 'online',
        mode: 'websocket',
        last_heartbeat: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        token_hash: 'hash456',
      };
      store.saveAgent(updated);

      const retrieved = store.getAgent('agent-1');
      expect(retrieved!.display_name).toBe('Agent 1 Updated');
      expect(retrieved!.status).toBe('online');
      expect(retrieved!.mode).toBe('websocket');
      expect(retrieved!.token_hash).toBe('hash456');
    });

    it('should handle agent with null display_name', () => {
      const agent: AgentInfo = {
        agent_id: 'agent-null-name',
        status: 'offline',
        mode: 'poll',
        last_heartbeat: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        token_hash: 'hash',
      } as any; // display_name intentionally omitted

      store.saveAgent(agent);
      const retrieved = store.getAgent('agent-null-name');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.agent_id).toBe('agent-null-name');
    });
  });

  describe('getAgent', () => {
    it('should return null for non-existent agent', () => {
      const agent = store.getAgent('non-existent');
      expect(agent).toBeNull();
    });

    it('should return the correct agent fields', () => {
      const agent: AgentInfo = {
        agent_id: 'agent-fields-test',
        display_name: 'Fields Test',
        status: 'busy',
        mode: 'websocket',
        last_heartbeat: '2024-01-01T00:00:00.000Z',
        connected_at: '2024-01-01T00:00:00.000Z',
        token_hash: 'fields-hash',
      };
      store.saveAgent(agent);

      const result = store.getAgent('agent-fields-test');
      expect(result!.agent_id).toBe('agent-fields-test');
      expect(result!.display_name).toBe('Fields Test');
      expect(result!.status).toBe('busy');
      expect(result!.mode).toBe('websocket');
      expect(result!.last_heartbeat).toBe('2024-01-01T00:00:00.000Z');
      expect(result!.connected_at).toBe('2024-01-01T00:00:00.000Z');
      expect(result!.token_hash).toBe('fields-hash');
    });
  });

  describe('listAgents', () => {
    it('should return empty array when no agents exist', () => {
      const agents = store.listAgents();
      expect(agents).toEqual([]);
    });

    it('should return all agents with message_count', () => {
      const agent1: AgentInfo = {
        agent_id: 'agent-list-1',
        display_name: 'List 1',
        status: 'online',
        mode: 'websocket',
        last_heartbeat: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        token_hash: 'hash1',
      };
      const agent2: AgentInfo = {
        agent_id: 'agent-list-2',
        display_name: 'List 2',
        status: 'offline',
        mode: 'poll',
        last_heartbeat: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        token_hash: 'hash2',
      };
      store.saveAgent(agent1);
      store.saveAgent(agent2);

      const agents = store.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents.find((a) => a.agent_id === 'agent-list-1')).toBeDefined();
      expect(agents.find((a) => a.agent_id === 'agent-list-2')).toBeDefined();
      // message_count should be 0 for both
      expect(agents.every((a) => a.message_count === 0)).toBe(true);
    });

    it('should not include token_hash in list results', () => {
      const agent: AgentInfo = {
        agent_id: 'agent-no-token-hash',
        display_name: 'No Hash',
        status: 'offline',
        mode: 'poll',
        last_heartbeat: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        token_hash: 'secret123',
      };
      store.saveAgent(agent);

      const agents = store.listAgents();
      expect(agents[0]).not.toHaveProperty('token_hash');
    });
  });

  describe('deleteAgent', () => {
    it('should delete an existing agent', () => {
      const agent: AgentInfo = {
        agent_id: 'agent-to-delete',
        display_name: 'Delete Me',
        status: 'offline',
        mode: 'poll',
        last_heartbeat: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        token_hash: 'del-hash',
      };
      store.saveAgent(agent);
      expect(store.getAgent('agent-to-delete')).not.toBeNull();

      store.deleteAgent('agent-to-delete');
      expect(store.getAgent('agent-to-delete')).toBeNull();
    });

    it('should not throw when deleting non-existent agent', () => {
      expect(() => store.deleteAgent('non-existent')).not.toThrow();
    });
  });

  describe('updateAgentStatus', () => {
    it('should update agent status', () => {
      const agent: AgentInfo = {
        agent_id: 'agent-status-update',
        display_name: 'Status Update',
        status: 'offline',
        mode: 'poll',
        last_heartbeat: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        token_hash: 'status-hash',
      };
      store.saveAgent(agent);

      store.updateAgentStatus('agent-status-update', 'online');
      const retrieved = store.getAgent('agent-status-update');
      expect(retrieved!.status).toBe('online');
    });

    it('should update to busy status', () => {
      const agent: AgentInfo = {
        agent_id: 'agent-busy',
        display_name: 'Busy Agent',
        status: 'online',
        mode: 'poll',
        last_heartbeat: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        token_hash: 'busy-hash',
      };
      store.saveAgent(agent);

      store.updateAgentStatus('agent-busy', 'busy');
      expect(store.getAgent('agent-busy')!.status).toBe('busy');
    });
  });

  describe('updateHeartbeat', () => {
    it('should update last_heartbeat timestamp', () => {
      const agent: AgentInfo = {
        agent_id: 'agent-hb',
        display_name: 'Heartbeat',
        status: 'online',
        mode: 'websocket',
        last_heartbeat: '2020-01-01T00:00:00.000Z',
        connected_at: new Date().toISOString(),
        token_hash: 'hb-hash',
      };
      store.saveAgent(agent);

      const before = store.getAgent('agent-hb')!.last_heartbeat;
      store.updateHeartbeat('agent-hb');
      const after = store.getAgent('agent-hb')!.last_heartbeat;

      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });
  });

  describe('getAgentCount', () => {
    it('should return 0 when no agents exist', () => {
      expect(store.getAgentCount()).toBe(0);
    });

    it('should return correct count', () => {
      for (let i = 0; i < 5; i++) {
        const agent: AgentInfo = {
          agent_id: `agent-count-${i}`,
          status: 'offline',
          mode: 'poll',
          last_heartbeat: new Date().toISOString(),
          connected_at: new Date().toISOString(),
          token_hash: `hash-${i}`,
        } as any;
        store.saveAgent(agent);
      }
      expect(store.getAgentCount()).toBe(5);
    });
  });

  describe('getOnlineCount', () => {
    it('should return 0 when no agents online', () => {
      expect(store.getOnlineCount()).toBe(0);
    });

    it('should only count online agents', () => {
      const agent1: AgentInfo = {
        agent_id: 'online-1',
        display_name: 'Online 1',
        status: 'online',
        mode: 'websocket',
        last_heartbeat: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        token_hash: 'hash-online',
      };
      const agent2: AgentInfo = {
        agent_id: 'offline-1',
        display_name: 'Offline 1',
        status: 'offline',
        mode: 'poll',
        last_heartbeat: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        token_hash: 'hash-offline',
      };
      const agent3: AgentInfo = {
        agent_id: 'busy-1',
        display_name: 'Busy 1',
        status: 'busy',
        mode: 'websocket',
        last_heartbeat: new Date().toISOString(),
        connected_at: new Date().toISOString(),
        token_hash: 'hash-busy',
      };
      store.saveAgent(agent1);
      store.saveAgent(agent2);
      store.saveAgent(agent3);

      expect(store.getOnlineCount()).toBe(1);
    });
  });
});
