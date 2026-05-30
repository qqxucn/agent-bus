/**
 * claw-bus OpenClaw Channel Plugin — 轻量级设置入口
 *
 * 当渠道未配置或未启用时，OpenClaw 加载此入口而不加载完整 index.ts。
 * 避免拉入 WS 客户端等重型运行时代码。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { clawBusChannelPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(clawBusChannelPlugin);
