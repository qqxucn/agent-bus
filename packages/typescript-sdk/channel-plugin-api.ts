/**
 * claw-bus OpenClaw 集成层 — Channel Plugin 注册
 *
 * 把通用 BusChannelPlugin 包装成 OpenClaw Channel Plugin。
 * 负责：
 *   1. 从 openclaw.json 读取 channels.claw-bus 配置
 *   2. 创建 BusChannelPlugin 实例
 *   3. 注册为 claw-bus channel
 *   4. 消息转换（总线消息 ↔ OpenClaw DM 会话）
 */

import { createBusPlugin } from './src/index';
import type { BusMessage, BusChannelPlugin, OutboundMessage, BusChannelConfig } from './src/types';

// 保存插件实例（被 runtime-api 使用）
let busPlugin: BusChannelPlugin | null = null;
let agentMessageHandler: ((msg: BusMessage) => Promise<void>) | null = null;

/**
 * 将 channels.claw-bus 配置映射为 BusChannelConfig。
 */
function mapChannelConfig(channelCfg: Record<string, unknown>): BusChannelConfig {
  return {
    mode: (channelCfg.mode as 'websocket' | 'poll') || 'websocket',
    busUrl: channelCfg.busUrl as string,
    busWsUrl: channelCfg.busWsUrl as string,
    agentId: (channelCfg.agentId as string) || 'my-agent',
    agentToken: channelCfg.busToken as string,
    pollInterval: (channelCfg.pollInterval as number) || 3,
    reconnectInterval: ((channelCfg.reconnectIntervalMs as number) || 3000) / 1000,
    maxReconnectInterval: (channelCfg.maxReconnectInterval as number) || 30,
    maxReconnectAttempts: (channelCfg.maxReconnectAttempts as number) || 10,
    heartbeatInterval: 30,
  };
}

/**
 * 获取总线插件实例（供 runtime-api 使用）。
 */
export function getBusPlugin(): BusChannelPlugin | null {
  return busPlugin;
}

/**
 * 设置 Agent 消息处理器（供 runtime-api 使用）。
 */
export function setAgentMessageHandler(handler: (msg: BusMessage) => Promise<void>): void {
  agentMessageHandler = handler;
}

/**
 * claw-bus Channel Plugin 注册入口。
 * OpenClaw 加载此插件时调用 register()。
 */
export const clawBusPlugin = {
  async register(api: any): Promise<void> {
    // 1. 读取配置
    const channelCfg = api.getChannelConfig?.('claw-bus') || {};

    // 2. 创建配置对象
    const config = mapChannelConfig(channelCfg);

    // 3. 创建通用插件实例
    busPlugin = createBusPlugin(config);

    // 4. 注册为 OpenClaw Channel
    api.registerChannel({
      id: 'claw-bus',

      // 入站：通用层是事件驱动的（WS推送 / 轮询拉取），
      // 这里留空，消息通过 setMessageHandler 注入。
      inbound() {
        // 消息实际通过 busPlugin.setMessageHandler 接收
      },

      // 出站：OpenClaw Agent 回复消息时调用
      async outbound(target: Record<string, unknown>, payload: Record<string, unknown>) {
        if (!busPlugin) return;

        const msg: OutboundMessage = {
          to: target.conversationId as string,
          type: 'text',
          content: (payload as any).text || '',
          ref_id: (payload as any).refId,
        };

        await busPlugin.send(msg);
      },

      describeMessageTool() {
        return {
          actions: ['send'],
          capabilities: ['text', 'markdown'],
        };
      },
    });

    // 5. 设置消息处理器（总线 → OpenClaw）
    //    当总线有消息推过来时，通过 Handler 注入到 OpenClaw Agent 流程
    busPlugin.setMessageHandler(async (msg: BusMessage) => {
      // 转发给 Agent 侧的消息处理器
      if (agentMessageHandler) {
        await agentMessageHandler(msg);
      }
    });

    // 6. 连接总线
    const connected = await busPlugin.connect();
    if (connected) {
      console.log(`[claw-bus] 已连接到总线 (${config.agentId}, ${config.mode})`);
    } else {
      console.error('[claw-bus] 连接总线失败');
    }
  },
};
