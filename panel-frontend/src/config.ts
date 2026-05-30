/**
 * 面板全局配置
 */
export const CONFIG = {
  // 总线服务端地址（自动检测：面板和总线同源部署时自动适配）
  busUrl: import.meta.env.VITE_BUS_URL || window.location.origin,
  wsUrl: import.meta.env.VITE_WS_URL || (() => {
    const loc = window.location;
    const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${loc.host}/ws`;
  })(),
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
