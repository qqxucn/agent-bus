import type { AgentInfo, AgentListItem, BusServerConfig } from '../types/index.js';
import type { Database } from './database.js';

export function createAgentStore(db: Database, config: BusServerConfig) {
  return {
    saveAgent(agent: AgentInfo): void {
      const stmt = db.db.prepare(`INSERT OR REPLACE INTO agents (
        agent_id, display_name, token_hash, status, mode, last_heartbeat, connected_at
      ) VALUES (
        $agent_id, $display_name, $token_hash, $status, $mode, $last_heartbeat, $connected_at
      )`);
      stmt.bind({
        $agent_id: agent.agent_id,
        $display_name: agent.display_name ?? null,
        $token_hash: agent.token_hash,
        $status: agent.status,
        $mode: agent.mode,
        $last_heartbeat: agent.last_heartbeat,
        $connected_at: agent.connected_at,
      });
      stmt.step();
      stmt.free();
      db.save();
    },

    getAgent(agentId: string): AgentInfo | null {
      const stmt = db.db.prepare('SELECT * FROM agents WHERE agent_id = $id');
      stmt.bind({ $id: agentId });
      if (stmt.step()) {
        const row = stmt.getAsObject() as any;
        stmt.free();
        return {
          agent_id: row.agent_id,
          display_name: row.display_name,
          status: row.status,
          mode: row.mode,
          last_heartbeat: row.last_heartbeat,
          connected_at: row.connected_at,
          token_hash: row.token_hash,
        };
      }
      stmt.free();
      return null;
    },

    listAgents(): AgentListItem[] {
      const results: AgentListItem[] = [];
      const stmt = db.db.prepare(
        `SELECT a.*, (
          SELECT COUNT(*) FROM messages WHERE to_agent = a.agent_id
        ) as message_count FROM agents a ORDER BY a.created_at DESC`
      );
      while (stmt.step()) {
        const row = stmt.getAsObject() as any;
        results.push({
          agent_id: row.agent_id,
          display_name: row.display_name,
          status: row.status,
          mode: row.mode,
          last_heartbeat: row.last_heartbeat,
          connected_at: row.connected_at,
          message_count: row.message_count || 0,
        });
      }
      stmt.free();
      return results;
    },

    deleteAgent(agentId: string): void {
      const stmt = db.db.prepare('DELETE FROM agents WHERE agent_id = $id');
      stmt.bind({ $id: agentId });
      stmt.step();
      stmt.free();
      db.save();
    },

    updateAgentStatus(agentId: string, status: string): void {
      const stmt = db.db.prepare(
        'UPDATE agents SET status = $status WHERE agent_id = $id'
      );
      stmt.bind({ $status: status, $id: agentId });
      stmt.step();
      stmt.free();
      db.save();
    },

    updateHeartbeat(agentId: string): void {
      const now = new Date().toISOString();
      const stmt = db.db.prepare(
        'UPDATE agents SET last_heartbeat = $time WHERE agent_id = $id'
      );
      stmt.bind({ $time: now, $id: agentId });
      stmt.step();
      stmt.free();
    },

    getAgentCount(): number {
      const stmt = db.db.prepare('SELECT COUNT(*) as cnt FROM agents');
      stmt.step();
      const row = stmt.getAsObject() as any;
      stmt.free();
      return row.cnt;
    },

    getOnlineCount(): number {
      const stmt = db.db.prepare(
        "SELECT COUNT(*) as cnt FROM agents WHERE status = 'online'"
      );
      stmt.step();
      const row = stmt.getAsObject() as any;
      stmt.free();
      return row.cnt;
    },
  };
}

export type AgentStore = ReturnType<typeof createAgentStore>;
