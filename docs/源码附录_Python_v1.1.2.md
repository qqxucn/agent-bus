# 📋 附录 A：Python 插件完整源码（v1.1.2）

> agent-bus-channel-plugin v1.1.2 全部源码。35/35 测试通过，三方协议对齐完成。

---

## A.1 types.py — 核心数据结构

```python
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
```

---

## A.2 config.py — 配置解析

```python
"""
配置解析模块
============

从 YAML / JSON / 字典 中读取配置，验证必填字段，构建 BusChannelConfig。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

from .types import BusChannelConfig, FileMode


def load_config(
    source: Optional[dict[str, Any]] = None,
    config_path: Optional[str] = None,
) -> BusChannelConfig:
    """加载总线渠道插件配置。

    配置来源优先级（高到低）：
    1. source 字典（直接传入）
    2. config_path 指向的 JSON/YAML 文件
    3. 环境变量（以 AGENT_BUS_ 为前缀）

    Args:
        source: 直接传入的配置字典。
        config_path: 配置文件路径（支持 .json 或 .yaml/.yml）。

    Returns:
        解析后的 BusChannelConfig。

    Raises:
        ValueError: 配置无效或缺少必填字段。
        FileNotFoundError: 配置文件不存在。
    """
    raw: dict[str, Any] = {}

    # 第1优先级：传入的字典
    if source is not None:
        raw.update(source)

    # 第2优先级：配置文件
    if config_path is not None:
        file_config = _load_config_file(config_path)
        # 文件配置覆盖传入的字典
        for k, v in file_config.items():
            if v is not None:
                raw[k] = v

    # 第3优先级：环境变量（最低，作为兜底）
    env_config = _load_from_env()
    for k, v in env_config.items():
        if v is not None and k not in raw:
            raw[k] = v

    # 验证必填字段
    _validate_required(raw)

    # 构建配置对象
    config = BusChannelConfig(
        mode=raw.get("mode", "websocket"),
        bus_url=raw["bus_url"],
        bus_ws_url=raw.get("bus_ws_url"),
        agent_id=raw.get("agent_id", ""),
        agent_token=raw.get("agent_token", ""),
        poll_interval=int(raw.get("poll_interval", 3)),
        reconnect_interval=int(raw.get("reconnect_interval", 3)),
        max_reconnect_interval=int(raw.get("max_reconnect_interval", 30)),
        max_reconnect_attempts=int(raw.get("max_reconnect_attempts", 10)),
        heartbeat_interval=int(raw.get("heartbeat_interval", 30)),
        file_mode=FileMode(raw["file_mode"]) if raw.get("file_mode") else None,
        file_api_url=raw.get("file_api_url"),
        max_file_size_mb=int(raw.get("max_file_size_mb", 10)),
        share_dir=raw.get("share_dir"),
        skip_registration_if_token_set=raw.get("skip_registration_if_token_set", "true").lower() in ("true", "1", "yes"),
    )

    return config


def _load_config_file(path: str) -> dict[str, Any]:
    """从文件加载配置。

    Args:
        path: 配置文件路径。

    Returns:
        配置字典。

    Raises:
        FileNotFoundError: 文件不存在。
        ValueError: 不支持的文件格式或不合法内容。
    """
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"配置文件不存在: {path}")

    content = p.read_text(encoding="utf-8")

    if p.suffix in (".json",):
        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            raise ValueError(f"JSON 解析失败: {e}") from e

    elif p.suffix in (".yaml", ".yml"):
        try:
            import yaml  # type: ignore[import-untyped]
        except ImportError:
            raise ImportError(
                "解析 YAML 配置文件需要安装 PyYAML: pip install pyyaml"
            )
        try:
            data = yaml.safe_load(content)
            if not isinstance(data, dict):
                raise ValueError("YAML 配置必须是字典格式")
            return data
        except yaml.YAMLError as e:
            raise ValueError(f"YAML 解析失败: {e}") from e

    else:
        raise ValueError(f"不支持的配置文件格式: {p.suffix}（支持 .json / .yaml / .yml）")


def _load_from_env() -> dict[str, Any]:
    """从环境变量加载配置。

    规则：AGENT_BUS_XXX → 去掉前缀、转小写作为配置键。
    例如：AGENT_BUS_BUS_URL → bus_url

    Returns:
        从环境变量中提取的配置字典。
    """
    prefix = "AGENT_BUS_"
    result: dict[str, Any] = {}

    for key, value in os.environ.items():
        if key.startswith(prefix):
            config_key = key[len(prefix):].lower()
            result[config_key] = value

    return result


def _validate_required(raw: dict[str, Any]) -> None:
    """验证必填字段。

    Args:
        raw: 原始配置字典。

    Raises:
        ValueError: 缺少必填字段。
    """
    errors: list[str] = []

    # bus_url 是必填字段（两种模式都需要）
    if not raw.get("bus_url"):
        errors.append("缺少必填字段: bus_url（总线 HTTP API 地址）")

    # agent_id 是必填字段（标识 Agent 身份）
    if not raw.get("agent_id"):
        errors.append("缺少必填字段: agent_id（Agent 身份标识）")

    # agent_token 是必填字段（认证凭证）
    if not raw.get("agent_token"):
        errors.append("缺少必填字段: agent_token（Agent 认证 Token）")

    # WS 模式下 bus_ws_url 是必填的
    mode = raw.get("mode", "websocket")
    if mode == "websocket" and not raw.get("bus_ws_url"):
        errors.append("WS 模式下缺少必填字段: bus_ws_url（总线 WebSocket 地址）")

    if errors:
        raise ValueError("配置验证失败:\n" + "\n".join(f"  - {e}" for e in errors))
```

---

## A.3 auth.py — 认证注册

```python
"""
认证与注册模块
==============

管理 Agent 在总线上的注册、Token 认证、Authorization Header 构建。
"""

from __future__ import annotations

import json
import logging
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from .types import (
    BusChannelConfig,
    AuthError,
    ConnectionError as BusConnectionError,
)

logger = logging.getLogger(__name__)


class AuthManager:
    """认证管理器。

    负责 Agent 在总线上的注册、Token 管理和请求认证。
    """

    def __init__(self, config: BusChannelConfig) -> None:
        self._config = config
        self._token: str = config.agent_token
        self._agent_id: str = config.agent_id

    @property
    def token(self) -> str:
        """当前有效的 Token。"""
        return self._token

    @property
    def agent_id(self) -> str:
        """当前注册的 Agent ID。"""
        return self._agent_id

    # ------------------------------------------------------------------
    # Agent 注册
    # ------------------------------------------------------------------

    def register_agent(
        self,
        admin_token: Optional[str] = None,
    ) -> str:
        """在总线上注册（或重新注册）Agent。

        如果配置中提供了固定 Token，会尝试传入固定 Token 注册。
        如果 Agent 已注册（409 Conflict），跳过注册并直接返回当前 Token。

        Args:
            admin_token: 管理员 Token（可选，用于注册/重置）。

        Returns:
            注册成功后返回的 Token。

        Raises:
            AuthError: 注册失败。
            BusConnectionError: 无法连接总线。
        """
        if self._agent_id and self._token and self._config.skip_registration_if_token_set:
            logger.info(
                "[Auth] 使用已有 Token 连接，跳过注册: agent=%s (skip_registration_if_token_set=True)",
                self._agent_id,
            )
            return self._token

        url = f"{self._config.bus_url}/api/agents/register"
        headers = {"Content-Type": "application/json"}
        if admin_token:
            headers["Authorization"] = f"Bearer {admin_token}"

        body = {
            "id": self._agent_id,
            "name": self._agent_id,
        }
        # 如果配置了固定 Token，一并传入
        if self._token:
            body["token"] = self._token

        try:
            req = Request(
                url,
                data=json.dumps(body).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            with urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                self._token = data["token"]
                self._agent_id = data.get("agent_id", self._agent_id)
                logger.info(
                    "[Auth] Agent 注册成功: %s",
                    self._agent_id,
                )
                return self._token

        except HTTPError as e:
            if e.code == 409:
                # Agent 已注册，跳过
                logger.info(
                    "[Auth] Agent 已注册，跳过: %s",
                    self._agent_id,
                )
                return self._token
            body = e.read().decode("utf-8", errors="replace")
            raise AuthError(
                f"Agent 注册失败 (HTTP {e.code}): {body}"
            ) from e

        except URLError as e:
            raise BusConnectionError(
                f"无法连接总线: {e.reason}"
            ) from e

    # ------------------------------------------------------------------
    # Token 续期
    # ------------------------------------------------------------------

    def renew_token(self, admin_token: str) -> str:
        """续期当前 Agent 的 Token。

        Args:
            admin_token: 管理员 Token。

        Returns:
            新 Token。

        Raises:
            AuthError: 续期失败。
        """
        url = f"{self._config.bus_url}/api/agents/{self._agent_id}/token/renew"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {admin_token}",
        }

        try:
            req = Request(
                url,
                data=b"{}",
                headers=headers,
                method="POST",
            )
            with urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                self._token = data["token"]
                logger.info(
                    "[Auth] Token 续期成功: agent=%s",
                    self._agent_id,
                )
                return self._token

        except HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise AuthError(
                f"Token 续期失败 (HTTP {e.code}): {body}"
            ) from e

        except URLError as e:
            raise BusConnectionError(
                f"无法连接总线: {e.reason}"
            ) from e

    # ------------------------------------------------------------------
    # 认证 Header
    # ------------------------------------------------------------------

    def build_auth_header(self) -> dict[str, str]:
        """构建 Authorization Header。

        Returns:
            包含 Authorization 的 headers 字典。
        """
        return {"Authorization": f"Bearer {self._token}"}

    def build_ws_headers(self) -> dict[str, str]:
        """构建 WebSocket 连接用的 Headers。

        WS 连接时推荐使用 Header 传递认证，避免 Token 出现在 URL 中。

        Returns:
            包含 Authorization 和 X-Agent-Id 的 headers 字典。
        """
        return {
            "Authorization": f"Bearer {self._token}",
            "X-Agent-Id": self._agent_id,
        }
```

