"""
agent-bus-channel-plugin — Agent 总线渠道插件
==============================================

统一的 Agent 总线渠道插件，支持 WebSocket 和 HTTP 轮询双模式。
Hermes、OpenClaw 及其他主流 Agent 按此插件接入总线。

使用方式：

    from bus_channel import create_bus_plugin

    plugin = create_bus_plugin({
        "mode": "websocket",
        "bus_url": "http://localhost:4322",
        "bus_ws_url": "ws://localhost:4322/ws",
        "agent_id": "my-agent",
        "agent_token": "your-agent-token",
    })
    await plugin.connect()

    plugin.set_message_handler(async (msg) => {
        print(f"收到来自 {msg.from_agent} 的消息: {msg.content}")
        await plugin.send(OutboundMessage(to=msg.from_agent, type="text", content="收到"))
    })
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from .types import (
    BusChannelConfig,
    BusMessage,
    BusChannelPlugin,
    ConnectionError as BusConnectionError,
    OutboundMessage,
    SendResult,
)
from .config import load_config
from .auth import AuthManager
from .message import MessageRouter
from .file_transfer import FileTransfer

# 别名导出文件工具方法
is_supported_file_type = FileTransfer.is_supported_file_type
get_file_extension = FileTransfer.get_file_extension

logger = logging.getLogger(__name__)


# =============================================================================
# 插件实现
# =============================================================================


class AgentBusPlugin(BusChannelPlugin):
    """Agent 总线渠道插件的默认实现。

    组装所有模块（认证、连接、消息路由、文件传输），
    对外暴露 BusChannelPlugin 接口。
    """

    def __init__(self) -> None:
        self._config: Optional[BusChannelConfig] = None
        self._auth: Optional[AuthManager] = None
        self._router: Optional[MessageRouter] = None
        self._file: Optional[FileTransfer] = None
        self._connection: Any = None  # WsConnection | PollConnection
        self._message_handler: Any = None
        self._connected: bool = False
        self._agent_id: str = ""

    # ------------------------------------------------------------------
    # BusChannelPlugin 接口实现
    # ------------------------------------------------------------------

    async def connect(self, config: BusChannelConfig) -> bool:
        """连接到总线。

        Args:
            config: 插件配置。

        Returns:
            是否连接成功。

        Raises:
            ValueError: 配置无效。
            BusConnectionError: 连接失败。
        """
        self._config = config
        self._agent_id = config.agent_id

        # 初始化认证管理器
        self._auth = AuthManager(config)

        # 初始化消息路由器
        self._router = MessageRouter()

        # 初始化文件传输器
        self._file = FileTransfer(config, self._auth.token)

        # 注册 Agent
        try:
            token = await asyncio.to_thread(self._auth.register_agent)
            logger.info("[Plugin] Agent 注册成功: %s", self._agent_id)
        except Exception as e:
            await self._emit_error(BusConnectionError(f"Agent 注册失败: {e}"))
            raise BusConnectionError(f"Agent 注册失败: {e}") from e

        # 按模式建立连接
        if config.mode == "websocket":
            await self._connect_ws()
        else:
            await self._connect_poll()

        self._connected = True
        logger.info("[Plugin] 已连接到总线: mode=%s, bus=%s", config.mode, config.bus_url)
        return True

    async def disconnect(self) -> None:
        """断开与总线的连接。"""
        self._connected = False
        if self._connection is not None:
            if hasattr(self._connection, "disconnect"):
                if asyncio.iscoroutinefunction(self._connection.disconnect):
                    await self._connection.disconnect()
                else:
                    self._connection.disconnect()
        logger.info("[Plugin] 已断开总线连接")

    @property
    def is_connected(self) -> bool:
        """检查是否已连接到总线。"""
        return self._connected

    @property
    def agent_id(self) -> str:
        """返回本 Agent 在总线上的 ID。"""
        return self._agent_id

    def set_message_handler(self, handler) -> None:
        """设置消息处理器。

        Args:
            handler: 接收 BusMessage 的异步回调函数。
        """
        self._message_handler = handler
        if self._connection is not None and hasattr(self._connection, "set_on_message"):
            self._connection.set_on_message(self._on_message)

    async def send(self, msg: OutboundMessage) -> SendResult:
        """发送消息到总线。

        Args:
            msg: 出站消息。

        Returns:
            SendResult。
        """
        if self._connection is None or not self._connected:
            return SendResult(success=False, error="未连接到总线")

        if hasattr(self._connection, "send_message"):
            return await self._connection.send_message(msg)

        return SendResult(success=False, error="连接对象不支持 send_message")

    async def send_file(
        self,
        to: str,
        file_path: str,
        caption: Optional[str] = None,
    ) -> SendResult:
        """发送文件到总线（自动上传 + 发消息）。

        Args:
            to: 目标 Agent ID。
            file_path: 本地文件路径。
            caption: 文件描述。

        Returns:
            SendResult。
        """
        if self._file is None:
            return SendResult(success=False, error="文件传输器未初始化")

        try:
            file_info = self._file.upload(file_path, caption)
        except FileNotFoundError as e:
            return SendResult(success=False, error=str(e))
        except Exception as e:
            return SendResult(success=False, error=f"文件上传失败: {e}")

        # 上传成功后，发送消息引用文件
        msg = OutboundMessage(
            to=to,
            type="file",
            content=caption or file_info.get("file_name", ""),
            file_id=file_info.get("file_id"),
            caption=caption,
        )
        return await self.send(msg)

    # ------------------------------------------------------------------
    # 内部方法
    # ------------------------------------------------------------------

    async def _connect_ws(self) -> None:
        """建立 WebSocket 连接。"""
        # 延迟导入，避免强制依赖 websockets 库
        from .ws_connection import WsConnection  # type: ignore[import-untyped]

        assert self._auth is not None
        assert self._router is not None

        self._connection = WsConnection(
            config=self._config,
            auth=self._auth,
            router=self._router,
        )
        # set_on_message 统一由 set_message_handler() 设置
        await self._connection.connect()

    async def _connect_poll(self) -> None:
        """建立 HTTP 轮询连接。"""
        from .poll_connection import PollConnection  # type: ignore[import-untyped]

        assert self._auth is not None
        assert self._router is not None

        self._connection = PollConnection(
            config=self._config,
            auth=self._auth,
            router=self._router,
        )
        # set_on_message 统一由 set_message_handler() 设置
        await self._connection.connect()

    async def _on_message(self, msg: BusMessage) -> None:
        """收到消息后的内部回调。

        先通过消息路由器去重，再调用用户设置的消息处理器。

        Args:
            msg: 入站消息。
        """
        if self._router is None:
            logger.warning("[Plugin] 消息路由器未初始化，跳过消息: %s", msg.message_id)
            return

        # 去重检查
        if not self._router.route_message(msg):
            logger.debug("[Plugin] 跳过重复消息: %s", msg.message_id)
            return

        # 调用用户处理器
        if self._message_handler is not None:
            try:
                await self._message_handler(msg)
            except Exception as e:
                logger.error("[Plugin] 消息处理异常: %s", e, exc_info=True)

    async def _emit_error(self, error: Exception) -> None:
        """触发错误回调（若已配置）。

        Args:
            error: 异常对象。
        """
        if self._config is not None and self._config.on_error is not None:
            try:
                cb = self._config.on_error
                if asyncio.iscoroutinefunction(cb):
                    await cb(error)
                else:
                    cb(error)
            except Exception:
                logger.warning("[Plugin] 错误回调异常: %s", error)


# =============================================================================
# 导出
# =============================================================================

__all__ = [
    "AgentBusPlugin",
    "BusChannelConfig",
    "BusMessage",
    "OutboundMessage",
    "SendResult",
    "BusChannelPlugin",
    "FileMode",
    "is_supported_file_type",
    "get_file_extension",
]


def create_bus_plugin(
    config_source: Optional[dict[str, Any]] = None,
    config_path: Optional[str] = None,
) -> AgentBusPlugin:
    """创建总线渠道插件实例。

    工厂函数，推荐的入口方式。

    Args:
        config_source: 配置字典（直接传入）。
        config_path: 配置文件路径（.json 或 .yaml）。

    Returns:
        配置好的 AgentBusPlugin 实例。

    Example:
        >>> plugin = create_bus_plugin({
        ...     "mode": "websocket",
        ...     "bus_url": "http://localhost:4322",
        ...     "bus_ws_url": "ws://localhost:4322/ws",
        ...     "agent_id": "my-agent",
        ...     "agent_token": "your-agent-token",
        ... })
        >>> await plugin.connect()
    """
    config = load_config(source=config_source, config_path=config_path)
    return AgentBusPlugin()
