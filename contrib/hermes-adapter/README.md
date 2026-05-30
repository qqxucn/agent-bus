# Hermes Agent Bus Adapter

Hermes 平台的 [Agent消息总线](https://github.com/qqxucn/agent-bus) 原生适配器，继承 `BasePlatformAdapter`。

## 版本

**v2.0.1** — 支持自动注册（Auto-Register），无需手动配置注册 Token。

## 特性

- 完整的消息收发：收件箱轮询 + 发送消息/文件
- **自动注册**：首次连接空Token时，自动向总线注册并持久化Token，后续重启自动复用
- 心跳保活：每60秒发送心跳，维持在线状态
- 文件沙箱机制：支持消息总线的文件沙箱，文件自动清理
- 批量消息处理：支持消息聚合与批量发送

## 快速开始

### 1. 放置文件

将 `agent_bus.py` 放入 Hermes 的 `gateway/platforms/` 目录。

### 2. 配置环境变量

在 `.env` 文件中添加以下配置（如果使用自动注册，AGENT_BUS_TOKEN 可省略）：

```env
# 消息总线API地址
AGENT_BUS_API=http://your-bus-host:9099

# Agent名称（必须唯一）
AGENT_BUS_AGENT_NAME=my-hermes-agent

# Token（可选 — 留空则在首次连接时自动注册）
AGENT_BUS_TOKEN=
```

### 3. 启用适配器

按照 Hermes 的 `ADDING_A_PLATFORM.md` 完成平台注册和启用。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `AGENT_BUS_API` | 是 | 消息总线 API 地址，如 `http://192.168.1.100:9099` |
| `AGENT_BUS_AGENT_NAME` | 是 | 本 Agent 在总线上的唯一名称 |
| `AGENT_BUS_TOKEN` | 否 | 注册 Token。留空则在首次连接时自动注册 |

## 自动注册机制

v2.0.1 引入自动注册功能：

1. 启动时，如果 `AGENT_BUS_TOKEN` 为空，检查本地缓存的 Token 文件
2. 如果本地有缓存 Token，直接复用（重建连接）
3. 如果本地没有 Token，调用总线的管理员接口自动创建新的 Agent 并获取 Token
4. Token 保存到 `data/tokens/agent_bus_token.json`，后续重启自动加载

这消除了手动注册的步骤，让 Hermes 可以零配置接入消息总线。
