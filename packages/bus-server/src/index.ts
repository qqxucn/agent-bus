// ===== Bus Server — 入口文件 =====
// Express + WS 服务绑定，加载所有模块

import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './config.js';
import { initDatabase } from './storage/database.js';
import { createAgentStore } from './storage/agent-store.js';
import { createMessageStore } from './storage/message-store.js';
import { createCore } from './core/index.js';
import { createApiRoutes } from './api/routes.js';
import { createPanelRoutes } from './panel/panel-routes.js';
import { requireAdmin } from './api/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // 1. Load config
  const config = loadConfig();
  console.log(`[bus-server] Starting on port ${config.httpPort}...`);

  // 2. Init database
  const db = await initDatabase(config.dbPath);
  console.log('[bus-server] Database initialized');

  // 3. Init stores
  const agentStore = createAgentStore(db, config);
  const messageStore = createMessageStore(db);

  // 4. Init core (connection pool + heartbeat + WS gateway)
  const core = createCore(agentStore, messageStore, config);

  // 5. Init Express
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Restore middleware for /api
  app.use('/api', createApiRoutes(config, agentStore, messageStore, core));

  // Panel API routes (admin auth) — /api/v1/panel/*
  const adminAuth = requireAdmin(config);
  const panelRoutes = createPanelRoutes(agentStore, messageStore, core.pool);
  app.use('/api/v1/panel', adminAuth, panelRoutes);

  // Panel frontend static files
  // Default: dev path (monorepo), override via PANEL_FRONTEND_PATH env for Docker
  const panelFrontendPath = process.env.PANEL_FRONTEND_PATH
    || path.join(__dirname, '..', '..', 'panel-frontend');
  app.use('/panel', express.static(panelFrontendPath));

  // 6. Create HTTP server and attach WS
  const server = createServer(app);
  core.wsGateway.start(server);

  // 7. Start
  server.listen(config.httpPort, () => {
    console.log(`[bus-server] Running on http://localhost:${config.httpPort}`);
    console.log(`[bus-server] WS endpoint: ws://localhost:${config.httpPort}/ws`);
    console.log(`[bus-server] Panel: http://localhost:${config.httpPort}/panel/`);
    console.log(`[bus-server] Agents online: ${core.pool.getConnectionCount()}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[bus-server] Shutting down...');
    core.wsGateway.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[bus-server] Failed to start:', err);
  process.exit(1);
});
