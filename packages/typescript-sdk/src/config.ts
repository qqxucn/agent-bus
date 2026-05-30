import type { BusChannelConfig } from './types';

/** 配置默认值 */
const DEFAULTS = {
  pollInterval: 3,
  reconnectInterval: 3,
  maxReconnectInterval: 30,
  maxReconnectAttempts: 10,
  heartbeatInterval: 30,
  fileMode: 'sandbox' as const,
  maxFileSizeMb: 10,
};

/**
 * 配置管理器。
 * 只负责验证和补全 BusChannelConfig 对象。
 * 不负责从文件/环境变量读取（那是集成层的事）。
 */
export class ConfigManager {
  /**
   * 验证并补全配置。
   * @throws 当必填字段缺失时抛出错误
   */
  validate(raw: Partial<BusChannelConfig>): BusChannelConfig {
    const errors: string[] = [];

    // 必填字段检查
    if (!raw.busUrl) errors.push('busUrl 是必填字段');
    if (!raw.agentId) errors.push('agentId 是必填字段');
    if (!raw.agentToken) errors.push('agentToken 是必填字段');

    if (errors.length > 0) {
      throw new Error(`配置错误：\n  - ${errors.join('\n  - ')}`);
    }

    // 模式校验
    if (raw.mode && !['websocket', 'poll'].includes(raw.mode)) {
      throw new Error(`配置错误：mode 必须是 "websocket" 或 "poll"，收到 "${raw.mode}"`);
    }

    // WS 模式下检查 busWsUrl
    const mode = raw.mode || 'websocket';
    if (mode === 'websocket' && !raw.busWsUrl) {
      throw new Error('配置错误：WS 模式下 busWsUrl 是必填字段');
    }

    // 补全默认值
    return {
      mode,
      busUrl: raw.busUrl!,
      busWsUrl: raw.busWsUrl,
      agentId: raw.agentId!,
      agentToken: raw.agentToken!,
      pollInterval: raw.pollInterval ?? DEFAULTS.pollInterval,
      reconnectInterval: raw.reconnectInterval ?? DEFAULTS.reconnectInterval,
      maxReconnectInterval: raw.maxReconnectInterval ?? DEFAULTS.maxReconnectInterval,
      maxReconnectAttempts: raw.maxReconnectAttempts ?? DEFAULTS.maxReconnectAttempts,
      heartbeatInterval: raw.heartbeatInterval ?? DEFAULTS.heartbeatInterval,
      fileMode: raw.fileMode ?? DEFAULTS.fileMode,
      fileApiUrl: raw.fileApiUrl,
      maxFileSizeMb: raw.maxFileSizeMb ?? DEFAULTS.maxFileSizeMb,
      shareDir: raw.shareDir,
      skipRegistrationIfTokenSet: raw.skipRegistrationIfTokenSet,
    };
  }
}