---

## A.4 message.py — 消息管理

```python
"""
消息管理模块
============

消息去重（LRU 缓存）、session_id 上下文管理、消息路由。
纯数据逻辑，不涉及网络 IO。
"""

from __future__ import annotations

import time
from collections import OrderedDict
from typing import Optional

from .types import BusMessage


class MessageDeduplicator:
    """消息去重器。

    使用 LRU（Least Recently Used）缓存机制，
    保留最近处理过的 message_id，防止同一消息被重复处理。

    典型场景：
    - WS 推送消息后断线，重连后轮询可能再次拉到同一条消息
    - HTTP 轮询时网络重试导致同一消息被多次拉取
    """

    def __init__(self, max_size: int = 1000) -> None:
        """初始化去重器。

        Args:
            max_size: 最多保留的消息 ID 数量。超过时淘汰最旧的。
        """
        self._max_size = max_size
        self._seen: OrderedDict[str, float] = OrderedDict()

    def is_duplicate(self, message_id: str) -> bool:
        """检查消息是否已处理过。

        Args:
            message_id: 消息 ID。

        Returns:
            True 表示已处理过，应跳过。
        """
        if message_id in self._seen:
            # 刷新位置（LRU）
            self._seen.move_to_end(message_id)
            return True
        return False

    def mark_processed(self, message_id: str) -> None:
        """标记消息为已处理。

        Args:
            message_id: 消息 ID。
        """
        self._seen[message_id] = time.time()
        # 超过上限时淘汰最旧的
        if len(self._seen) > self._max_size:
            self._seen.popitem(last=False)

    def clear(self) -> None:
        """清空去重缓存。"""
        self._seen.clear()

    @property
    def size(self) -> int:
        """当前缓存的消息数量。"""
        return len(self._seen)


class SessionContext:
    """会话上下文。

    按 (from_agent, session_id) 组合维护独立的会话上下文。
    不传 session_id 时使用默认会话。
    """

    def __init__(self) -> None:
        self._contexts: dict[str, dict] = {}

    @staticmethod
    def _make_key(from_agent: str, session_id: Optional[str]) -> str:
        """生成会话上下文键。

        不同发送方的相同 session_id 不会冲突。
        """
        sid = session_id or "__default__"
        return f"{from_agent}::{sid}"

    def get_context(
        self,
        from_agent: str,
        session_id: Optional[str] = None,
    ) -> dict:
        """获取指定会话的上下文。

        如果会话不存在，自动创建空上下文。

        Args:
            from_agent: 发送方 Agent ID。
            session_id: 会话标识（不传=默认会话）。

        Returns:
            会话上下文字典。
        """
        key = self._make_key(from_agent, session_id)
        if key not in self._contexts:
            self._contexts[key] = {}
        return self._contexts[key]

    def set_context(
        self,
        from_agent: str,
        session_id: Optional[str],
        data: dict,
    ) -> None:
        """设置会话上下文。

        Args:
            from_agent: 发送方 Agent ID。
            session_id: 会话标识。
            data: 上下文字典。
        """
        key = self._make_key(from_agent, session_id)
        self._contexts[key] = data

    def update_context(
        self,
        from_agent: str,
        session_id: Optional[str],
        data: dict,
    ) -> dict:
        """更新会话上下文（合并已有数据）。

        Args:
            from_agent: 发送方 Agent ID。
            session_id: 会话标识。
            data: 要合并的数据。

        Returns:
            更新后的上下文字典。
        """
        context = self.get_context(from_agent, session_id)
        context.update(data)
        return context

    def end_session(
        self,
        from_agent: str,
        session_id: str,
    ) -> None:
        """结束指定会话，清除上下文。

        Args:
            from_agent: 发送方 Agent ID。
            session_id: 会话标识。
        """
        key = self._make_key(from_agent, session_id)
        self._contexts.pop(key, None)

    def clean_stale(self, max_age_seconds: int = 86400) -> int:
        """清理超过指定时间未活跃的会话。

        Args:
            max_age_seconds: 最大不活跃时间（秒），默认 24 小时。

        Returns:
            清理的会话数。
        """
        # 注意：这里简化实现，实际需要记录每条消息的时间
        # 由外部在调用时决定清理策略
        return 0

    @property
    def active_count(self) -> int:
        """当前活跃的会话数。"""
        return len(self._contexts)


class MessageRouter:
    """消息路由器。

    协调消息去重、会话上下文管理。
    """

    def __init__(
        self,
        dedup: Optional[MessageDeduplicator] = None,
        sessions: Optional[SessionContext] = None,
    ) -> None:
        self._dedup = dedup or MessageDeduplicator()
        self._sessions = sessions or SessionContext()

    @property
    def deduplicator(self) -> MessageDeduplicator:
        """去重器实例。"""
        return self._dedup

    @property
    def sessions(self) -> SessionContext:
        """会话上下文实例。"""
        return self._sessions

    def route_message(self, msg: BusMessage) -> bool:
        """路由一条入站消息。

        先检查去重，再提取会话上下文。

        Args:
            msg: 入站消息。

        Returns:
            True 表示消息可继续处理，False 表示重复消息应跳过。
        """
        # 去重检查
        if self._dedup.is_duplicate(msg.message_id):
            return False

        # 标记为已处理
        self._dedup.mark_processed(msg.message_id)

        # 如果带 session_id，确保会话上下文存在
        if msg.session_id:
            self._sessions.get_context(msg.from_agent, msg.session_id)

        return True
```

---

## A.5 file_transfer.py — 文件传输

