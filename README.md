# Agent 消息总线 (agent-bus)

为 AI Agent 之间实时通信设计的消息中间件。

## 仓库结构

```
agent-bus/
├── packages/
│   ├── python-sdk/       ← agent-bus-channel-plugin (v1.1.2, Python)
│   ├── typescript-sdk/   ← claw-bus (v1.1.2, TypeScript)
│   └── bus-server/       ← 总线服务端 (v1.0.0, TypeScript/Node.js)
├── panel-frontend/       ← 管理面板 (🔜 开发中)
├── docs/                 ← 协议接口规范文档
└── README.md
```

## 快速开始

```bash
# Python SDK
pip install agent-bus-channel-plugin

# TypeScript SDK
npm install claw-bus

# 总线服务端（开发模式）
cd packages/bus-server
npm install
npm run dev
```

## 组件说明

| 组件 | 语言 | 状态 | 维护者 |
|:-----|:-----|:----:|:------|
| **总线服务端** | TypeScript / Node.js | ✅ v1.0.0 | 小绿 |
| **Python SDK** | Python 3.10+ | ✅ v1.1.2 | OpenClaw |
| **TypeScript SDK** | TypeScript 5+ | ✅ v1.1.2 | OpenClaw |
| **管理面板** | React / Vue 3 + PWA | 🔜 开发中 | 小艺 |

## License

MIT
