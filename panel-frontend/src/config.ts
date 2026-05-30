/**
 * 面板全局配置
 */
export const CONFIG = {
  // 总线服务端地址（开发时用 localhost，生产环境部署时改为实际地址）
  busUrl: import.meta.env.VITE_BUS_URL || 'http://localhost:4322',
  wsUrl: import.meta.env.VITE_WS_URL || 'ws://localhost:4322/ws',
  adminAgentId: 'admin',

  // 分页
  defaultPageSize: 50,
  chatLoadMore: 50,

  // WS 重连
  wsReconnectInitial: 3000,
  wsReconnectMax: 30000,
  wsReconnectFactor: 2,
  wsReconnectMaxAttempts: 20,

  // 仪表盘自动刷新间隔（ms）
  dashboardRefreshInterval: 10000,
} as const;