```python
"""
文件传输模块
============

支持两种文件传输方式，由配置决定，Agent 无感知：
- 方式A（沙箱）：通过独立文件沙箱 API 上传/下载，安全隔离
- 方式B（直传）：无沙箱环境兜底，支持 BASE64 内嵌、共享目录

如果检测到沙箱 API 可用 → 自动使用方式A
如果沙箱不可用 → 自动降级为方式B
"""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
import os
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .types import (
    BusChannelConfig,
    FileMode,
    FileTooLargeError,
    AuthError,
    ConnectionError as BusConnectionError,
)

logger = logging.getLogger(__name__)

# 沙箱文件大小上限（字节）
SANDBOX_MAX_SIZE = 100 * 1024 * 1024  # 100 MB
# BASE64 直传文件大小上限（字节）
BASE64_MAX_SIZE = 10 * 1024 * 1024  # 10 MB


class FileTransfer:
    """文件传输器。

    自动选择传输方式，对调用方透明。
    """

    def __init__(self, config: BusChannelConfig, token: str) -> None:
        """初始化文件传输器。

        Args:
            config: 插件配置。
            token: 当前有效的 Agent Token。
        """
        self._config = config
        self._token = token
        # _mode 设为 None，懒加载 — 第一次 upload() 时解析
        self._mode: Optional[FileMode] = None

    @property
    def mode(self) -> Optional[FileMode]:
        """当前使用的文件传输模式（首次 upload 前可能为 None）。"""
        return self._mode

    # ------------------------------------------------------------------
    # 上传
    # ------------------------------------------------------------------

    def upload(self, file_path: str, caption: Optional[str] = None) -> dict:
        """上传文件到总线。

        Args:
            file_path: 本地文件路径。
            caption: 文件描述。

        Returns:
            包含文件信息的字典（file_id, file_name, file_size 等）。

        Raises:
            FileNotFoundError: 文件不存在。
            FileTooLargeError: 文件超过大小限制。
            AuthError: 认证失败。
            BusConnectionError: 传输失败。
        """
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"文件不存在: {file_path}")

        file_size = path.stat().st_size
        file_name = path.name

        # 懒加载：第一次 upload() 时解析文件传输模式
        if self._mode is None:
            self._mode = self._resolve_mode(self._config, self._token)

        if self._mode == FileMode.SANDBOX:
            return self._upload_sandbox(path, file_name, file_size, caption)
        elif self._mode == FileMode.BASE64:
            return self._upload_base64(path, file_name, file_size, caption)
        elif self._mode == FileMode.SHARE:
            return self._upload_share(path, file_name, caption)
        else:
            # 默认降级为 BASE64
            return self._upload_base64(path, file_name, file_size, caption)

    # ------------------------------------------------------------------
    # 下载
    # ------------------------------------------------------------------

    def download(self, file_id: str) -> bytes:
        """从总线下载文件。

        Args:
            file_id: 文件 ID。

        Returns:
            文件二进制数据。

        Raises:
            AuthError: 认证失败。
            BusConnectionError: 下载失败。
        """
        if self._mode == FileMode.SANDBOX:
            return self._download_sandbox(file_id)
        elif self._mode == FileMode.SHARE:
            # 共享目录模式下，文件已经在本地共享目录中
            raise BusConnectionError(
                "共享目录模式不支持按 file_id 下载，请直接访问共享目录"
            )
        else:
            # BASE64 模式下文件是消息 content 的一部分，不单独下载
            raise BusConnectionError(
                "BASE64 直传模式下文件已内嵌在消息中，无需额外下载"
            )

    # ------------------------------------------------------------------
    # 模式选择
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_mode(config: BusChannelConfig, token: str) -> FileMode:
        """解析文件传输模式。

        优先级：配置指定 > 自动检测 > 默认 BASE64。

        Args:
            config: 插件配置。
            token: Agent Token（用于构建 HTTP 请求头）。

        Returns:
            确定的文件传输模式。
        """
        if config.file_mode is not None:
            return config.file_mode

        # 自动检测：如果有沙箱地址，尝试沙箱模式
        if config.file_api_url:
            try:
                req = Request(f"{config.file_api_url}/api/ping", method="GET",
                             headers={"Authorization": f"Bearer {token}"})
                with urlopen(req, timeout=1) as resp:
                    if resp.status == 200:
                        logger.info("[File] 沙箱 API 可用，使用沙箱传输模式")
                        return FileMode.SANDBOX
            except Exception:
                logger.warning("[File] 沙箱 API 不可用，降级为 BASE64 直传")

        # 默认 BASE64 直传
        return FileMode.BASE64

    # ------------------------------------------------------------------
    # 方式A：沙箱传输
    # ------------------------------------------------------------------

    def _upload_sandbox(
        self,
        path: Path,
        file_name: str,
        file_size: int,
        caption: Optional[str],
    ) -> dict:
        """通过沙箱 API 上传文件。

        Args:
            path: 本地文件路径。
            file_name: 文件名。
            file_size: 文件大小。
            caption: 文件描述。

        Returns:
            文件信息字典。
        """
        if file_size > SANDBOX_MAX_SIZE:
            raise FileTooLargeError(
                f"文件过大: {file_size} bytes（沙箱上限 {SANDBOX_MAX_SIZE} bytes）"
            )

        api_url = self._config.file_api_url or f"{self._config.bus_url}"
        url = f"{api_url}/api/files/upload"
        headers = {
            "Authorization": f"Bearer {self._token}",
            "X-File-Name": file_name,
            "X-File-Type": mimetypes.guess_type(str(path))[0] or "application/octet-stream",
        }

        try:
            data = path.read_bytes()
            req = Request(url, data=data, headers=headers, method="POST")
            with urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                file_id = result.get("file_id", "")
                logger.info("[File] 沙箱上传成功: %s → %s", file_name, file_id)
                return {
                    "file_id": file_id,
                    "file_name": file_name,
                    "file_size": file_size,
                    "caption": caption or "",
                }

        except HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            if e.code in (401, 403):
                raise AuthError(f"文件上传认证失败: {body}") from e
            raise BusConnectionError(
                f"文件上传失败 (HTTP {e.code}): {body}"
            ) from e

        except URLError as e:
            raise BusConnectionError(f"文件上传网络错误: {e.reason}") from e

    def _download_sandbox(self, file_id: str) -> bytes:
        """通过沙箱 API 下载文件。

        Args:
            file_id: 文件 ID。

        Returns:
            文件二进制数据。
        """
        api_url = self._config.file_api_url or f"{self._config.bus_url}"
        url = f"{api_url}/api/files/{file_id}"
        headers = {"Authorization": f"Bearer {self._token}"}

        try:
            req = Request(url, headers=headers, method="GET")
            with urlopen(req, timeout=60) as resp:
                data = resp.read()
                logger.info("[File] 沙箱下载成功: %s (%d bytes)", file_id, len(data))
                return data

        except HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            if e.code in (401, 403):
                raise AuthError(f"文件下载认证失败: {body}") from e
            raise BusConnectionError(
                f"文件下载失败 (HTTP {e.code}): {body}"
            ) from e

        except URLError as e:
            raise BusConnectionError(f"文件下载网络错误: {e.reason}") from e

    # ------------------------------------------------------------------
    # 方式B-1：BASE64 直传
    # ------------------------------------------------------------------

    def _upload_base64(
        self,
        path: Path,
        file_name: str,
        file_size: int,
        caption: Optional[str],
    ) -> dict:
        """将文件编码为 BASE64 后上传到总线 API。

        将编码内容 POST 到 /api/files/upload 获取 file_id，
        与沙箱模式返回结构一致。

        Args:
            path: 本地文件路径。
            file_name: 文件名。
            file_size: 文件大小。
            caption: 文件描述。

        Returns:
            文件信息字典（含 file_id）。

        Raises:
            FileTooLargeError: 文件超过大小限制。
            BusConnectionError: 上传失败。
        """
        max_size = self._config.max_file_size_mb * 1024 * 1024
        if file_size > max_size:
            raise FileTooLargeError(
                f"文件过大: {file_size} bytes（BASE64 模式上限 {max_size} bytes）"
            )

        data = path.read_bytes()
        encoded = base64.b64encode(data).decode("ascii")

        logger.info(
            "[File] BASE64 编码完成: %s (%d bytes → %d chars)",
            file_name,
            file_size,
            len(encoded),
        )

        # 上传 BASE64 内容到总线 API 获取 file_id
        api_url = self._config.file_api_url or f"{self._config.bus_url}"
        url = f"{api_url}/api/files/upload"
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

        body = {
            "file_name": file_name,
            "content": encoded,
            "encoding": "base64",
        }

        try:
            req = Request(
                url,
                data=json.dumps(body).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            with urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                file_id = result.get("file_id", "")
                logger.info("[File] BASE64 上传成功: %s → %s", file_name, file_id)
                return {
                    "file_id": file_id,
                    "file_name": file_name,
                    "file_size": file_size,
                    "caption": caption or "",
                }

        except HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            if e.code in (401, 403):
                raise AuthError(f"文件上传认证失败: {error_body}") from e
            raise BusConnectionError(
                f"文件上传失败 (HTTP {e.code}): {error_body}"
            ) from e

        except URLError as e:
            raise BusConnectionError(f"文件上传网络错误: {e.reason}") from e

    # ------------------------------------------------------------------
    # 方式B-3：共享目录
    # ------------------------------------------------------------------

    def _upload_share(
        self,
        path: Path,
        file_name: str,
        caption: Optional[str],
    ) -> dict:
        """使用共享目录传输文件。

        将文件复制到共享目录，返回共享路径引用。

        Args:
            path: 本地文件路径。
            file_name: 文件名。
            caption: 文件描述。

        Returns:
            包含共享路径的文件信息字典。
        """
        share_dir = self._config.share_dir
        if not share_dir:
            raise BusConnectionError("共享目录模式需要配置 share_dir")

        share_path = Path(share_dir) / file_name
        import shutil
        shutil.copy2(str(path), str(share_path))

        file_size = share_path.stat().st_size
        logger.info(
            "[File] 共享目录复制完成: %s → %s",
            path,
            share_path,
        )

        return {
            "file_path": str(share_path),
            "file_name": file_name,
            "file_size": file_size,
            "caption": caption or "",
        }

    # ------------------------------------------------------------------
    # 工具方法
    # ------------------------------------------------------------------

    @staticmethod
    def get_file_extension(file_path: str) -> str:
        """获取文件扩展名（小写，不含点）。

        Args:
            file_path: 文件路径。

        Returns:
            扩展名，如 "pdf"、"jpg"。
        """
        ext = Path(file_path).suffix.lower()
        return ext[1:] if ext.startswith(".") else ext

    @staticmethod
    def is_supported_file_type(file_path: str) -> bool:
        """检查文件类型是否受支持。

        Args:
            file_path: 文件路径。

        Returns:
            是否受支持。
        """
        supported = {
            # 图片
            "jpg", "jpeg", "png", "gif", "webp", "svg",
            # 文档
            "pdf", "docx", "xlsx", "pptx",
            # 代码
            "py", "js", "ts", "sh", "json", "yaml", "yml", "xml", "toml", "ini", "conf",
            # 压缩
            "zip", "gz", "tar", "rar", "7z",
            # 文本
            "txt", "md", "csv", "log",
        }
        return FileTransfer.get_file_extension(file_path) in supported
```

---

## A.6 poll_connection.py — HTTP 轮询

