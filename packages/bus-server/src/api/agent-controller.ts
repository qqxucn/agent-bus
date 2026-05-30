import { Router } from 'express';
import type { BusServerConfig, ApiResponse, AgentRegisterResponse, AgentListItem, AgentInfo } from '../types/index.js';
import type { AgentStore } from '../storage/agent-store.js';
import { createToken } from './auth.js';
import { createHmac } from 'node:crypto';

export function createAgentController(config: BusServerConfig, agentStore: AgentStore) {
  const router = Router();

  // POST /api/agents/register — no auth required
  router.post('/register', (req, res) => {
    try {
      const { agent_id, display_name, token } = req.body;
      if (!agent_id) {
        return res.json({ code: 1002, message: 'invalid_message', data: null } as ApiResponse);
      }

      const existing = agentStore.getAgent(agent_id);
      if (existing) {
        // Already exists, verify token matches
        const expectedToken = createToken(agent_id, config.agentTokenSecret);
        if (token && token !== expectedToken) {
          return res.status(409).json({ code: 1005, message: 'duplicate_agent', data: null } as ApiResponse);
        }
        return res.json({
          code: 0, message: 'success',
          data: { success: true, agent_id, token: expectedToken } as AgentRegisterResponse,
        } as ApiResponse<AgentRegisterResponse>);
      }

      const tokenHash = createHmac('sha256', config.agentTokenSecret)
        .update(agent_id)
        .digest('hex');
      const agentToken = createToken(agent_id, config.agentTokenSecret);
      const now = new Date().toISOString();

      const agent: AgentInfo = {
        agent_id,
        display_name: display_name ?? agent_id,
        status: 'offline',
        mode: 'poll',
        last_heartbeat: now,
        connected_at: now,
        token_hash: tokenHash,
      };

      agentStore.saveAgent(agent);

      return res.json({
        code: 0, message: 'success',
        data: { success: true, agent_id, token: agentToken } as AgentRegisterResponse,
      } as ApiResponse<AgentRegisterResponse>);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // GET /api/agents — admin token required
  router.get('/', (req, res) => {
    try {
      const agents = agentStore.listAgents();
      return res.json({ code: 0, message: 'success', data: agents } as ApiResponse<AgentListItem[]>);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // GET /api/agents/:id — auth token required
  router.get('/:id', (req, res) => {
    try {
      const agent = agentStore.getAgent(req.params.id);
      if (!agent) {
        return res.json({ code: 1003, message: 'agent_not_found', data: null } as ApiResponse);
      }
      const { token_hash, ...safeAgent } = agent;
      return res.json({ code: 0, message: 'success', data: safeAgent } as ApiResponse);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // DELETE /api/agents/:id — admin token required
  router.delete('/:id', (req, res) => {
    try {
      agentStore.deleteAgent(req.params.id);
      return res.json({ code: 0, message: 'success', data: null } as ApiResponse);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  return router;
}
