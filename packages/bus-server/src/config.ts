import type { BusServerConfig } from '../types/index.js';

export function loadConfig(): BusServerConfig {
  return {
    httpPort: parseInt(process.env.HTTP_PORT ?? '4322', 10),
    dbPath: process.env.DB_PATH ?? './data/bus.db',
    adminToken: process.env.ADMIN_TOKEN ?? 'admin',
    agentTokenSecret: process.env.AGENT_TOKEN_SECRET ?? 'agent-secret',
    heartbeatTimeoutSeconds: parseInt(process.env.HEARTBEAT_TIMEOUT ?? '60', 10),
    heartbeatCheckInterval: parseInt(process.env.HEARTBEAT_CHECK_INTERVAL ?? '15', 10),
    maxInboxMessages: parseInt(process.env.MAX_INBOX_MESSAGES ?? '200', 10),
    logLevel: (process.env.LOG_LEVEL as BusServerConfig['logLevel']) ?? 'info',
  };
}