```python
"""
HTTP 轮询连接模式实现
====================

实现 PollConnection 类，负责通过 HTTP 轮询方式与总线通信。
使用标准库 urllib.request，无需额外依赖。

核心职责：
1. Agent 注册与认证（委托 AuthManager）
2. 定时轮询 inbox，拉取新消息
3. 通过 HTTP POST 发送消息
4. 心跳保活
5. 分页处理：has_more=true 时自动拉取下一页
6. 消息去重（委托 MessageRouter）
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Callable, Coroutine, Optional

from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from .auth import AuthManager
from .message import MessageRouter
from .types import (
    BusChannelConfig,
    BusMessage,
    ConnectionError,
    AuthError,
    OutboundMessage,
    SendResult,
)

logger = logging.getLogger(__name__)


class PollConnection:
    """HTTP 轮询连接管理器。

    通过定时 HTTP 轮询拉取 inbox 消息，使用 HTTP POST 发送消息。
    纯标准库实现，无额外依赖。

    Attributes:
        config: 总线配置。
        auth: 认证管理器。
        router: 消息路由器（用于去重）。
    """

    def __init__(
        self,
        config: BusChannelConfig,
        auth: AuthManager,
        router: Optional[MessageRouter] = None,
    ) -> None:
        """初始化 PollConnection。

        注意：构造函数不做任何 IO 操作。connect() 方法执行实际连接。

        Args:
            config: 总线配置。
            auth: 认证管理器。
            router: 消息路由器（可选，用于消息去重）。
        """
        self._config = config
        self._auth = auth
        self._router = router or MessageRouter()

        # HTTP 基础 URL（去掉末尾斜杠）
        self._base_url = config.bus_url.rstrip("/")

        # 消息处理器
        self._on_message: Optional[Callable[[BusMessage], Coroutine]] = None

        # 后台任务
        self._poll_task: Optional[asyncio.Task] = None
        self._heartbeat_task: Optional[asyncio.Task] = None

        # 状态控制
        self._connected: bool = False
        self._disconnect_requested: bool = False

        # 轮询配置
        self._poll_interval: float = float(config.poll_interval)

        # 心跳配置
        self._heartbeat_interval: float = float(config.heartbeat_interval)

    # ------------------------------------------------------------------
    # 公开属性
    # ------------------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        """检查是否已连接到总线。"""
        return self._connected

    # ------------------------------------------------------------------
    # 公开方法
    # ------------------------------------------------------------------

    async def connect(self) -> None:
        """启动轮询循环。

        注意：Agent 注册由上层（AgentBusPlugin.connect()）负责，
        本方法不执行注册，避免重复注册。

        Raises:
            ConnectionError: 无法连接总线。
        """
        if self._connected:
            logger.warning("[Poll] 已经连接，跳过重复 connect()")
            return

        # 首次心跳测试连接
        if not await asyncio.to_thread(self._heartbeat):
            raise ConnectionError("总线心跳检查失败，无法建立连接")

        # 设置连接状态
        self._disconnect_requested = False
        self._connected = True

        # 4. 启动后台任务
        self._poll_task = asyncio.create_task(
            self._poll_loop(),
            name="poll-loop",
        )
        self._heartbeat_task = asyncio.create_task(
            self._heartbeat_loop(),
            name="heartbeat-loop",
        )

        logger.info(
            "[Poll] 连接成功: agent=%s, bus=%s, poll_interval=%ds",
            self._auth.agent_id,
            self._base_url,
            self._poll_interval,
        )

    async def disconnect(self) -> None:
        """停止轮询循环，断开连接。"""
        if not self._connected:
            return

        self._disconnect_requested = True
        self._connected = False

        # 取消后台任务
        if self._poll_task is not None:
            self._poll_task.cancel()
            self._poll_task = None

        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None

        logger.info(
            "[Poll] 已断开连接: agent=%s",
            self._auth.agent_id,
        )

    def set_on_message(self, handler: Callable[[BusMessage], Coroutine]) -> None:
        """设置收到消息时的回调。

        Args:
            handler: 消息处理回调函数，接收 BusMessage。
        """
        self._on_message = handler

    async def send_message(self, msg: OutboundMessage) -> SendResult:
        """通过 HTTP POST 发送消息到总线。

        Args:
            msg: 出站消息。

        Returns:
            SendResult，success=True 表示发送成功。

        Raises:
            ConnectionError: 连接断开。
        """
        if not self._connected:
            return SendResult(
                success=False,
                error="连接未建立，无法发送消息",
            )

        try:
            # 构建请求体（只包含有值的字段）
            body: dict = {
                "to": msg.to,
                "type": msg.type,
                "content": msg.content,
            }
            if msg.ref_id is not None:
                body["ref_id"] = msg.ref_id
            if msg.session_id is not None:
                body["session_id"] = msg.session_id
            if msg.file_id is not None:
                body["file_id"] = msg.file_id
            if msg.file_ids is not None:
                body["file_ids"] = msg.file_ids
            if msg.caption is not None:
                body["caption"] = msg.caption

            # 可选字段：from
            body["from"] = self._auth.agent_id

            result = await asyncio.to_thread(
                self._send_http,
                "POST",
                "/api/messages/send",
                body,
            )

            message_id = result.get("message_id")
            if message_id:
                logger.debug(
                    "[Poll] 消息发送成功: to=%s, msg_id=%s",
                    msg.to,
                    message_id,
                )
                return SendResult(
                    success=True,
                    message_id=message_id,
                )
            else:
                logger.warning(
                    "[Poll] 消息发送成功但未返回 message_id: %s",
                    result,
                )
                return SendResult(
                    success=True,
                    message_id=None,
                )

        except AuthError as e:
            return SendResult(
                success=False,
                error=f"发送消息认证失败: {e}",
            )
        except ConnectionError as e:
            # 连接断开，标记状态
            self._connected = False
            return SendResult(
                success=False,
                error=f"发送消息连接失败: {e}",
            )
        except Exception as e:
            logger.exception("[Poll] 发送消息异常")
            return SendResult(
                success=False,
                error=f"发送消息异常: {e}",
            )

    # ------------------------------------------------------------------
    # 内部方法：轮询循环
    # ------------------------------------------------------------------

    async def _poll_loop(self) -> None:
        """轮询循环。

        每 N 秒拉取 inbox，有消息则回调 on_message 处理器。
        当收到 disconnect 信号或连接断开时退出循环。
        """
        logger.info("[Poll] 轮询循环已启动 (间隔=%ds)", self._poll_interval)

        while not self._disconnect_requested:
            try:
                # 拉取 inbox 消息
                messages = await asyncio.to_thread(self._fetch_inbox)

                # 分发消息
                for msg in messages:
                    await self._dispatch_message(msg)

            except asyncio.CancelledError:
                logger.info("[Poll] 轮询循环被取消")
                break
            except Exception as e:
                logger.warning(
                    "[Poll] 轮询异常: %s",
                    e,
                    exc_info=True,
                )

            # 等待下一个轮询周期
            try:
                await asyncio.sleep(self._poll_interval)
            except asyncio.CancelledError:
                logger.info("[Poll] 轮询循环在 sleep 中被取消")
                break

        logger.info("[Poll] 轮询循环已退出")

    async def _heartbeat_loop(self) -> None:
        """心跳循环。

        每 heartbeat_interval 秒发送一次心跳请求。
        """
        logger.info(
            "[Poll] 心跳循环已启动 (间隔=%ds)",
            self._heartbeat_interval,
        )

        while not self._disconnect_requested:
            try:
                await asyncio.sleep(self._heartbeat_interval)
                if self._disconnect_requested:
                    break

                ok = await asyncio.to_thread(self._heartbeat)
                if not ok:
                    logger.warning("[Poll] 心跳失败")

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug("[Poll] 心跳异常: %s", e)

    # ------------------------------------------------------------------
    # 内部方法：消息拉取与分发
    # ------------------------------------------------------------------

    def _fetch_inbox(self) -> list[BusMessage]:
        """拉取 inbox 消息（支持分页）。

        GET /api/messages/inbox?limit=20&mark_read=true
        当 has_more=true 时继续拉取下一页，直到全部拉完。

        Returns:
            去重后的 BusMessage 列表。

        Raises:
            ConnectionError: 无法连接总线。
            AuthError: 认证失败。
        """
        messages: list[BusMessage] = []
        page_token: Optional[str] = None

        while True:
            # 构建查询参数
            params = "limit=20&mark_read=true"
            if page_token:
                params += f"&page_token={page_token}"

            try:
                data = self._send_http("GET", f"/api/messages/inbox?{params}")

                # 解析消息列表
                raw_messages = data.get("messages", data.get("data", []))
                for raw in raw_messages:
                    msg = self._parse_bus_message(raw)
                    if msg is not None:
                        messages.append(msg)

                # 检查是否还有下一页
                has_more = data.get("has_more", False)
                if not has_more:
                    break

                page_token = data.get("next_page_token")
                if not page_token:
                    logger.warning(
                        "[Poll] has_more=true 但无 next_page_token，停止分页"
                    )
                    break

                logger.debug(
                    "[Poll] 拉取下一页: page_token=%s",
                    page_token,
                )

            except (ConnectionError, AuthError):
                raise
            except Exception as e:
                logger.error("[Poll] 拉取 inbox 失败: %s", e)
                break

        logger.debug(
            "[Poll] 拉取 inbox 完成: 共 %d 条消息",
            len(messages),
        )
        return messages

    async def _dispatch_message(self, msg: BusMessage) -> None:
        """分发单条消息。

        先通过 MessageRouter 进行去重检查，
        再调用 on_message 回调。

        Args:
            msg: 要分发的消息。
        """
        # 去重检查
        if not self._router.route_message(msg):
            logger.debug(
                "[Poll] 跳过重复消息: id=%s, from=%s",
                msg.message_id,
                msg.from_agent,
            )
            return

        # 调用消息处理器
        if self._on_message is not None:
            try:
                await self._on_message(msg)
            except Exception as e:
                logger.exception(
                    "[Poll] 消息处理器异常: msg_id=%s, error=%s",
                    msg.message_id,
                    e,
                )
        else:
            logger.debug(
                "[Poll] 未设置消息处理器，消息被丢弃: id=%s, from=%s, type=%s",
                msg.message_id,
                msg.from_agent,
                msg.type,
            )

    # ------------------------------------------------------------------
    # 内部方法：HTTP 通信
    # ------------------------------------------------------------------

    def _send_http(
        self,
        method: str,
        path: str,
        body: Optional[dict] = None,
    ) -> dict:
        """通用 HTTP 请求方法。

        Args:
            method: HTTP 方法（GET/POST/PUT/DELETE 等）。
            path: API 路径（如 /api/messages/inbox）。
            body: 请求体字典（可选，GET 请求不需传）。

        Returns:
            解析后的 JSON 响应字典。

        Raises:
            ConnectionError: 无法连接总线或 HTTP 错误。
            AuthError: 认证失败（HTTP 401/403）。
        """
        url = f"{self._base_url}{path}"
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        # 添加认证 header
        auth_headers = self._auth.build_auth_header()
        headers.update(auth_headers)

        # 构建请求
        data_bytes: Optional[bytes] = None
        if body is not None:
            data_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")

        try:
            req = Request(
                url,
                data=data_bytes,
                headers=headers,
                method=method,
            )

            with urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                if not raw:
                    return {}
                return json.loads(raw)

        except HTTPError as e:
            status = e.code
            error_body = e.read().decode("utf-8", errors="replace")

            if status in (401, 403):
                raise AuthError(
                    f"认证失败 (HTTP {status}): {error_body}"
                ) from e
            else:
                raise ConnectionError(
                    f"HTTP 请求失败 (HTTP {status}): {error_body}"
                ) from e

        except URLError as e:
            raise ConnectionError(
                f"无法连接总线 ({url}): {e.reason}"
            ) from e

        except json.JSONDecodeError as e:
            raise ConnectionError(
                f"响应 JSON 解析失败: {e}"
            ) from e

    def _heartbeat(self) -> bool:
        """发送心跳请求。

        GET /api/ping

        Returns:
            True 表示心跳成功，False 表示失败。
        """
        try:
            self._send_http("GET", "/api/ping")
            return True
        except (ConnectionError, AuthError) as e:
            logger.warning("[Poll] 心跳失败: %s", e)
            return False
        except Exception as e:
            logger.debug("[Poll] 心跳异常: %s", e)
            return False

    # ------------------------------------------------------------------
    # 辅助方法
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_bus_message(raw: dict) -> Optional[BusMessage]:
        """将原始字典解析为 BusMessage。

        Args:
            raw: 原始消息字典。

        Returns:
            解析后的 BusMessage，如果缺少必要字段则返回 None。
        """
        try:
            # 必要字段检查
            message_id = raw.get("message_id") or raw.get("id")
            from_agent = raw.get("from_agent") or raw.get("from")
            sender_type = raw.get("sender_type", "agent")
            to_agent = raw.get("to_agent") or raw.get("to")
            msg_type = raw.get("type", "text")
            content = raw.get("content", "")
            sent_at = raw.get("sent_at") or raw.get("timestamp", "")

            if not message_id or not from_agent:
                logger.warning(
                    "[Poll] 消息缺少必要字段: id=%s, from=%s",
                    message_id,
                    from_agent,
                )
                return None

            return BusMessage(
                message_id=message_id,
                from_agent=from_agent,
                sender_type=sender_type,
                to_agent=to_agent or "",
                type=msg_type,
                content=content,
                sent_at=sent_at,
                ref_id=raw.get("ref_id"),
                session_id=raw.get("session_id"),
                file_id=raw.get("file_id"),
                file_ids=raw.get("file_ids"),
                file_name=raw.get("file_name"),
                file_size=raw.get("file_size"),
                caption=raw.get("caption"),
            )

        except Exception as e:
            logger.error(
                "[Poll] 消息解析失败: %s, raw=%s",
                e,
                raw,
            )
            return None
```

