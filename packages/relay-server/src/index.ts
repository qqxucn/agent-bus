// ========================================================
// Agent 消息总线 — 中继层 入口文件
// Express HTTP 服务 + 可选的 TCP 隧道服务
// ========================================================

import express from 'express';
import { loadConfig } from './config.js';
import { createRelayRoutes } from './relay/routes.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // ── Express HTTP 服务 ──
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // 中继 REST API 路由
  app.use('/relay', createRelayRoutes(config));

  // 404 走 API 格式
  app.use((_req, res) => {
    res.status(404).json({ code: 1004, message: 'not_found' });
  });

  // ── 启动 HTTP ──
  app.listen(config.relayPort, config.listenHost, () => {
    console.log(`[Relay Server] Running on http://${config.listenHost}:${config.relayPort}`);
    console.log(`[Relay Server] Mode: ${config.mode}`);
    console.log(`[Relay Server] Bus target: ${config.busHost}:${config.busPort}`);
    if (config.relayToken) {
      console.log(`[Relay Server] Token auth: enabled`);
    } else {
      console.log(`[Relay Server] Token auth: disabled (no RELAY_TOKEN set)`);
    }
    if (config.mode === 'tunnel') {
      console.log(`[Relay Server] TCP tunnel stub on port ${config.tunnelPort} (MVP placeholder)`);
    }
  });
}

main().catch((err) => {
  console.error('[Relay Server] Failed to start:', err);
  process.exit(1);
});
