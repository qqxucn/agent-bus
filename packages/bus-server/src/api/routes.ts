// ===== api/routes.ts — 注册所有 REST 路由 =====

import { Router } from 'express';
import multer from 'multer';
import type { BusServerConfig, ApiResponse, MessageLogQuery, FileInfo, FileSandboxConfig } from '../types/index.js';
import type { AgentStore } from '../storage/agent-store.js';
import type { MessageStore } from '../storage/message-store.js';
import type { Core } from '../core/index.js';
import { requireAuth, requireAdmin } from './auth.js';
import { createAgentController } from './agent-controller.js';
import { createMessageController } from './message-controller.js';
import { requestLogger, corsMiddleware, errorHandler } from './middleware.js';

// ─── 文件上传中间件（全局单例）───
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

// ===== 文件沙箱代理辅助函数 =====

function createFileProxy(fileSandbox: FileSandboxConfig) {
  const baseUrl = fileSandbox.baseUrl;

  return {
    async uploadFile(file: Express.Multer.File): Promise<Response> {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
      formData.append('file', blob, file.originalname);
      return fetch(`${baseUrl}/api/files/upload`, { method: 'POST', body: formData });
    },
    async downloadFile(fileId: string): Promise<Response> {
      return fetch(`${baseUrl}/api/files/${fileId}/download`);
    },
    async getFileInfo(fileId: string): Promise<Response> {
      return fetch(`${baseUrl}/api/files/${fileId}/info`);
    },
    async deleteFile(fileId: string): Promise<Response> {
      return fetch(`${baseUrl}/api/files/${fileId}`, { method: 'DELETE' });
    },
    async listFiles(): Promise<Response> {
      return fetch(`${baseUrl}/api/files`);
    },
  };
}

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

  // ===== 文件沙箱代理路由 =====

  const fileProxy = createFileProxy(config.fileSandbox);

  // GET /api/files — 文件列表（合并沙箱列表）
  router.get('/files', auth, async (req, res) => {
    try {
      const sandboxRes = await fileProxy.listFiles();
      if (sandboxRes.ok) {
        const body = await sandboxRes.json();
        const sandboxFiles = body.data?.files ?? [];
        return res.json({
          code: 0, message: 'success',
          data: { items: sandboxFiles, total: sandboxFiles.length },
        } as ApiResponse);
      }
      return res.json({ code: 0, message: 'success', data: { items: [], total: 0 } } as ApiResponse);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // POST /api/files/upload — 上传文件到沙箱
  router.post('/files/upload', auth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ code: 4002, message: 'No file provided', data: null } as ApiResponse);
      }
      const sandboxRes = await fileProxy.uploadFile(req.file);
      const body = await sandboxRes.json();
      return res.status(sandboxRes.status).json(body);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // GET /api/files/:file_id/download — 代理下载文件流
  router.get('/files/:file_id/download', auth, async (req, res) => {
    try {
      const { file_id } = req.params;
      const sandboxRes = await fileProxy.downloadFile(file_id);
      if (!sandboxRes.ok) {
        const body = await sandboxRes.json();
        return res.status(sandboxRes.status).json(body);
      }
      const contentType = sandboxRes.headers.get('content-type') || 'application/octet-stream';
      const contentDisposition = sandboxRes.headers.get('content-disposition') || `attachment; filename="${file_id}"`;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', contentDisposition);
      if (sandboxRes.body) {
        const reader = sandboxRes.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        };
        pump().catch(() => res.end());
      } else {
        res.end();
      }
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // GET /api/files/:file_id/info — 代理查询文件元信息
  router.get('/files/:file_id/info', auth, async (req, res) => {
    try {
      const { file_id } = req.params;
      const sandboxRes = await fileProxy.getFileInfo(file_id);
      const body = await sandboxRes.json();
      return res.status(sandboxRes.status).json(body);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // DELETE /api/files/:file_id — 代理删除文件
  router.delete('/files/:file_id', auth, async (req, res) => {
    try {
      const { file_id } = req.params;
      const sandboxRes = await fileProxy.deleteFile(file_id);
      const body = await sandboxRes.json();
      return res.status(sandboxRes.status).json(body);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // Error handler
  router.use(errorHandler);

  return router;
}
