// ===== Bus Server — 入口文件 =====
// Express + WS 服务绑定，加载所有模块

// ── 安全防护：检测是否在 Agent 环境中误启动 ─────────────────────
const AGENT_PROTECT_VARS = ["AGENT_BUS_ENABLED", "AGENT_BUS_AGENT_ID", "AGENT_BUS_URL"];
const detectedAgentVars = AGENT_PROTECT_VARS.filter(v => process.env[v]);
if (detectedAgentVars.length >= 2) {
  console.error("");
  console.error("╔══════════════════════════════════════════════════════════════╗");
  console.error("║  ❌ 部署错误：检测到 Agent 环境变量                       ║");
  console.error("║                                                          ║");
  console.error("║  bus-server 是消息总线服务端，应部署在独立的服务器上。   ║");
  console.error("║  请勿在 Hermes / OpenClaw 等 Agent 所在的容器中运行！    ║");
  console.error("║                                                          ║");
  console.error(`║  检测到环境变量: ${detectedAgentVars.join(", ")}         ║`);
  console.error("║                                                          ║");
  console.error("║  正确部署方式:                                           ║");
  console.error("║    VPS / 云服务器 → npm run build && npm start            ║");
  console.error("║    Agent → 通过适配器作为客户端连接远程总线              ║");
  console.error("╚══════════════════════════════════════════════════════════════╝");
  console.error("");
  process.exit(1);
}

import express from express;
import { createServer } from http;
import path from path;
import { fileURLToPath } from url;
import { loadConfig } from ./config.js;
import { initDatabase } from ./storage/database.js;
import { createAgentStore } from ./storage/agent-store.js;
import { createMessageStore } from ./storage/message-store.js;
import { createCore } from ./core/index.js;
import { createApiRoutes } from ./api/routes.js;
import { createPanelRoutes } from ./panel/panel-routes.js;
import { requireAdmin } from ./api/auth.js;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // 1. Load config
  const config = loadConfig();
  console.log(`[bus-server] Starting on port ${config.httpPort}...`);

  // 2. Init database
  const db = await initDatabase(config.dbPath);
  console.log([bus-server] Database initialized);

  // 3. Init stores
  const agentStore = createAgentStore(db, config);
  const messageStore = createMessageStore(db);

  // 4. Init core (connection pool + heartbeat + WS gateway)
  const core = createCore(agentStore, messageStore, config);

  // 5. Init Express
  const app = express();
  app.use(express.json({ limit: 1mb }));

  // Root health check (for frontend fetchHealth())
  app.get("/health", (_req, res) => {
    res.json({
      status: "healthy",
      uptime: process.uptime(),
      agents_online: 0,
      agents_total: 0,
    });
  });

  // Restore middleware for /api
  app.use(/api, createApiRoutes(config, agentStore, messageStore, core));

  // Panel API routes (admin auth) — /api/v1/panel/*
  const adminAuth = requireAdmin(config);
  const panelRoutes = createPanelRoutes(agentStore, messageStore, core.pool);
  app.use(/api/v1/panel, adminAuth, panelRoutes);

  // Panel frontend static files (from panel-frontend/)
  const panelFrontendPath = /root/agent-bus/panel-frontend/dist;
  app.use(/panel, express.static(panelFrontendPath));
  // SPA fallback for panel
  app.use("/panel", (_req, res) => { res.sendFile(path.join(panelFrontendPath, "index.html")); });

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
    console.log([bus-server] Shutting down...);
    core.wsGateway.stop();
    db.close();
    process.exit(0);
  };
  process.on(SIGINT, shutdown);
  process.on(SIGTERM, shutdown);
}

main().catch((err) => {
  console.error([bus-server] Failed to start:, err);
  process.exit(1);
});