---

## A.7 ws_connection.py — WebSocket

```python
"""
WebSocket 连接模式实现
======================

实现了 WsConnection 类，负责 WebSocket 的连接管理、
消息收发、心跳保活、断线自动重连。

核心职责：
1. 建立/断开 WS 连接
2. 发送认证 header
3. 消息监听与分发
4. 心跳保活（30 秒间隔，10 秒超时，3 次失败断线重连）
5. 断线自动重连（间隔可配置）
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Callable, Coroutine, Optional

import websockets
from websockets.asyncio.client import ClientConnection

from .auth import AuthManager
from .message import MessageRouter
from .types import (
    BusChannelConfig,
    BusMessage,
    ConnectionError,
    OutboundMessage,
    SendResult,
    WsFrame,
    WsFrameType,
)

logger = logging.getLogger(__name__)


class WsConnection:
    """WebSocket 连接管理器。

    管理一条到总线的 WebSocket 连接，包含认证、心跳、消息监听和自动重连。

    Attributes:
        config: 总线配置。
        auth: 认证管理器。
        router: 消息路由器（用于去重）。
    """

    def __init__(
        self,
        config: BusChannelConfig,
        auth: AuthManager,
        router: Optional[MessageRouter] = None,
    ) -> None:
        """初始化 WsConnection。

        注意：构造函数不做任何 IO 操作。connect() 方法执行实际连接。

        Args:
            config: 总线配置。
            auth: 认证管理器。
            router: 消息路由器（可选，用于消息去重）。
        """
        self._config = config
        self._auth = auth
        self._router = router or MessageRouter()

        # WebSocket 连接
        self._ws: Optional[ClientConnection] = None

        # 后台任务
        self._listen_task: Optional[asyncio.Task] = None
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._reconnect_task: Optional[asyncio.Task] = None

        # 状态控制
        self._disconnect_requested: bool = False
        self._connected: bool = False
        self._agent_id: str = ""

        # 心跳状态
        self._pong_received: bool = True
        self._missed_pongs: int = 0
        self._max_missed_pongs: int = 3
        self._heartbeat_interval: float = float(
            self._config.heartbeat_interval
        )
        self._pong_timeout: float = 10.0
        self._reconnect_interval: float = float(
            self._config.reconnect_interval
        )

        # 消息回调
        self._on_message: Optional[Callable[[BusMessage], Coroutine]] = None

        # 事件循环引用（在 connect 时设置）
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        # ack 等待：request_id → Future[SendResult]
        self._pending_acks: dict[str, asyncio.Future[SendResult]] = {}
        self._ack_timeout: int = 10

    # ------------------------------------------------------------------
    # Property
    # ------------------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        """检查是否已连接到总线。"""
        return self._connected

    @property
    def agent_id(self) -> str:
        """返回本 Agent 在总线上的 ID。"""
        return self._agent_id or self._auth.agent_id

    # ------------------------------------------------------------------
    # 回调设置
    # ------------------------------------------------------------------

    def set_on_message(
        self, handler: Optional[Callable[[BusMessage], Coroutine]]
    ) -> None:
        """设置收到消息时的回调。

        Args:
            handler: 消息处理回调，接收 BusMessage 对象。
                     传入 None 可清除回调。
        """
        self._on_message = handler

    # ------------------------------------------------------------------
    # 连接管理
    # ------------------------------------------------------------------

    async def connect(self) -> None:
        """建立 WebSocket 连接。

        1. 构建带认证 header 的 WS URI
        2. 建立连接
        3. 等待 connected 帧确认
        4. 启动监听和心跳任务

        Raises:
            ConnectionError: 连接失败或认证失败。
        """
        if self._connected:
            logger.warning("[WS] 已连接，忽略重复连接请求")
            return

        self._disconnect_requested = False
        self._loop = asyncio.get_running_loop()

        ws_url = self._config.bus_ws_url
        if not ws_url:
            raise ConnectionError("WebSocket URL 未配置 (bus_ws_url)")

        # 构建带认证 header 的连接
        headers = self._auth.build_ws_headers()

        try:
            logger.info("[WS] 正在连接: %s (agent=%s)", ws_url, self._auth.agent_id)
            self._ws = await websockets.connect(
                ws_url,
                additional_headers=headers,
                # ping_interval=None 禁用 websockets 库自带的心跳，
                # 我们自行实现心跳逻辑
                ping_interval=None,
                close_timeout=5,
            )
            logger.info("[WS] TCP 连接已建立，等待认证...")

            # 等待 connected 帧
            message = await asyncio.wait_for(
                self._ws.recv(), timeout=15.0
            )
            frame = self._parse_frame(message)

            if frame.ws_type != WsFrameType.CONNECTED:
                error_detail = frame.payload or frame.code or "未知错误"
                await self._ws.close()
                self._ws = None
                raise ConnectionError(
                    f"WS 认证失败: 期望 connected 帧，收到 {frame.ws_type.value}: {error_detail}"
                )

            # 提取 agent_id
            if frame.payload and "agent_id" in frame.payload:
                self._agent_id = frame.payload["agent_id"]
            else:
                self._agent_id = self._auth.agent_id

            self._connected = True
            logger.info(
                "[WS] 连接成功: agent_id=%s", self._agent_id
            )

            # 启动后台任务
            self._listen_task = asyncio.create_task(self._listen_loop())
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        except asyncio.TimeoutError:
            if self._ws:
                await self._ws.close()
                self._ws = None
            raise ConnectionError(
                "WS 认证超时: 连接建立后 15 秒内未收到 connected 帧"
            )
        except websockets.WebSocketException as e:
            self._ws = None
            raise ConnectionError(f"WS 连接失败: {e}") from e
        except ConnectionError:
            raise
        except Exception as e:
            self._ws = None
            raise ConnectionError(f"WS 连接异常: {e}") from e

    async def disconnect(self) -> None:
        """断开 WebSocket 连接，停止所有后台任务。"""
        self._disconnect_requested = True
        self._connected = False

        # 取消后台任务
        await self._cancel_task(self._listen_task)
        await self._cancel_task(self._heartbeat_task)
        await self._cancel_task(self._reconnect_task)

        self._listen_task = None
        self._heartbeat_task = None
        self._reconnect_task = None

        # 关闭 WS 连接
        if self._ws is not None:
            try:
                await self._ws.close()
                logger.info("[WS] 连接已关闭")
            except Exception as e:
                logger.warning("[WS] 关闭连接时异常: %s", e)
            finally:
                self._ws = None

        # 清除待确认的 ack
        for future in self._pending_acks.values():
            if not future.done():
                future.cancel()
        self._pending_acks.clear()

        logger.info("[WS] 已断开")

    # ------------------------------------------------------------------
    # 消息发送
    # ------------------------------------------------------------------

    async def send_message(self, msg: OutboundMessage) -> SendResult:
        """通过 WebSocket 发送消息帧，等待 ack 确认。

        Args:
            msg: 出站消息。

        Returns:
            SendResult，包含 message_id（收到 ack 时）。

        Raises:
            ConnectionError: 未连接到总线。
        """
        if not self._connected or self._ws is None:
            return SendResult(success=False, error="无法发送消息: 未连接到总线")

        request_id = uuid.uuid4().hex[:16]

        # 将 OutboundMessage 转为 payload 字典
        payload = {
            "to": msg.to,
            "type": msg.type,
            "content": msg.content,
        }
        if msg.ref_id is not None:
            payload["ref_id"] = msg.ref_id
        if msg.session_id is not None:
            payload["session_id"] = msg.session_id
        if msg.file_id is not None:
            payload["file_id"] = msg.file_id
        if msg.file_ids is not None:
            payload["file_ids"] = msg.file_ids
        if msg.caption is not None:
            payload["caption"] = msg.caption

        frame = WsFrame(
            ws_type=WsFrameType.MESSAGE,
            payload=payload,
            request_id=request_id,
        )

        try:
            data = self._serialize_frame(frame)
            await self._ws.send(data)
        except websockets.WebSocketException as e:
            self._connected = False
            return SendResult(success=False, error=f"发送消息失败: {e}")
        except Exception as e:
            return SendResult(success=False, error=f"发送消息异常: {e}")

        # 等待 ack（10 秒超时兜底）
        future: asyncio.Future[SendResult] = asyncio.get_running_loop().create_future()
        self._pending_acks[request_id] = future

        try:
            result = await asyncio.wait_for(future, timeout=self._ack_timeout)
            return result
        except asyncio.TimeoutError:
            self._pending_acks.pop(request_id, None)
            # 超时视为成功但无 message_id
            return SendResult(success=True)
        except Exception as e:
            self._pending_acks.pop(request_id, None)
            return SendResult(success=False, error=str(e))

    async def send_frame(self, frame: WsFrame) -> None:
        """发送 WebSocket 帧（异步内部方法）。

        Args:
            frame: 要发送的 WsFrame。

        Raises:
            ConnectionError: 未连接或发送失败。
        """
        await self._send_frame(frame)

    async def _send_frame(self, frame: WsFrame) -> None:
        """发送帧的内部实现。

        Args:
            frame: 要发送的 WsFrame。

        Raises:
            ConnectionError: 未连接或发送失败。
        """
        if self._ws is None:
            raise ConnectionError("无法发送消息: WebSocket 未连接")

        try:
            data = self._serialize_frame(frame)
            await self._ws.send(data)
            if frame.ws_type == WsFrameType.MESSAGE:
                logger.debug(
                    "[WS] 消息已发送: type=%s", frame.payload.get("type", "unknown")
                )
            else:
                logger.debug("[WS] 帧已发送: type=%s", frame.ws_type.value)
        except websockets.WebSocketException as e:
            self._connected = False
            raise ConnectionError(f"发送消息失败: {e}") from e

    # ------------------------------------------------------------------
    # 监听循环
    # ------------------------------------------------------------------

    async def _listen_loop(self) -> None:
        """消息监听循环。

        持续从 WebSocket 接收帧，解析后处理：
        - message 帧：去重后调用 on_message 回调
        - ping 帧：回复 pong
        - pong 帧：标记为已收到
        - ack 帧：记录确认（日志）
        - error 帧：记录错误
        - session_end 帧：记录会话结束
        - connected 帧：忽略（已在 connect 时处理）
        """
        ws = self._ws
        if ws is None:
            return

        logger.info("[WS] 监听循环已启动")

        try:
            async for raw_message in ws:
                # 检查是否已请求断开
                if self._disconnect_requested:
                    break

                try:
                    frame = self._parse_frame(raw_message)
                except (json.JSONDecodeError, ValueError) as e:
                    logger.warning("[WS] 解析帧失败: %s", e)
                    continue

                await self._handle_frame(frame)

        except websockets.ConnectionClosed as e:
            logger.warning("[WS] 连接关闭: code=%s, reason=%s", e.code, e.reason)
        except asyncio.CancelledError:
            logger.info("[WS] 监听任务已取消")
        except Exception as e:
            logger.error("[WS] 监听循环异常: %s", e)
        finally:
            self._connected = False
            # 如果不是主动断开，启动重连
            if not self._disconnect_requested:
                logger.info("[WS] 意外断开，启动重连...")
                asyncio.create_task(self._reconnect())

    async def _handle_frame(self, frame: WsFrame) -> None:
        """处理接收到的帧。

        Args:
            frame: 解析后的 WsFrame。
        """
        frame_type = frame.ws_type

        if frame_type == WsFrameType.MESSAGE:
            await self._handle_message_frame(frame)
        elif frame_type == WsFrameType.PING:
            logger.debug("[WS] 收到 ping，回复 pong")
            await self._send_frame(
                WsFrame(ws_type=WsFrameType.PONG)
            )
        elif frame_type == WsFrameType.PONG:
            self._pong_received = True
            self._missed_pongs = 0
            logger.debug("[WS] 收到 pong")
        elif frame_type == WsFrameType.ACK:
            msg_id = frame.message_id or "unknown"
            req_id = frame.request_id or ""
            logger.debug("[WS] 收到 ack: message_id=%s, request_id=%s", msg_id, req_id)
            # 匹配 pending_acks
            if req_id and req_id in self._pending_acks:
                future = self._pending_acks.pop(req_id)
                if not future.done():
                    future.set_result(SendResult(success=True, message_id=msg_id))
        elif frame_type == WsFrameType.ERROR:
            code = frame.code or "unknown"
            payload = frame.payload or {}
            logger.error(
                "[WS] 收到错误帧: code=%s, payload=%s", code, payload
            )
        elif frame_type == WsFrameType.SESSION_END:
            agent = (frame.payload or {}).get("agent_id", "unknown")
            sid = (frame.payload or {}).get("session_id", "unknown")
            logger.info("[WS] 会话结束: agent=%s, session=%s", agent, sid)
        elif frame_type == WsFrameType.CONNECTED:
            # 连接成功帧，connect() 中已处理，此处忽略
            pass
        else:
            logger.debug("[WS] 收到未知帧类型: %s", frame_type.value)

    async def _handle_message_frame(self, frame: WsFrame) -> None:
        """处理消息帧：去重后调用回调。

        Args:
            frame: 消息帧。
        """
        if frame.payload is None:
            logger.warning("[WS] 收到空 payload 的消息帧")
            return

        try:
            bus_msg = BusMessage(**frame.payload)
        except TypeError as e:
            logger.error("[WS] 消息帧 payload 格式错误: %s, payload=%s", e, frame.payload)
            return

        # 去重
        if not self._router.route_message(bus_msg):
            logger.debug("[WS] 重复消息已跳过: message_id=%s", bus_msg.message_id)
            return

        # 调用回调
        if self._on_message is not None:
            try:
                await self._on_message(bus_msg)
            except Exception as e:
                logger.error(
                    "[WS] 消息回调异常: message_id=%s, error=%s",
                    bus_msg.message_id,
                    e,
                )
        else:
            logger.debug(
                "[WS] 收到消息但未设置回调: message_id=%s",
                bus_msg.message_id,
            )

    # ------------------------------------------------------------------
    # 心跳循环
    # ------------------------------------------------------------------

    async def _heartbeat_loop(self) -> None:
        """心跳保活循环。

        每 30 秒发送一次 ping，等待 pong 响应（10 秒超时）。
        连续 3 次未收到 pong 判定断线，触发自动重连。
        """
        logger.info(
            "[WS] 心跳循环已启动 (间隔=%ss, pong超时=%ss)",
            self._heartbeat_interval,
            self._pong_timeout,
        )

        try:
            while not self._disconnect_requested:
                await asyncio.sleep(self._heartbeat_interval)

                if self._disconnect_requested or not self._connected:
                    break

                # 重置 pong 状态
                self._pong_received = False

                # 发送 ping
                try:
                    await self._send_frame(WsFrame(ws_type=WsFrameType.PING))
                    logger.debug("[WS] 心跳 ping 已发送")
                except ConnectionError:
                    logger.warning("[WS] 心跳发送失败")
                    self._missed_pongs += 1
                    self._check_heartbeat_failure()
                    continue

                # 等待 pong（超时 10 秒）
                try:
                    await asyncio.wait_for(
                        self._wait_for_pong(),
                        timeout=self._pong_timeout,
                    )
                    # pong 已收到，继续
                    continue
                except asyncio.TimeoutError:
                    self._missed_pongs += 1
                    logger.warning(
                        "[WS] 心跳 pong 超时 (%d/%d)",
                        self._missed_pongs,
                        self._max_missed_pongs,
                    )
                    self._check_heartbeat_failure()

        except asyncio.CancelledError:
            logger.info("[WS] 心跳任务已取消")
        except Exception as e:
            logger.error("[WS] 心跳循环异常: %s", e)
            if not self._disconnect_requested:
                asyncio.create_task(self._reconnect())

    async def _wait_for_pong(self) -> None:
        """等待 pong 响应。

        循环检查 _pong_received 标志，直到收到 pong 或超时。
        """
        while not self._pong_received:
            if self._disconnect_requested:
                return
            await asyncio.sleep(0.1)

    def _check_heartbeat_failure(self) -> None:
        """检查心跳失败次数是否达到阈值，触发重连。"""
        if self._missed_pongs >= self._max_missed_pongs:
            logger.error(
                "[WS] 心跳失败 %d 次，触发断线重连",
                self._missed_pongs,
            )
            self._connected = False
            if self._ws is not None:
                asyncio.create_task(self._close_ws())
            if not self._disconnect_requested:
                asyncio.create_task(self._reconnect())

    async def _close_ws(self) -> None:
        """安全关闭 WebSocket 连接。"""
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            finally:
                self._ws = None

    # ------------------------------------------------------------------
    # 自动重连
    # ------------------------------------------------------------------

    async def _reconnect(self) -> None:
        """断线自动重连。

        等待配置的间隔时间后，尝试重新建立连接。
        如果重连成功，重新启动监听和心跳任务。
        如果重连失败，继续重试（除非主动断开）。
        """
        # 避免多个重连任务同时运行
        if self._reconnect_task is not None and not self._reconnect_task.done():
            logger.debug("[WS] 重连任务已在运行，跳过")
            return

        self._reconnect_task = asyncio.create_task(self._do_reconnect())

    async def _do_reconnect(self) -> None:
        """实际执行重连的内部方法。

        使用指数退避策略：从 reconnect_interval 开始，每次翻倍，
        不超过 max_reconnect_interval（默认 30 秒）。
        达到 max_reconnect_attempts 次失败后停止重连。
        """
        base_interval = max(self._reconnect_interval, 1.0)  # 下限 1 秒
        max_interval = float(self._config.max_reconnect_interval)
        max_attempts = self._config.max_reconnect_attempts
        attempt = 0

        while not self._disconnect_requested:
            # 检查重连次数上限
            if max_attempts >= 0 and attempt >= max_attempts:
                msg = f"[WS] 重连已达上限 ({max_attempts} 次)，停止重连"
                logger.error(msg)
                if self._config.on_error:
                    self._config.on_error(ConnectionError(msg))
                break

            # 指数退避：基数 × 2^attempt，不超过上限
            backoff = min(base_interval * (2 ** attempt), max_interval)
            attempt += 1

            logger.info(
                "[WS] 等待 %.1f 秒后重连... (第 %d 次)",
                backoff, attempt,
            )
            await asyncio.sleep(backoff)

            if self._disconnect_requested:
                break

            try:
                # 重置心跳状态
                self._pong_received = True
                self._missed_pongs = 0

                await self.connect()
                logger.info("[WS] 重连成功 (第 %d 次)", attempt)
                return

            except ConnectionError as e:
                logger.warning("[WS] 重连失败 (第 %d 次): %s", attempt, e)
            except Exception as e:
                logger.error("[WS] 重连异常 (第 %d 次): %s", attempt, e)

        logger.info("[WS] 重连任务结束")

    # ------------------------------------------------------------------
    # 辅助方法
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_frame(raw: str | bytes) -> WsFrame:
        """解析 WS 原始消息为 WsFrame。

        Args:
            raw: 原始消息（JSON 字符串或 bytes）。

        Returns:
            解析后的 WsFrame。

        Raises:
            json.JSONDecodeError: JSON 格式错误。
            ValueError: 缺少必填字段。
        """
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")

        data = json.loads(raw)

        if "ws_type" not in data:
            raise ValueError("帧缺少 ws_type 字段")

        ws_type = WsFrameType(data["ws_type"])
        payload = data.get("payload")

        # 从帧根层级提取标准字段（总线协议约定）
        message_id = data.get("message_id")
        code = data.get("code")
        request_id = data.get("request_id")

        # 兼容旧规范：如果根层级没有，才从 payload 找
        if message_id is None and isinstance(payload, dict):
            message_id = payload.get("message_id")
        if code is None and isinstance(payload, dict):
            code = payload.get("code")

        return WsFrame(
            ws_type=ws_type,
            payload=payload,
            message_id=message_id,
            code=code,
            request_id=request_id,
        )

    @staticmethod
    def _serialize_frame(frame: WsFrame) -> str:
        """序列化 WsFrame 为 JSON 字符串。

        Args:
            frame: 要序列化的帧。

        Returns:
            JSON 字符串。
        """
        data: dict = {"ws_type": frame.ws_type.value}

        if frame.payload is not None:
            data["payload"] = frame.payload
        if frame.message_id is not None:
            data["message_id"] = frame.message_id
        if frame.code is not None:
            data["code"] = frame.code
        if frame.request_id is not None:
            data["request_id"] = frame.request_id

        return json.dumps(data, ensure_ascii=False)

    @staticmethod
    async def _cancel_task(task: Optional[asyncio.Task]) -> None:
        """安全取消一个 asyncio 任务。

        Args:
            task: 要取消的任务，None 则跳过。
        """
        if task is None or task.done():
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning("[WS] 取消任务时异常: %s", e)
```

