import { Router } from 'express';
import type { ApiResponse, SystemStats, AgentListItem, MessageLogEntry, MessageLogQuery } from '../types/index.js';
import type { AgentStore } from '../storage/agent-store.js';
import type { MessageStore } from '../storage/message-store.js';
import type { ConnectionPool } from '../core/connection-pool.js';

const START_TIME = Date.now();

export function createPanelRoutes(
  agentStore: AgentStore,
  messageStore: MessageStore,
  pool: ConnectionPool,
) {
  const router = Router();

  // GET /api/v1/panel/stats — system stats
  router.get('/stats', (_req, res) => {
    try {
      const stats: SystemStats = {
        total_agents: agentStore.getAgentCount(),
        online_agents: pool.getConnectionCount(),
        total_messages: messageStore.getMessageCount(),
        messages_today: messageStore.getTodayCount(),
        uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
        version: '1.0.0',
      };
      return res.json({ code: 0, message: 'success', data: stats } as ApiResponse<SystemStats>);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // GET /api/v1/panel/agents — agent list with status
  router.get('/agents', (_req, res) => {
    try {
      const agents = agentStore.listAgents();
      return res.json({ code: 0, message: 'success', data: agents } as ApiResponse<AgentListItem[]>);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // GET /api/v1/panel/agents/:id — agent detail
  router.get('/agents/:id', (req, res) => {
    try {
      const agent = agentStore.getAgent(req.params.id);
      if (!agent) {
        return res.json({ code: 1003, message: 'agent_not_found', data: null } as ApiResponse);
      }

      const online = pool.isOnline(req.params.id);
      const messages = messageStore.getAgentMessageCount(req.params.id);

      const detail = {
        ...agent,
        online,
        message_count: messages,
      };
      return res.json({ code: 0, message: 'success', data: detail } as ApiResponse);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // GET /api/v1/panel/messages — message log
  router.get('/messages', (req, res) => {
    try {
      const query: MessageLogQuery = {
        agent_id: req.query.agent_id as string | undefined,
        limit: parseInt(req.query.limit as string, 10) || 50,
        offset: parseInt(req.query.offset as string, 10) || 0,
        since: req.query.since as string | undefined,
        until: req.query.until as string | undefined,
      };
      const entries = messageStore.queryMessages(query);
      return res.json({ code: 0, message: 'success', data: entries } as ApiResponse<MessageLogEntry[]>);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // GET /api/v1/panel/health — no auth
  router.get('/health', (_req, res) => {
    return res.json({
      code: 0, message: 'success',
      data: {
        status: 'healthy',
        uptime: Math.floor((Date.now() - START_TIME) / 1000),
        agents_online: pool.getConnectionCount(),
        agents_total: agentStore.getAgentCount(),
      },
    } as ApiResponse);
  });

  return router;
}
