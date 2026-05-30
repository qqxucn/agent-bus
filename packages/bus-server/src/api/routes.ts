// ===== api/routes.ts — 注册所有 REST 路由 =====

import { Router } from 'express';
import type { BusServerConfig, ApiResponse, MessageLogQuery, FileInfo } from '../types/index.js';
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

  // Authenticated routes
  const auth = requireAuth(config, agentStore);
  const messageController = createMessageController(config, messageStore, core.provider);

  // GET /api/messages/log — 消息日志（需认证，在 /messages 挂载之前注册，避免被子路由拦截）
  router.get('/messages/log', auth, (req, res) => {
    try {
      const query: MessageLogQuery = {
        agent_id: req.query.agent_id as string | undefined,
        limit: parseInt(req.query.limit as string, 10) || 50,
        offset: parseInt(req.query.offset as string, 10) || 0,
        since: req.query.since as string | undefined,
        until: req.query.until as string | undefined,
      };
      const entries = messageStore.queryMessages(query);
      const total = messageStore.getMessageCount();
      return res.json({
        code: 0, message: 'success',
        data: { items: entries, total },
      } as ApiResponse<{ items: typeof entries; total: number }>);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // 消息路由（包含 /send, /inbox, /search 等子路由）
  router.use('/messages', auth, messageController);

  router.get('/files', auth, (req, res) => {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const result = messageStore.searchMessages({
        type: 'file',
        page,
        page_size: limit,
      });
      const items: FileInfo[] = result.messages.map(m => ({
        file_id: m.file_id || m.message_id,
        file_name: m.file_name || '未知文件',
        file_size: m.file_size || 0,
        uploaded_by: m.from_agent,
        uploaded_at: m.sent_at,
      }));
      return res.json({
        code: 0, message: 'success',
        data: { items, total: result.total },
      } as ApiResponse<{ items: FileInfo[]; total: number }>);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // Error handler
  router.use(errorHandler);

  return router;
}