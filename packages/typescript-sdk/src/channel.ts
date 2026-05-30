/**
 * claw-bus OpenClaw Channel Plugin — 核心 ChannelPlugin 对象
 *
 * 使用 createChatChannelPlugin 构建符合 OpenClaw 规范的 ChannelPlugin。
 * 把通用层的 BusChannelPlugin 包装成 OpenClaw 的原生适配器。
 */

import { createChatChannelPlugin, createChannelPluginBase } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { createBusPlugin } from "./index.js";
import type { BusChannelConfig, BusChannelPlugin } from "./types.js";

// =================================================================
// 运行时存储
// =================================================================

let busPlugin: BusChannelPlugin | null = null;
let busAccount: ResolvedClawBusAccount | null = null;
let _connected = false;

export function setBusPlugin(plugin: BusChannelPlugin | null): void {
  busPlugin = plugin;
}

export function getBusPlugin(): BusChannelPlugin | null {
  return busPlugin;
}

export function setBusAccount(account: ResolvedClawBusAccount | null): void {
  busAccount = account;
}

export function getBusAccount(): ResolvedClawBusAccount | null {
  return busAccount;
}

export function isConnected(): boolean {
  return _connected;
}

export function setConnected(c: boolean): void {
  _connected = c;
}

// =================================================================
// 类型定义
// =================================================================

export type ResolvedClawBusAccount = {
  accountId: string | null;
  busUrl: string;
  busWsUrl?: string;
  busToken: string;
  agentId: string;
  mode: "websocket" | "poll";
  pollInterval: number;
  reconnectIntervalMs: number;
  allowFrom: string[];
  dmPolicy?: string;
  maxReconnectAttempts?: number;
  maxFileSizeMb?: number;
};

// =================================================================
// 配置解析
// =================================================================

function resolveAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedClawBusAccount {
  const section = (cfg.channels as Record<string, any>)?.["claw-bus"];
  const busUrl = section?.busUrl;
  const busToken = section?.busToken;

  if (!busUrl) throw new Error("[claw-bus] channels.claw-bus.busUrl 是必填字段");
  if (!busToken) throw new Error("[claw-bus] channels.claw-bus.busToken 是必填字段");

  return {
    accountId: accountId ?? null,
    busUrl,
    busWsUrl: section?.busWsUrl,
    busToken,
    agentId: section?.agentId ?? "my-agent",
    mode: section?.mode ?? "websocket",
    pollInterval: section?.pollInterval ?? 3,
    reconnectIntervalMs: section?.reconnectIntervalMs ?? 3000,
    allowFrom: section?.allowFrom ?? [],
    dmPolicy: section?.dmPolicy,
    maxReconnectAttempts: section?.maxReconnectAttempts ?? 10,
    maxFileSizeMb: section?.maxFileSizeMb ?? 10,
  };
}

function inspectAccount(
  cfg: OpenClawConfig,
  _accountId: string | undefined,
): { enabled: boolean; configured: boolean; busUrlStatus: string; tokenStatus: string } {
  const section = (cfg.channels as Record<string, any>)?.["claw-bus"];
  const busUrl = section?.busUrl;
  const busToken = section?.busToken;

  return {
    enabled: Boolean(busUrl && busToken),
    configured: Boolean(busUrl && busToken),
    busUrlStatus: busUrl ? "configured" : "missing",
    tokenStatus: busToken ? "available" : "missing",
  };
}

// =================================================================
// 工厂函数
// =================================================================

export function createBusInstance(account: ResolvedClawBusAccount): BusChannelPlugin {
  const config: BusChannelConfig = {
    mode: account.mode,
    busUrl: account.busUrl,
    busWsUrl: account.busWsUrl,
    agentId: account.agentId,
    agentToken: account.busToken,
    pollInterval: account.pollInterval,
    reconnectInterval: Math.max(account.reconnectIntervalMs / 1000, 1),
    maxReconnectAttempts: account.maxReconnectAttempts ?? 10,
    heartbeatInterval: 30,
  };

  return createBusPlugin(config);
}

// =================================================================
// 出站发送辅助
// =================================================================

async function sendTextToBus(ctx: {
  to: string;
  text: string;
  replyToId?: string;
}): Promise<{ messageId: string }> {
  const plugin = getBusPlugin();
  if (!plugin) throw new Error("[claw-bus] 插件未就绪");

  const result = await plugin.send({
    to: ctx.to,
    type: "text",
    content: ctx.text,
    ref_id: ctx.replyToId,
  });

  return { messageId: result.message_id ?? crypto.randomUUID() };
}

async function sendMediaToBus(ctx: {
  to: string;
  filePath: string;
  caption?: string;
}): Promise<{ messageId: string }> {
  const plugin = getBusPlugin();
  if (!plugin) throw new Error("[claw-bus] 插件未就绪");

  const result = await plugin.sendFile(ctx.to, ctx.filePath, ctx.caption);
  return { messageId: result.message_id ?? crypto.randomUUID() };
}

// =================================================================
// ChannelPlugin 对象
// =================================================================

export const clawBusChannelPlugin = createChatChannelPlugin({
  base: createChannelPluginBase({
    id: "claw-bus",
    setup: {
      resolveAccount,
      inspectAccount,
    },
  }),

  // ----- DM 安全策略 -----
  security: {
    dm: {
      channelKey: "claw-bus",
      resolvePolicy: (account) =>
        (account as ResolvedClawBusAccount).dmPolicy,
      resolveAllowFrom: (account) =>
        (account as ResolvedClawBusAccount).allowFrom,
      defaultPolicy: "open",
    },
  },

  // ----- 配对流程 -----
  pairing: {
    text: {
      idLabel: "Agent ID",
      message: "请发送此配对码来验证你的身份：",
      notify: async ({ target, code }) => {
        const plugin = getBusPlugin();
        if (!plugin) {
          console.warn("[claw-bus] 配对时插件未就绪");
          return;
        }
        await plugin.send({ to: target, type: "text", content: `配对码: ${code}` });
      },
    },
  },

  // ----- 回复线程 -----
  threading: {
    topLevelReplyToMode: "reply",
  },

  // ----- 出站消息（Agent → 总线） -----
  // 使用 attachedResults 模式：核心框架自动补全 channel 字段
  outbound: {
    base: {
      // sendText / sendMedia 通过 attachedResults 提供
    },
    attachedResults: {
      channel: "claw-bus",
      sendText: sendTextToBus,
      sendMedia: sendMediaToBus,
    },
  },
});
