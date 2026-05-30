import { WebSocket } from 'ws';

export class ConnectionPool {
  private connections = new Map<string, WebSocket>();
  private metadata = new Map<string, { connectedAt: string }>();

  getConnection(agentId: string): WebSocket | null {
    return this.connections.get(agentId) ?? null;
  }

  register(agentId: string, ws: WebSocket): void {
    const existing = this.connections.get(agentId);
    if (existing && existing.readyState === WebSocket.OPEN) {
      existing.close(1000, 'duplicate connection');
    }
    this.connections.set(agentId, ws);
    this.metadata.set(agentId, { connectedAt: new Date().toISOString() });

    ws.on('close', () => {
      if (this.connections.get(agentId) === ws) {
        this.connections.delete(agentId);
        this.metadata.delete(agentId);
      }
    });
  }

  unregister(agentId: string): void {
    const ws = this.connections.get(agentId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'unregistered');
    }
    this.connections.delete(agentId);
    this.metadata.delete(agentId);
  }

  isOnline(agentId: string): boolean {
    const ws = this.connections.get(agentId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  getOnlineAgents(): string[] {
    return Array.from(this.connections.keys());
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  getAgentMetadata(agentId: string): { connectedAt: string } | null {
    return this.metadata.get(agentId) ?? null;
  }

  clear(): void {
    for (const [agentId, ws] of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'server shutdown');
      }
    }
    this.connections.clear();
    this.metadata.clear();
  }
}
