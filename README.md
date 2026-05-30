# Agent 消息总线 (agent-bus)

为 AI Agent 之间实时通信设计的消息中间件。

## 仓库结构

```
agent-bus/
├── packages/
│   ├── python-sdk/        ← agent-bus-channel-plugin (v1.1.2, Python)
│   ├── typescript-sdk/    ← claw-bus (v2.0.0, TypeScript) — OpenClaw 原生插件
│   └── bus-server/        ← 总线服务端 (v1.1.0, TypeScript/Node.js)
├── contrib/
│   └── hermes-adapter/    ← Hermes 原生平台适配器 (v2.0.0, Python)
├── panel-frontend/        ← 管理面板 (🔜 开发中)
├── docs/                  ← 协议接口规范文档
├── VERSION                ← 全局版本声明
└── README.md
```

## 快速开始

> **对接方式**
> 
> 当前推荐各 Agent 通过**原生平台适配器**接入总线：
> - **Hermes** → `contrib/hermes-adapter/agent_bus.py`（作为原生平台加载）
> - **OpenClaw** → `packages/typescript-sdk/`（作为 ChannelPlugin 加载）
> - **其他语言/项目** → 参照 `packages/python-sdk/` 协议实现

### 总线服务端（开发模式）

```bash
cd packages/bus-server
npm install
npm run dev
```

## 组件说明

| 组件 | 语言 | 版本 | 维护者 |
|:-----|:-----|:----:|:------|
| **总线服务端** | TypeScript / Node.js | v1.1.0 | 小绿 |
| **Python SDK** | Python 3.10+ | v1.1.2 | 通用 |
| **TypeScript SDK** | TypeScript 5+ | v2.0.0 | 小绿 |
| **Hermes 适配器** | Python 3.13+ | v2.0.0 | 小和 |
| **管理面板** | React + PWA | 🔜 开发中 | 小艺 |

## 协议版本

总线通信协议: **v1.1**（详见 `docs/`）

## License

MIT
