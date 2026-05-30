"""
agent-bus-channel-plugin — 核心数据结构和接口定义
=================================================

本模块定义了插件使用到的所有数据结构和抽象接口，
其他所有模块都依赖此文件，它是整个包的契约。

传输层统一使用 snake_case 字段名（总线协议通用）。
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Coroutine, Optional


# =============================================================================
# 枚举
# =============================================================================


class FileMode(str, Enum):
    """文件传输模式。"""
    SANDBOX = "sandbox"   # 沙箱传输（安全隔离，推荐）
    BASE64 = "base64"     # BASE64 直传（无沙箱兜底）
    SHARE = "share"       # 共享目录（内网）


class WsFrameType(str, Enum):
    """WebSocket 帧类型。"""
    MESSAGE = "message"
    PING = "ping"
    PONG = "pong"
    ACK = "ack"
    ERROR = "error"
    CONNECTED = "connected"
    SESSION_END = "session_end"


# =============================================================================
# 数据结构
# =============================================================================


@dataclass
class BusChannelConfig:
    """插件配置。

    Attributes:
        mode: 连接模式 ("websocket" | "poll")。
        bus_url: HTTP API 地址（两种模式都需要）。
        bus_ws_url: WebSocket 地址（WS 模式需要）。
        agent_id: 本 Agent 在总线上的身份标识（UTF-8，支持中文等多语言）。
        agent_token: 认证 Token。
        poll_interval: 轮询间隔（秒），默认 3。
        reconnect_interval: 断线重连间隔（秒），默认 3。
        max_reconnect_interval: 断线重连最大间隔（秒），默认 30（指数退避上限）。
        max_reconnect_attempts: 最大重连尝试次数，默认 10（-1 表示无限）。
        heartbeat_interval: 心跳间隔（秒），默认 30。
        file_mode: 文件传输模式，默认 None（自动检测）。
        file_api_url: 沙箱 API 地址（file_mode="sandbox" 时需要）。
        max_file_size_mb: 文件大小上限（MB），BASE64 模式默认 10，沙箱默认 100。
        share_dir: 共享目录路径（file_mode="share" 时需要）。
    """
    mode: str
    bus_url: str
    bus_ws_url: Optional[str] = None
    agent_id: str = ""
    agent_token: str = ""
    poll_interval: int = 3
    reconnect_interval: int = 3
    max_reconnect_interval: int = 30
    max_reconnect_attempts: int = 10
    heartbeat_interval: int = 30
    file_mode: Optional[FileMode] = None
    file_api_url: Optional[str] = None
    max_file_size_mb: int = 10
    share_dir: Optional[str] = None
    on_error: Optional[Callable[[Exception], None]] = None  # 错误回调，连接失败/重连失败时触发
    skip_registration_if_token_set: bool = True  # Token 已设置时跳过注册


@dataclass
class BusMessage:
    """入站消息（总线 → 插件 → Agent）。

    Attributes:
        message_id: 消息唯一 ID（去重用）。
        from_agent: 发送方 Agent ID（UTF-8）。
        sender_type: 发送方类型 ("agent" | "user")。
        to_agent: 接收方 Agent ID（UTF-8）。
        type: 消息内容类型 ("text" | "file" | "task" | "query")。
        content: 消息内容（文本或文件引用）。
        sent_at: ISO 8601 时间戳。
        ref_id: 引用消息 ID（回复时使用）。
        session_id: 会话标识（支持多会话，不传=默认会话）。
        file_id: 文件 ID（单文件）。
        file_ids: 文件 ID 列表（多文件）。
        file_name: 文件名。
        file_size: 文件大小（字节）。
        caption: 文件描述/说明。
    """
    message_id: str
    from_agent: str
    sender_type: str  # "agent" | "user"
    to_agent: str
    type: str  # "text" | "file" | "task" | "query"
    content: str
    sent_at: str
    ref_id: Optional[str] = None
    session_id: Optional[str] = None
    file_id: Optional[str] = None
    file_ids: Optional[list[str]] = None
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    caption: Optional[str] = None


@dataclass
class OutboundMessage:
    """出站消息（Agent → 插件 → 总线）。

    Attributes:
        to: 目标 Agent ID（UTF-8）。
        type: 消息内容类型 ("text" | "file" | "task" | "query")。
        content: 消息内容。
        ref_id: 回复引用（可选）。
        session_id: 会话标识（可选，多会话支持）。
        file_id: 文件 ID（单文件）。
        file_ids: 文件 ID 列表（多文件）。
        caption: 文件描述（文件消息时）。
    """
    to: str
    type: str
    content: str
    ref_id: Optional[str] = None
    session_id: Optional[str] = None
    file_id: Optional[str] = None
    file_ids: Optional[list[str]] = None
    caption: Optional[str] = None


@dataclass
class SendResult:
    """发送结果。

    Attributes:
        success: 是否发送成功。
        message_id: 发送成功后的消息 ID。
        error: 错误描述（发送失败时）。
    """
    success: bool
    message_id: Optional[str] = None
    error: Optional[str] = None


# =============================================================================
# WS 帧结构
# =============================================================================


@dataclass
class WsFrame:
    """WebSocket 帧。

    Attributes:
        ws_type: 帧类型。
        payload: 消息内容（仅 ws_type="message" 时有）。
        message_id: 消息 ID（ack 帧时）。
        code: 错误码（error 帧时）。
        request_id: 请求 ID（用于 ack 匹配）。
    """
    ws_type: WsFrameType
    payload: Optional[dict] = None
    message_id: Optional[str] = None
    code: Optional[str] = None
    request_id: Optional[str] = None


# =============================================================================
# 自定义异常
# =============================================================================


class BusChannelError(Exception):
    """总线渠道插件基础异常。"""
    pass


class ConnectionError(BusChannelError):
    """连接相关异常。"""
    pass


class AuthError(BusChannelError):
    """认证相关异常。"""
    pass


class TimeoutError(BusChannelError):
    """超时异常。"""
    pass


class FileTooLargeError(BusChannelError):
    """文件过大异常。"""
    pass


# =============================================================================
# 消息处理器类型
# =============================================================================

# 消息处理器签名：接收 BusMessage，返回 None（处理完后自行调用 send() 回复）
MessageHandler = Callable[[BusMessage], Coroutine]


# =============================================================================
# 抽象接口
# =============================================================================


class BusChannelPlugin(abc.ABC):
    """Agent 消息总线渠道插件抽象接口。

    所有 Agent 端（Hermes、OpenClaw 等）按此接口实现。
    连接模式（WebSocket / HTTP 轮询）由配置决定，Agent 无感知。

    使用方式：
        1. 创建插件实例
        2. 调用 connect(config) 连接总线
        3. 调用 set_message_handler(handler) 设置消息处理器
        4. 收到消息时自动回调 handler
        5. 在 handler 中调用 send() / send_file() 回复
    """

    @abc.abstractmethod
    async def connect(self, config: BusChannelConfig) -> bool:
        """连接到总线。

        Args:
            config: 插件配置。

        Returns:
            是否连接成功。

        Raises:
            ConnectionError: 连接失败。
            AuthError: 认证失败。
        """
        ...

    @abc.abstractmethod
    async def disconnect(self) -> None:
        """断开与总线的连接。"""
        ...

    @property
    @abc.abstractmethod
    def is_connected(self) -> bool:
        """检查是否已连接到总线。"""
        ...

    @property
    @abc.abstractmethod
    def agent_id(self) -> str:
        """返回本 Agent 在总线上的 ID。"""
        ...

    @abc.abstractmethod
    def set_message_handler(self, handler: MessageHandler) -> None:
        """设置消息处理器。

        handler 接收 BusMessage，处理完消息后自行调用 send() 回复。
        插件只负责"收到消息通知你"，不负责帮你把回复发出去。

        Args:
            handler: 消息处理回调函数。
        """
        ...

    @abc.abstractmethod
    async def send(self, msg: OutboundMessage) -> SendResult:
        """发送消息到总线。

        Args:
            msg: 出站消息。

        Returns:
            SendResult，success=True 表示发送成功。

        Raises:
            ConnectionError: 连接断开。
            TimeoutError: 发送超时（默认 10 秒）。
        """
        ...

    @abc.abstractmethod
    async def send_file(
        self,
        to: str,
        file_path: str,
        caption: Optional[str] = None,
    ) -> SendResult:
        """发送文件到总线（自动上传 + 发消息）。

        文件类型从文件名扩展名自动推断。
        文件传输模式由配置决定（沙箱/直传/共享目录）。

        Args:
            to: 目标 Agent ID。
            file_path: 本地文件路径。
            caption: 文件描述/说明。

        Returns:
            SendResult。

        Raises:
            FileNotFoundError: 文件不存在。
            FileTooLargeError: 文件超过大小限制。
        """
        ...
