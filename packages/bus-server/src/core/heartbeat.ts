import type { AgentStore } from '../storage/agent-store.js';
import { ConnectionPool } from './connection-pool.js';

export type HeartbeatStateChangeCallback = (agentId: string, state: 'timeout' | 'recovered') => void;

export class Heartbeat {
  private pool: ConnectionPool;
  private agentStore: AgentStore;
  private lastHeartbeat = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private checkInterval = 15;
  private timeoutSeconds = 60;
  private onStateChange: HeartbeatStateChangeCallback | null = null;

  constructor(pool: ConnectionPool, agentStore: AgentStore) {
    this.pool = pool;
    this.agentStore = agentStore;
  }

  setOnStateChange(callback: HeartbeatStateChangeCallback): void {
    this.onStateChange = callback;
  }

  start(checkIntervalSec = 15, timeoutSec = 60): void {
    this.checkInterval = checkIntervalSec;
    this.timeoutSeconds = timeoutSec;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.check(), checkIntervalSec * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  updateHeartbeat(agentId: string): void {
    this.lastHeartbeat.set(agentId, Date.now());
  }

  removeHeartbeat(agentId: string): void {
    this.lastHeartbeat.delete(agentId);
  }

  private check(): void {
    const now = Date.now();
    for (const agentId of this.pool.getOnlineAgents()) {
      const lastBeat = this.lastHeartbeat.get(agentId);
      if (!lastBeat) continue;
      const elapsed = (now - lastBeat) / 1000;
      if (elapsed > this.timeoutSeconds) {
        this.pool.unregister(agentId);
        this.lastHeartbeat.delete(agentId);
        this.agentStore.updateAgentStatus(agentId, 'offline');
        this.onStateChange?.(agentId, 'timeout');
      }
    }
  }
}