---

## A.8 __init__.py — 插件入口

```python
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
```

---

## A.9 tests/test_all.py — 测试套件

```python
"""
agent-bus-channel-plugin 测试
=============================

测试覆盖：数据结构、配置解析、消息路由、文件传输。
网络相关测试（WS/HTTP 连接）需要 mock 或实际总线。
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

# 确保包在路径中
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bus_channel.types import (
    BusMessage,
    BusChannelConfig,
    OutboundMessage,
    SendResult,
    WsFrame,
    WsFrameType,
    FileMode,
    BusChannelError,
    ConnectionError,
    AuthError,
    FileTooLargeError,
)
from bus_channel.config import load_config
from bus_channel.message import MessageDeduplicator, SessionContext, MessageRouter
from bus_channel.file_transfer import FileTransfer


# =============================================================================
# 数据结构测试
# =============================================================================


class TestBusMessage(unittest.TestCase):
    """测试 BusMessage 数据结构。"""

    def test_minimal(self):
        """最简消息。"""
        msg = BusMessage(
            message_id="msg_001",
            from_agent="agent_a",
            sender_type="agent",
            to_agent="agent_b",
            type="text",
            content="你好",
            sent_at="2026-05-29T14:00:00Z",
        )
        self.assertEqual(msg.message_id, "msg_001")
        self.assertEqual(msg.from_agent, "agent_a")
        self.assertEqual(msg.sender_type, "agent")
        self.assertEqual(msg.type, "text")
        self.assertIsNone(msg.session_id)
        self.assertIsNone(msg.file_id)

    def test_with_file(self):
        """文件消息。"""
        msg = BusMessage(
            message_id="msg_002",
            from_agent="agent_b",
            sender_type="agent",
            to_agent="agent_a",
            type="file",
            content="报告",
            sent_at="2026-05-29T14:01:00Z",
            file_id="f_abc123",
            file_name="report.pdf",
            file_size=1024000,
            caption="季度报告",
            session_id="task-report",
        )
        self.assertEqual(msg.file_id, "f_abc123")
        self.assertEqual(msg.file_name, "report.pdf")
        self.assertEqual(msg.file_size, 1024000)
        self.assertEqual(msg.caption, "季度报告")
        self.assertEqual(msg.session_id, "task-report")

    def test_with_ref_id(self):
        """引用消息。"""
        msg = BusMessage(
            message_id="msg_003",
            from_agent="agent_a",
            sender_type="agent",
            to_agent="agent_b",
            type="text",
            content="收到",
            sent_at="2026-05-29T14:02:00Z",
            ref_id="msg_001",
        )
        self.assertEqual(msg.ref_id, "msg_001")


class TestOutboundMessage(unittest.TestCase):
    """测试 OutboundMessage。"""

    def test_minimal(self):
        msg = OutboundMessage(to="agent_b", type="text", content="你好")
        self.assertEqual(msg.to, "agent_b")
        self.assertEqual(msg.type, "text")
        self.assertEqual(msg.content, "你好")
        self.assertIsNone(msg.session_id)

    def test_with_session(self):
        msg = OutboundMessage(
            to="agent_b", type="task", content="查一下",
            session_id="task-001",
        )
        self.assertEqual(msg.session_id, "task-001")


class TestSendResult(unittest.TestCase):
    """测试 SendResult。"""

    def test_success(self):
        r = SendResult(success=True, message_id="msg_001")
        self.assertTrue(r.success)
        self.assertEqual(r.message_id, "msg_001")
        self.assertIsNone(r.error)

    def test_failure(self):
        r = SendResult(success=False, error="连接超时")
        self.assertFalse(r.success)
        self.assertEqual(r.error, "连接超时")
        self.assertIsNone(r.message_id)


class TestWsFrame(unittest.TestCase):
    """测试 WsFrame。"""

    def test_message_frame(self):
        frame = WsFrame(
            ws_type=WsFrameType.MESSAGE,
            payload={"type": "text", "content": "你好"},
        )
        self.assertEqual(frame.ws_type, WsFrameType.MESSAGE)
        self.assertEqual(frame.payload, {"type": "text", "content": "你好"})

    def test_ping(self):
        frame = WsFrame(ws_type=WsFrameType.PING)
        self.assertEqual(frame.ws_type, WsFrameType.PING)


# =============================================================================
# 配置解析测试
# =============================================================================


class TestConfig(unittest.TestCase):
    """测试配置解析。"""

    def test_from_dict_minimal(self):
        """最简配置（仅 bus_url），应使用默认模式 poll（不需要 ws_url）。"""
        config = load_config({
            "bus_url": "http://localhost:4322",
            "mode": "poll",
            "agent_id": "test-agent",
            "agent_token": "test-token",
        })
        self.assertEqual(config.bus_url, "http://localhost:4322")
        self.assertEqual(config.mode, "poll")
        self.assertEqual(config.poll_interval, 3)

    def test_from_dict_full(self):
        """完整配置。"""
        config = load_config({
            "mode": "poll",
            "bus_url": "http://localhost:4322",
            "bus_ws_url": "ws://localhost:4322/ws",
            "agent_id": "agent_a",
            "agent_token": "test-token",
            "poll_interval": 5,
            "reconnect_interval": 2,
            "heartbeat_interval": 30,
        })
        self.assertEqual(config.mode, "poll")
        self.assertEqual(config.agent_id, "agent_a")
        self.assertEqual(config.poll_interval, 5)

    def test_from_json_file(self):
        """从 JSON 文件加载。"""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8",
        ) as f:
            json.dump({
                "bus_url": "http://test:4322",
                "mode": "poll",
                "agent_id": "test-agent",
                "agent_token": "test-token",
            }, f)
            f.flush()
            config_path = f.name

        try:
            config = load_config(config_path=config_path)
            self.assertEqual(config.bus_url, "http://test:4322")
            self.assertEqual(config.mode, "poll")
        finally:
            os.unlink(config_path)

    def test_missing_bus_url(self):
        """缺少 bus_url 应报错。"""
        with self.assertRaises(ValueError):
            load_config({"mode": "websocket"})

    def test_ws_mode_missing_ws_url(self):
        """WS 模式缺少 bus_ws_url 应报错。"""
        with self.assertRaises(ValueError):
            load_config({"mode": "websocket", "bus_url": "http://test:4322"})


# =============================================================================
# 消息去重测试
# =============================================================================


class TestMessageDeduplicator(unittest.TestCase):
    """测试消息去重。"""

    def setUp(self):
        self.dedup = MessageDeduplicator(max_size=5)

    def test_new_message(self):
        """新消息不应判重。"""
        self.assertFalse(self.dedup.is_duplicate("msg_001"))

    def test_duplicate(self):
        """已处理的消息应判重。"""
        self.dedup.mark_processed("msg_001")
        self.assertTrue(self.dedup.is_duplicate("msg_001"))

    def test_mark_then_is_duplicate(self):
        """mark_processed 后 is_duplicate 返回 True。"""
        self.dedup.mark_processed("msg_001")
        self.assertTrue(self.dedup.is_duplicate("msg_001"))

    def test_lru_eviction(self):
        """超过上限时淘汰最旧的。"""
        for i in range(10):
            self.dedup.mark_processed(f"msg_{i:03d}")
        # 前5条应被淘汰
        self.assertFalse(self.dedup.is_duplicate("msg_000"))
        # 后5条应保留
        self.assertTrue(self.dedup.is_duplicate("msg_009"))

    def test_clear(self):
        """清空后所有消息不再判重。"""
        self.dedup.mark_processed("msg_001")
        self.dedup.clear()
        self.assertFalse(self.dedup.is_duplicate("msg_001"))


# =============================================================================
# 会话上下文测试
# =============================================================================


class TestSessionContext(unittest.TestCase):
    """测试会话上下文管理。"""

    def setUp(self):
        self.sessions = SessionContext()

    def test_default_session(self):
        """不传 session_id 使用默认会话。"""
        ctx = self.sessions.get_context("agent_a")
        self.assertIsNotNone(ctx)
        self.assertEqual(ctx, {})

    def test_named_session(self):
        """传 session_id 使用独立会话。"""
        ctx_a = self.sessions.get_context("agent_a", "stock")
        ctx_b = self.sessions.get_context("agent_a", "education")
        self.assertIsNot(ctx_a, ctx_b)  # 不同会话

    def test_context_isolation(self):
        """不同会话上下文隔离。"""
        self.sessions.set_context("agent_a", "stock", {"topic": "股票"})
        self.sessions.set_context("agent_a", "education", {"topic": "教育"})
        ctx_a = self.sessions.get_context("agent_a", "stock")
        ctx_b = self.sessions.get_context("agent_a", "education")
        self.assertEqual(ctx_a["topic"], "股票")
        self.assertEqual(ctx_b["topic"], "教育")

    def test_different_senders_same_session_id(self):
        """不同发送方相同 session_id 不会冲突。"""
        self.sessions.set_context("agent_a", "task-001", {"task": "A"})
        self.sessions.set_context("agent_b", "task-001", {"task": "B"})
        ctx_a = self.sessions.get_context("agent_a", "task-001")
        ctx_b = self.sessions.get_context("agent_b", "task-001")
        self.assertEqual(ctx_a["task"], "A")
        self.assertEqual(ctx_b["task"], "B")

    def test_end_session(self):
        """结束会话后上下文被清除。"""
        self.sessions.get_context("agent_a", "tmp")["data"] = 123
        self.sessions.end_session("agent_a", "tmp")
        # 结束后重新获取应返回空字典
        ctx = self.sessions.get_context("agent_a", "tmp")
        self.assertEqual(ctx, {})


# =============================================================================
# 消息路由测试
# =============================================================================


class TestMessageRouter(unittest.TestCase):
    """测试消息路由器。"""

    def setUp(self):
        self.router = MessageRouter()
        self.msg = BusMessage(
            message_id="msg_001",
            from_agent="agent_a",
            sender_type="agent",
            to_agent="agent_b",
            type="text",
            content="你好",
            sent_at="2026-05-29T14:00:00Z",
        )

    def test_route_new_message(self):
        """新消息应返回 True。"""
        self.assertTrue(self.router.route_message(self.msg))

    def test_route_duplicate(self):
        """重复消息应返回 False。"""
        self.router.route_message(self.msg)
        self.assertFalse(self.router.route_message(self.msg))

    def test_route_with_session(self):
        """带 session_id 的消息应创建会话上下文。"""
        self.msg.session_id = "test-session"
        self.router.route_message(self.msg)
        ctx = self.router.sessions.get_context("agent_a", "test-session")
        self.assertIsNotNone(ctx)


# =============================================================================
# 文件传输测试
# =============================================================================


class TestFileTransfer(unittest.TestCase):
    """测试文件传输（不涉及网络）。"""

    def test_get_extension(self):
        """文件扩展名提取。"""
        self.assertEqual(FileTransfer.get_file_extension("report.pdf"), "pdf")
        self.assertEqual(FileTransfer.get_file_extension("image.JPG"), "jpg")
        self.assertEqual(FileTransfer.get_file_extension("no_ext"), "")

    def test_is_supported(self):
        """文件类型检查。"""
        self.assertTrue(FileTransfer.is_supported_file_type("test.py"))
        self.assertTrue(FileTransfer.is_supported_file_type("doc.pdf"))
        self.assertTrue(FileTransfer.is_supported_file_type("img.png"))
        self.assertFalse(FileTransfer.is_supported_file_type("test.exe"))
        self.assertFalse(FileTransfer.is_supported_file_type("test.dll"))

    def test_base64_upload_small_file(self):
        """小文件 BASE64 编码，上传会触发网络请求（预期网络错误转 BusConnectionError）。"""
        config = BusChannelConfig(
            mode="poll",
            bus_url="http://test:4322",
            agent_id="test-agent",
            agent_token="test-token",
            file_mode=FileMode.BASE64,
            max_file_size_mb=10,
        )
        ft = FileTransfer(config, "test-token")

        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
            f.write(b"Hello, World!")
            f.flush()
            file_path = f.name

        try:
            # BASE64 模式现在会 POST 到 /api/files/upload，在无网络环境下预期网络错误
            with self.assertRaises(ConnectionError):
                ft.upload(file_path, "测试文件")
        finally:
            os.unlink(file_path)

    def test_base64_upload_file_too_large(self):
        """超大文件 BASE64 应报错。"""
        config = BusChannelConfig(
            mode="poll",
            bus_url="http://test:4322",
            file_mode=FileMode.BASE64,
            max_file_size_mb=1,  # 1MB 上限
        )
        ft = FileTransfer(config, "test-token")

        # 创建一个 2MB 的文件
        with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as f:
            f.write(b"x" * (2 * 1024 * 1024))
            f.flush()
            file_path = f.name

        try:
            with self.assertRaises(FileTooLargeError):
                ft.upload(file_path)
        finally:
            os.unlink(file_path)

    def test_file_not_found(self):
        """文件不存在应报错。"""
        config = BusChannelConfig(
            mode="poll",
            bus_url="http://test:4322",
            file_mode=FileMode.BASE64,
        )
        ft = FileTransfer(config, "test-token")
        with self.assertRaises(FileNotFoundError):
            ft.upload("/nonexistent/file.pdf")


# =============================================================================
# 异常测试
# =============================================================================


class TestExceptions(unittest.TestCase):
    """测试异常层次结构。"""

    def test_inheritance(self):
        self.assertTrue(issubclass(ConnectionError, BusChannelError))
        self.assertTrue(issubclass(AuthError, BusChannelError))
        self.assertTrue(issubclass(FileTooLargeError, BusChannelError))

    def test_connection_error(self):
        with self.assertRaises(BusChannelError):
            raise ConnectionError("连接失败")

    def test_auth_error(self):
        with self.assertRaises(BusChannelError):
            raise AuthError("认证失败")


if __name__ == "__main__":
    unittest.main()
```
