# agent-bus-channel-plugin (v1.1.2)

> ⚠️ **旧版 SDK — 仅作协议参考**
>
> Hermes 和 OpenClaw 现已改用**原生平台适配器**：
> - Hermes → `contrib/hermes-adapter/agent_bus.py` (v2.0.0)
> - OpenClaw → `packages/typescript-sdk/` (v2.0.0)
>
> 本 Python SDK 作为协议实现的参考示例保留，
> 供其他编程语言项目对接总线时参照调用方式。

统一的 Agent 总线渠道插件。支持 WebSocket 和 HTTP 轮询双模式。

## 安装

```bash
pip install agent-bus-channel-plugin

# 如果需要 WebSocket 模式：
pip install "agent-bus-channel-plugin[websocket]"

# 如果需要 YAML 配置：
pip install "agent-bus-channel-plugin[yaml]"

# 全部安装：
pip install "agent-bus-channel-plugin[all]"
```

## 快速开始

```python
import asyncio
from bus_channel import create_bus_plugin, OutboundMessage

async def main():
    # 创建插件实例
    plugin = create_bus_plugin({
        "mode": "websocket",
        "bus_url": "http://localhost:4322",
        "bus_ws_url": "ws://localhost:4322/ws",
        "agent_id": "my-agent",
        "agent_token": "your-token-here",
    })

    # 设置消息处理器
    plugin.set_message_handler(async_handler)

    # 连接总线
    await plugin.connect()
    print(f"已连接到总线，Agent ID: {plugin.agent_id}")

    # 发送消息
    result = await plugin.send(OutboundMessage(
        to="other-agent",
        type="text",
        content="你好！",
    ))

    # 保持运行
    await asyncio.Event().wait()

async def async_handler(msg):
    print(f"收到来自 {msg.from_agent} 的消息: {msg.content}")
    # 处理完后回复
    await plugin.send(OutboundMessage(
        to=msg.from_agent,
        type="text",
        content=f"收到你的消息: {msg.content}",
        session_id=msg.session_id,
    ))

asyncio.run(main())
```

## 配置

支持三种配置方式（优先级从高到低）：

1. **直接传入字典**（代码中）
2. **配置文件**（`.json` 或 `.yaml`）
3. **环境变量**（`AGENT_BUS_` 前缀）

### 配置文件示例 (config.json)

```json
{
    "mode": "websocket",
    "bus_url": "http://localhost:4322",
    "bus_ws_url": "ws://localhost:4322/ws",
    "agent_id": "my-agent",
    "agent_token": "your-token",
    "poll_interval": 3,
    "reconnect_interval": 3,
    "heartbeat_interval": 30
}
```

### 环境变量

```bash
export AGENT_BUS_MODE=websocket
export AGENT_BUS_BUS_URL=http://localhost:4322
export AGENT_BUS_BUS_WS_URL=ws://localhost:4322/ws
export AGENT_BUS_AGENT_ID=my-agent
export AGENT_BUS_AGENT_TOKEN=your-token
```

## 连接模式

| 模式 | 实时性 | 依赖 | 适用场景 |
|:----|:-----|:----|:--------|
| `websocket` | 实时推送 | `websockets` 库 | 主力模式，Agent 间对话 |
| `poll` | 3秒延迟 | 无（纯标准库） | 受限环境，调试 |

## 文件传输

支持多种文件传输方式：

| 模式 | 上限 | 说明 |
|:----|:---:|:-----|
| `sandbox` | 100 MB | 通过文件沙箱 API，安全隔离 |
| `base64` | 10 MB | BASE64 内嵌，无沙箱兜底 |
| `share` | 不限 | 共享目录，内网适用 |

插件自动检测沙箱可用性，不可用时自动降级。

## 多会话支持

通过 `session_id` 字段支持与同一 Agent 的多个独立对话：

```python
# 会话 A：股票分析
await plugin.send(OutboundMessage(
    to="my-agent", type="text", content="长江电力走势",
    session_id="stock-analysis",
))

# 会话 B：教育咨询（完全独立，互不干扰）
await plugin.send(OutboundMessage(
    to="my-agent", type="text", content="孩子数学不好",
    session_id="education",
))
```

## 插件接口

```python
class BusChannelPlugin:
    async def connect(self, config: BusChannelConfig) -> bool
    async def disconnect(self) -> None
    @property
    def is_connected(self) -> bool
    @property
    def agent_id(self) -> str
    def set_message_handler(self, handler: Callable[[BusMessage], Awaitable[None]]) -> None
    async def send(self, msg: OutboundMessage) -> SendResult
    async def send_file(self, to: str, file_path: str, caption: str | None = None) -> SendResult
```

## 与规范的关系

本插件实现了 [Agent Bus Channel Plugin 规范 v1.1](./SPEC.md)。

## 开发

```bash
# 克隆仓库
git clone https://github.com/your-org/agent-bus-channel-plugin.git
cd agent-bus-channel-plugin

# 安装开发依赖
pip install -e ".[all]"

# 运行测试
python -m pytest
```

## 许可证

MIT
