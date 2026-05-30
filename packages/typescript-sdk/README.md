# claw-bus

> TypeScript 版 Agent 总线渠道插件 — 让 Agent 通过统一接口接入私有消息总线

**channel id：** `claw-bus`

OpenClaw 生态的私有总线渠道插件，跟飞书、微信、QQ 等官方渠道平起平坐。

---

## 安装

```bash
# 从 GitHub 安装
npm install github:你的组织/claw-bus

# 或者本地开发模式
git clone https://github.com/你的组织/claw-bus.git
cd claw-bus
npm install
```

## 配置

在 `openclaw.json` 中添加：

```json5
{
  "plugins": {
    "entries": {
      "claw-bus": { "enabled": true }
    }
  },
  "channels": {
    "claw-bus": {
      "enabled": true,
      "busUrl": "http://localhost:4322",
      "busWsUrl": "ws://localhost:4322/ws",
      "busToken": "你的Token（部署时填写）",
      "agentId": "my-agent",
      "mode": "websocket",
      "reconnectIntervalMs": 3000,
      "dmPolicy": "open",
      "markdown": { "tables": "bullets" }
    }
  }
}
```

**必填字段：** `busUrl`, `busToken`

**选填字段：**
| 字段 | 默认值 | 说明 |
|------|--------|------|
| `busWsUrl` | - | WS 模式必填 |
| `agentId` | `"my-agent"` | 总线身份标识 |
| `mode` | `"websocket"` | `websocket` 或 `poll` |
| `pollInterval` | `3` | 轮询间隔（秒） |
| `reconnectIntervalMs` | `3000` | 重连间隔（毫秒） |

## 开发

```bash
# 类型检查
npm run typecheck

# 测试
npm test

# 构建
npm run build
```

## 架构

```
claw-bus/
├── src/
│   ├── index.ts             ← 工厂函数 createBusPlugin()
│   ├── types.ts             ← 核心类型定义
│   ├── config.ts            ← 配置解析/校验
│   ├── auth.ts              ← 认证/注册
│   ├── message.ts           ← 消息去重/session 管理
│   ├── ws-connection.ts     ← WebSocket 连接/心跳/重连
│   ├── poll-connection.ts   ← HTTP 轮询
│   └── file-transfer.ts     ← 文件传输
├── channel-plugin-api.ts    ← OpenClaw 集成层
├── runtime-api.ts           ← OpenClaw 设置入口
├── openclaw.plugin.json     ← OpenClaw 插件清单
└── test/                    ← 测试
```

## 协议

MIT
