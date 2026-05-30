// ===== api/routes.ts — 注册所有 REST 路由 =====

import { Router } from 'express';
import type { BusServerConfig } from '../types/index.js';
import type { AgentStore } from '../storage/agent-store.js';
import type { MessageStore } from '../storage/message-store.js';
import type { Core } from '../core/index.js';
import { requireAuth, requireAdmin } from './auth.js';
import { createAgentController } from './agent-controller.js';
import { createMessageController } from './message-controller.js';
import { requestLogger, corsMiddleware, errorHandler } from './middleware.js';

export function createApiRoutes(
  config: BusServerConfig,
  agentStore: AgentStore,
  messageStore: MessageStore,
  core: Core,
): Router {
  const router = Router();

  // Apply global middleware
  router.use(corsMiddleware);
  router.use(requestLogger);

  // Health check — no auth
  router.get('/health', (_req, res) => {
    res.json({
      code: 0,
      message: 'success',
      data: {
        status: 'healthy',
        uptime: process.uptime(),
        agents_online: core.pool.getConnectionCount(),
        agents_total: agentStore.getAgentCount(),
      },
    });
  });

  // GET /api/stats — bus stats (no auth for basic monitoring)
  router.get('/stats', (_req, res) => {
    res.json({
      code: 0,
      message: 'success',
      data: {
        total_messages: messageStore.getMessageCount(),
        total_files: messageStore.getFileCount(),
        storage_used_mb: 0,
        active_sessions: core.pool.getConnectionCount(),
        agents_online: core.pool.getConnectionCount(),
        agents_total: agentStore.getAgentCount(),
      },
    });
  });

  // Agent routes
  const agentController = createAgentController(config, agentStore);
  router.use('/agents', agentController);

  // Message routes (require auth)
  const msgAuth = requireAuth(config, agentStore);
  const messageController = createMessageController(config, messageStore, core.provider);
  router.use('/messages', msgAuth, messageController);

  // Error handler
  router.use(errorHandler);

  return router;
}
