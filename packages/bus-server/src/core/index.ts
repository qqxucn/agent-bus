import type { BusMessage } from '../types/index.js';
import { ConnectionPool } from './connection-pool.js';
import { Heartbeat, type HeartbeatStateChangeCallback } from './heartbeat.js';
import { WsGateway } from './ws-gateway.js';
import type { AgentStore } from '../storage/agent-store.js';
import type { MessageStore } from '../storage/message-store.js';
import type { BusServerConfig } from '../types/index.js';

export { ConnectionPool } from './connection-pool.js';
export { Heartbeat } from './heartbeat.js';
export { WsGateway } from './ws-gateway.js';

export interface CoreProvider {
  pushToAgent(agentId: string, message: BusMessage): Promise<boolean>;
  getAgentStatus(agentId: string): 'online' | 'offline' | 'busy';
  getOnlineAgents(): string[];
}

export function createCore(
  agentStore: AgentStore,
  messageStore: MessageStore,
  config: BusServerConfig,
) {
  const pool = new ConnectionPool();
  const heartbeat = new Heartbeat(pool, agentStore);
  const wsGateway = new WsGateway(pool, heartbeat, agentStore, messageStore, config);

  heartbeat.setOnStateChange(((agentId, state) => {
    console.log(`[heartbeat] Agent ${agentId} ${state}`);
  }) as HeartbeatStateChangeCallback);

  const provider: CoreProvider = {
    pushToAgent: (agentId, message) => wsGateway.pushToAgent(agentId, message),
    getAgentStatus: (agentId) => pool.isOnline(agentId) ? 'online' : 'offline',
    getOnlineAgents: () => pool.getOnlineAgents(),
  };

  return {
    pool,
    heartbeat,
    wsGateway,
    provider,
    getProvider: () => provider,
  };
}

export type Core = ReturnType<typeof createCore>;
