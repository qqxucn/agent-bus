import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type { BusServerConfig } from './types/index.js';

export function loadConfig(): BusServerConfig {
  // 尝试加载项目根目录的 .env.server
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(__dirname, '../../..', '.env.server');
  dotenv.config({ path: envPath });

  return {
    httpPort: parseInt(process.env.HTTP_PORT ?? '4322', 10),
    dbPath: process.env.DB_PATH ?? './data/bus.db',
    adminToken: process.env.ADMIN_TOKEN ?? 'admin',
    agentTokenSecret: process.env.AGENT_TOKEN_SECRET ?? 'agent-secret',
    heartbeatTimeoutSeconds: parseInt(process.env.HEARTBEAT_TIMEOUT ?? '60', 10),
    heartbeatCheckInterval: parseInt(process.env.HEARTBEAT_CHECK_INTERVAL ?? '15', 10),
    maxInboxMessages: parseInt(process.env.MAX_INBOX_MESSAGES ?? '200', 10),
    fileSandbox: { baseUrl: process.env.FILE_SANDBOX_URL || "http://localhost:4323" },
    logLevel: (process.env.LOG_LEVEL as BusServerConfig['logLevel']) ?? 'info',
  };
}
