/**
 * claw-bus OpenClaw Channel Plugin — 主入口
 *
 * defineChannelPluginEntry 包装 claw-bus 渠道插件。
 * 自动处理三种 loading mode（full / setup-only / cli-metadata）。
 */

import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import {
  clawBusChannelPlugin,
  createBusInstance,
  setBusPlugin,
  setBusAccount,
  setConnected,
} from "./src/channel.js";
import type { ResolvedClawBusAccount } from "./src/channel.js";

export default defineChannelPluginEntry({
  id: "claw-bus",
  name: "Claw Bus",
  description: "私有 Agent 消息总线渠道插件 — 让 OpenClaw 通过统一接口接入私有消息总线",

  // ChannelPlugin 对象
  plugin: clawBusChannelPlugin,

  // 启动时存储 runtime 引用（暂不依赖具体 API）
  setRuntime(_runtime): void {
    // 暂不依赖 runtime 能力
  },

  // CLI 命令注册
  registerCliMetadata(api): void {
    api.registerCli(
      ({ program }) => {
        program
          .command("claw-bus")
          .description("Claw Bus 消息总线管理");
      },
      {
        descriptors: [
          {
            name: "claw-bus",
            description: "Claw Bus 消息总线管理",
            hasSubcommands: true,
          },
        ],
      },
    );
  },

  // 完整启动（仅在 full 模式下运行）
  registerFull(api): void {
    // 读取 channels 配置
    const channelCfg = api.getChannelConfig?.("claw-bus") ?? {};
    const account: ResolvedClawBusAccount = {
      accountId: null,
      busUrl: channelCfg.busUrl as string,
      busWsUrl: channelCfg.busWsUrl as string | undefined,
      busToken: channelCfg.busToken as string,
      agentId: (channelCfg.agentId as string) ?? "my-agent",
      mode: (channelCfg.mode as "websocket" | "poll") ?? "websocket",
      pollInterval: (channelCfg.pollInterval as number) ?? 3,
      reconnectIntervalMs: (channelCfg.reconnectIntervalMs as number) ?? 3000,
      allowFrom: (channelCfg.allowFrom as string[]) ?? [],
      dmPolicy: channelCfg.dmPolicy as string | undefined,
      maxReconnectAttempts: (channelCfg.maxReconnectAttempts as number) ?? 10,
      maxFileSizeMb: (channelCfg.maxFileSizeMb as number) ?? 10,
    };

    setBusAccount(account);

    // 创建底层总线插件实例
    const plugin = createBusInstance(account);
    setBusPlugin(plugin);

    // 通用层的消息处理器 → 入站消息通过 api.runtime 注入 Agent 流程
    plugin.setMessageHandler(async (msg) => {
      const inbox = api.runtime.channel.inbox;
      if (inbox?.receive) {
        await inbox.receive({
          channelId: "claw-bus",
          from: msg.from_agent,
          text: msg.content,
          messageId: msg.message_id,
          replyToId: msg.ref_id,
          sessionId: msg.session_id,
        });
      } else {
        console.warn("[claw-bus] runtime.channel.inbox.receive 不可用，消息无法注入 Agent");
        console.log(`[claw-bus] 收到消息: [${msg.from_agent}] ${msg.content?.slice(0, 200)}`);
      }
    });

    // 异步连接总线（不阻塞 registerFull）
    plugin.connect().then((ok) => {
      setConnected(ok);
      if (ok) {
        console.log(`[claw-bus] ✅ 已连接到总线 (${account.agentId}, ${account.mode})`);
      } else {
        console.error("[claw-bus] ❌ 连接总线失败");
      }
    }).catch((e) => {
      console.error(`[claw-bus] ❌ 连接总线异常: ${String(e)}`);
    });
  },
});
