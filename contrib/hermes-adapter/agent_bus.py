"""
Agent Bus 平台适配器
====================

将 Hermes 的消息总线（agent-bus）集成为 Hermes 原生平台适配器，
继承 BasePlatformAdapter，支持 WebSocket 和 HTTP 轮询双模式。

配置（config.yaml）:
```yaml
platforms:
  agent_bus:
    enabled: true
    extra:
      bus_url: "http://localhost:4322"
      bus_ws_url: "ws://localhost:4322/ws"
      agent_id: "hermes"
      agent_token: "<token>"
      mode: "websocket"       # 可选: "websocket" | "poll"
```

环境变量:
- AGENT_BUS_ENABLED=true
- AGENT_BUS_URL=http://localhost:4322
- AGENT_BUS_WS_URL=ws://localhost:4322/ws
- AGENT_BUS_AGENT_ID=hermes
- AGENT_BUS_TOKEN=<token>
- AGENT_BUS_MODE=websocket  # 可选
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional, Dict, List

import httpx

logger = logging.getLogger(__name__)

# ── 导入 Hermes 基类 ──────────────────────────────────────────────────────

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import (
    BasePlatformAdapter,
    MessageEvent,
    MessageType,
    SendResult,
    cache_document_from_bytes,
    cache_image_from_bytes,
    get_document_cache_dir,
    get_image_cache_dir,
)
from gateway.session import SessionSource


# ── 常量 ───────────────────────────────────────────────────────────────────

AGENT_ID = os.getenv("AGENT_BUS_AGENT_ID", "hermes")
MAX_MESSAGE_LENGTH = 65536  # 总线消息长度上限

# ── 版本号 ──
# 与 claw-bus (OpenClaw 侧) 统一版本，方便两边对齐排查
AGENT_BUS_PROTOCOL_VERSION = "1.1"      # 总线协议版本（两边共用）
AGENT_BUS_IMPLEMENTATION_VERSION = "2.0.0"  # 实现版本（两边同步迭代）


# ── 依赖检查 ───────────────────────────────────────────────────────────────


def check_agent_bus_requirements() -> bool:
    """Check if agent-bus dependencies are available."""
    try:
        import httpx  # noqa: F401
        return True
    except ImportError:
        logger.warning("Agent Bus: httpx not installed")
        return False


# ── 数据结构 ───────────────────────────────────────────────────────────────


class BusOutboundMessage:
    """出站消息（Hermes → 总线 → 其他 Agent）。"""

    def __init__(
        self,
        to: str,
        type: str,
        content: str,
        ref_id: Optional[str] = None,
        session_id: Optional[str] = None,
        file_id: Optional[str] = None,
        file_ids: Optional[list[str]] = None,
        caption: Optional[str] = None,
    ):
        self.to = to
        self.type = type
        self.content = content
        self.ref_id = ref_id
        self.session_id = session_id
        self.file_id = file_id
        self.file_ids = file_ids
        self.caption = caption

    def to_dict(self) -> dict:
        d: dict = {
            "to": self.to,
            "type": self.type,
            "content": self.content,
        }
        if self.ref_id:
            d["ref_id"] = self.ref_id
        if self.session_id:
            d["session_id"] = self.session_id
        if self.file_id:
            d["file_id"] = self.file_id
        if self.file_ids:
            d["file_ids"] = self.file_ids
        if self.caption:
            d["caption"] = self.caption
        return d


class BusInboundMessage:
    """入站消息（总线 → Hermes）。

    从总线 API/WS 收到的 JSON 转换为此对象。
    """

    def __init__(self, data: dict):
        self.message_id: str = data.get("message_id", "")
        self.from_agent: str = data.get("from_agent", "")
        self.sender_type: str = data.get("sender_type", "agent")
        self.to_agent: str = data.get("to_agent", "")
        self.type: str = data.get("type", "text")
        self.content: str = data.get("content", "")
        self.sent_at: str = data.get("sent_at", "")
        self.ref_id: Optional[str] = data.get("ref_id")
        self.session_id: Optional[str] = data.get("session_id")
        self.file_id: Optional[str] = data.get("file_id")
        self.file_ids: Optional[list[str]] = data.get("file_ids")
        self.file_name: Optional[str] = data.get("file_name")
        self.file_size: Optional[int] = data.get("file_size")
        self.caption: Optional[str] = data.get("caption")


# ── 适配器 ─────────────────────────────────────────────────────────────────


class AgentBusAdapter(BasePlatformAdapter):
    """Agent 总线平台适配器。

    将消息总线集成到 Hermes 平台框架中。支持两种连接模式：
    - websocket: 长连接推送（推荐）
    - poll: HTTP 轮询（备用）
    """

    def __init__(self, config: PlatformConfig, platform: Platform = Platform.AGENT_BUS):
        super().__init__(config, platform)

        # 从额外配置读取
        extra = config.extra or {}

        self.bus_url: str = extra.get("bus_url", os.getenv("AGENT_BUS_URL", "http://localhost:4322"))
        self.bus_ws_url: str = extra.get("bus_ws_url", os.getenv("AGENT_BUS_WS_URL", ""))
        self.agent_id: str = extra.get("agent_id", os.getenv("AGENT_BUS_AGENT_ID", AGENT_ID))
        self.agent_token: str = extra.get("agent_token", config.token or os.getenv("AGENT_BUS_TOKEN", ""))
        self.mode: str = extra.get("mode", os.getenv("AGENT_BUS_MODE", "websocket"))
        self.poll_interval: int = int(extra.get("poll_interval", 3))

        # 连接状态
        self._ws_connected: bool = False
        self._ws: Any = None
        self._poll_task: Optional[asyncio.Task] = None
        self._ws_task: Optional[asyncio.Task] = None
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._stop_event: asyncio.Event = asyncio.Event()
        self._http_client: Optional[httpx.AsyncClient] = None
        self._seen_messages: set[str] = set()  # 消息去重

        # 注册到总线的状态
        self._registered: bool = False

        # 已处理的消息 ID 环形缓冲区（避免无限膨胀）
        self._MAX_SEEN = 10000

    # ── 属性 ─────────────────────────────────────────────────────────────

    @property
    def name(self) -> str:
        return "AgentBus"

    @property
    def is_connected(self) -> bool:
        if self.mode == "websocket":
            return self._ws_connected and self._registered
        return self._registered

    # ── 生命周期 ─────────────────────────────────────────────────────────

    async def connect(self) -> bool:
        """连接到消息总线。"""
        logger.info("[AgentBus] 正在连接... mode=%s, bus=%s", self.mode, self.bus_url)

        if not self.agent_token:
            logger.error("[AgentBus] 缺少 agent_token，请设置 AGENT_BUS_TOKEN 环境变量或 config.extra.agent_token")
            self._set_fatal_error("no_token", "Agent Bus token not configured", retryable=False)
            return False

        self._http_client = httpx.AsyncClient(timeout=30.0)

        # 注册到总线（获取身份确认）
        try:
            await self._register()
        except Exception as e:
            logger.error("[AgentBus] 注册失败: %s", e)
            await self._http_client.aclose()
            self._http_client = None
            self._set_fatal_error("register_failed", str(e), retryable=True)
            return False

        # 按模式启动连接
        self._stop_event.clear()

        if self.mode == "websocket":
            if not self.bus_ws_url:
                logger.error("[AgentBus] WS 模式需要 bus_ws_url")
                await self._http_client.aclose()
                self._http_client = None
                self._set_fatal_error("no_ws_url", "WS mode requires bus_ws_url", retryable=False)
                return False
            self._ws_task = asyncio.create_task(self._ws_loop())
        else:
            self._poll_task = asyncio.create_task(self._poll_loop())

        self._mark_connected()
        logger.info("[AgentBus] 连接成功! agent_id=%s, mode=%s", self.agent_id, self.mode)
        return True

    async def disconnect(self) -> None:
        """断开与总线的连接。"""
        logger.info("[AgentBus] 正在断开连接...")

        self._stop_event.set()

        # 取消所有后台任务
        for task in (self._ws_task, self._poll_task, self._heartbeat_task):
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        self._ws_task = None
        self._poll_task = None
        self._heartbeat_task = None

        # 关闭 WS
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None
            self._ws_connected = False

        # 关闭 HTTP 客户端
        if self._http_client:
            try:
                await self._http_client.aclose()
            except Exception:
                pass
            self._http_client = None

        self._registered = False
        self._mark_disconnected()
        logger.info("[AgentBus] 已断开连接")

    # ── 发送消息 ────────────────────────────────────────────────────────

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SendResult:
        """发送文本消息到指定 Agent。

        chat_id 参数的语义：
        - 直接传 Agent ID 字符串 → 发给该 Agent
        - 传 "agent:<agent_id>" 格式 → 发给该 Agent
        """
        target_agent = self._resolve_target_agent(chat_id)

        if not target_agent:
            return SendResult(
                success=False,
                error=f"Invalid chat_id format for AgentBus: {chat_id}. Use agent_id directly.",
            )

        msg = BusOutboundMessage(
            to=target_agent,
            type="text",
            content=content,
            ref_id=reply_to,
        )

        return await self._send_over_bus(msg)

    async def send_document(
        self,
        chat_id: str,
        file_path: str,
        caption: Optional[str] = None,
        file_name: Optional[str] = None,
        reply_to: Optional[str] = None,
        **kwargs,
    ) -> SendResult:
        """发送文件到指定 Agent。

        优先通过总线的文件 API 上传，再发送消息引用。
        """
        target_agent = self._resolve_target_agent(chat_id)
        if not target_agent:
            return SendResult(
                success=False,
                error=f"Invalid chat_id for AgentBus: {chat_id}",
            )

        # 检查文件是否存在
        path = Path(file_path)
        if not path.exists():
            return SendResult(success=False, error=f"File not found: {file_path}")

        # 尝试通过总线文件 API 上传
        try:
            assert self._http_client is not None
            bus_url = self.bus_url.rstrip("/")

            with open(file_path, "rb") as f:
                resp = await self._http_client.post(
                    f"{bus_url}/api/files/upload",
                    files={"file": (file_name or path.name, f)},
                    headers={"Authorization": f"Bearer {self.agent_token}"},
                    timeout=120.0,
                )

            if resp.status_code == 200:
                data = resp.json()
                file_id = data.get("file_id") or data.get("id")
                if file_id:
                    msg = BusOutboundMessage(
                        to=target_agent,
                        type="file",
                        content=caption or file_name or path.name,
                        file_id=file_id,
                        caption=caption,
                        ref_id=reply_to,
                    )
                    return await self._send_over_bus(msg)

            # 上传失败：fallback 到 BASE64 模式
            logger.warning("[AgentBus] 文件上传返回 %d, 回退到 BASE64 模式", resp.status_code)

        except Exception as e:
            logger.warning("[AgentBus] 文件上传异常: %s, 回退到 BASE64 模式", e)

        # Fallback: BASE64 编码直接发送
        try:
            import base64

            file_bytes = path.read_bytes()
            b64 = base64.b64encode(file_bytes).decode("ascii")
            ext = path.suffix.lower()

            file_content = json.dumps({
                "base64": b64,
                "filename": file_name or path.name,
                "extension": ext,
                "size": len(file_bytes),
            })

            msg = BusOutboundMessage(
                to=target_agent,
                type="file",
                content=file_content,
                caption=caption,
                ref_id=reply_to,
            )
            return await self._send_over_bus(msg)

        except Exception as e:
            return SendResult(success=False, error=f"Base64 send failed: {e}")

    async def send_image(
        self,
        chat_id: str,
        image_url: str,
        caption: Optional[str] = None,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SendResult:
        """发送图片（URL）。"""
        target_agent = self._resolve_target_agent(chat_id)
        if not target_agent:
            return SendResult(success=False, error=f"Invalid chat_id: {chat_id}")

        msg = BusOutboundMessage(
            to=target_agent,
            type="text",
            content=f"![{caption or 'image'}]({image_url})",
            ref_id=reply_to,
        )
        return await self._send_over_bus(msg)

    async def send_typing(self, chat_id: str, metadata=None) -> None:
        """总线没有 typing 指示器，这个操作是空操作。"""
        pass

    async def get_chat_info(self, chat_id: str) -> Dict[str, Any]:
        """获取 Agent 信息。

        通过总线 API 查询目标 Agent 的状态。
        """
        target_agent = self._resolve_target_agent(chat_id)
        if not target_agent:
            return {"name": chat_id, "type": "agent", "chat_id": chat_id}

        try:
            assert self._http_client is not None
            bus_url = self.bus_url.rstrip("/")
            resp = await self._http_client.get(
                f"{bus_url}/api/agents/{target_agent}",
                headers={"Authorization": f"Bearer {self.agent_token}"},
            )
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "name": data.get("name", target_agent),
                    "type": "agent",
                    "chat_id": target_agent,
                }
        except Exception:
            pass

        return {"name": target_agent, "type": "agent", "chat_id": target_agent}

    def format_message(self, content: str) -> str:
        """总线传输纯文本，不需要特殊格式化。"""
        return content

    # ── 工具方法 ─────────────────────────────────────────────────────────

    @staticmethod
    def _resolve_target_agent(chat_id: str) -> Optional[str]:
        """解析 chat_id 为目标 Agent ID。

        接受格式：
        - "小绿" → "小绿"
        - "agent:小绿" → "小绿"
        - "hermes" → "hermes"
        """
        if not chat_id:
            return None
        if chat_id.startswith("agent:"):
            return chat_id[6:]
        return chat_id

    def build_source(
        self,
        agent_id: str,
        sender_type: str = "agent",
        message_id: Optional[str] = None,
    ) -> SessionSource:
        """构建 Hermes 的 SessionSource。"""
        return SessionSource(
            platform=self.platform,
            chat_id=agent_id,
            chat_name=f"Agent:{agent_id}",
            chat_type="dm",
            user_id=agent_id,
            user_name=agent_id,
        )

    # ── 总线连接 ─────────────────────────────────────────────────────────

    async def _register(self) -> None:
        """向总线注册本 Agent。"""
        bus_url = self.bus_url.rstrip("/")
        assert self._http_client is not None

        # 先检查是否已经注册（GET /api/agents/{agent_id}）
        check_resp = await self._http_client.get(
            f"{bus_url}/api/agents/{self.agent_id}",
            headers={"Authorization": f"Bearer {self.agent_token}"},
        )
        if check_resp.status_code == 200:
            self._registered = True
            logger.info("[AgentBus] Agent 已在总线注册: %s", self.agent_id)
            return

        # POST /api/agents/register
        resp = await self._http_client.post(
            f"{bus_url}/api/agents/register",
            json={
                "agent_id": self.agent_id,
                "display_name": self.agent_id,
                "token": self.agent_token,
            },
            headers={"Authorization": f"Bearer {self.agent_token}"},
        )

        if resp.status_code == 200:
            self._registered = True
            logger.info("[AgentBus] Agent 注册成功: %s", self.agent_id)
        else:
            # 尝试 GET /api/me 方式确认
            me_resp = await self._http_client.get(
                f"{bus_url}/api/me",
                headers={"Authorization": f"Bearer {self.agent_token}"},
            )
            if me_resp.status_code == 200:
                self._registered = True
                logger.info("[AgentBus] 通过 API 确认已注册: %s", self.agent_id)
            else:
                raise RuntimeError(
                    f"注册失败 (HTTP {resp.status_code}): {resp.text[:200]}"
                )

    # ── WebSocket 模式 ──────────────────────────────────────────────────

    async def _ws_loop(self) -> None:
        """WebSocket 主循环（自动重连）。"""
        reconnect_delay = 2.0
        max_delay = 60.0

        while not self._stop_event.is_set():
            try:
                await self._ws_connect()
                reconnect_delay = 2.0  # 连接成功，重置延迟

                # 启动心跳
                self._heartbeat_task = asyncio.create_task(self._ws_heartbeat())

                # 消息接收循环
                await self._ws_receive_loop()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("[AgentBus] WS 连接异常: %s, %.1fs 后重连", e, reconnect_delay)
                self._ws_connected = False

                # 取消心跳
                if self._heartbeat_task and not self._heartbeat_task.done():
                    self._heartbeat_task.cancel()
                    try:
                        await self._heartbeat_task
                    except asyncio.CancelledError:
                        pass
                    self._heartbeat_task = None

                if not self._stop_event.is_set():
                    await asyncio.sleep(reconnect_delay)
                    reconnect_delay = min(reconnect_delay * 1.5, max_delay)

        self._ws_connected = False

    async def _ws_connect(self) -> None:
        """建立 WebSocket 连接。"""
        try:
            import websockets  # type: ignore[import-untyped]
        except ImportError:
            logger.error("[AgentBus] WS 模式需要 websockets 库: pip install websockets")
            raise

        logger.info("[AgentBus] 正在连接 WS: %s", self.bus_ws_url)

        self._ws = await websockets.connect(
            self.bus_ws_url,
            additional_headers={
                "Authorization": f"Bearer {self.agent_token}",
                "X-Agent-Id": self.agent_id,
            },
            ping_interval=None,  # 自定义心跳
            ping_timeout=None,
            close_timeout=5,
            max_size=10 * 1024 * 1024,  # 10MB max message
        )

        self._ws_connected = True

        # 等待 connected 帧
        frame = await self._ws.recv()
        if isinstance(frame, bytes):
            frame = frame.decode("utf-8")
        data = json.loads(frame)

        if data.get("ws_type") == "connected":
            logger.info("[AgentBus] WS 连接确认: %s", data.get("payload", ""))
        else:
            logger.warning("[AgentBus] 未收到 connected 帧，但连接已建立")

        logger.info("[AgentBus] WS 连接成功")

    async def _ws_receive_loop(self) -> None:
        """接收 WS 消息。"""
        assert self._ws is not None

        async for message in self._ws:
            if isinstance(message, bytes):
                message = message.decode("utf-8")

            try:
                frame = json.loads(message)
            except json.JSONDecodeError:
                logger.warning("[AgentBus] 收到无效 JSON: %s", message[:100])
                continue

            ws_type = frame.get("ws_type")

            if ws_type == "message":
                payload = frame.get("payload", {})
                if payload:
                    await self._process_inbound(payload)
                # 发送 ACK
                await self._ws_send_frame({
                    "ws_type": "ack",
                    "message_id": payload.get("message_id", ""),
                    "request_id": frame.get("request_id", ""),
                })

            elif ws_type == "ping":
                await self._ws_send_frame({"ws_type": "pong"})

            elif ws_type == "error":
                logger.warning("[AgentBus] WS 错误帧: %s", frame.get("code", ""), frame.get("payload", ""))

    async def _ws_send_frame(self, data: dict) -> None:
        """发送 WS 帧。"""
        if self._ws is None or not self._ws_connected:
            return
        try:
            await self._ws.send(json.dumps(data, ensure_ascii=False))
        except Exception as e:
            logger.warning("[AgentBus] 发送 WS 帧失败: %s", e)

    async def _ws_heartbeat(self) -> None:
        """WS 心跳监控。

        底层的 websockets 连接自动处理 ping/pong（已在连接时配置了 ping_interval=25）。
        这里只做 pong 丢失计数，3 次连续丢失判定断线。
        """
        consecutive_missed = 0
        max_missed = 3
        try:
            while not self._stop_event.is_set() and self._ws_connected:
                await asyncio.sleep(30)
                if not self._ws_connected:
                    break
                # 尝试发送 ping，如果失败说明连接已断
                try:
                    await self._ws_send_frame({"ws_type": "ping"})
                    consecutive_missed = 0  # 能发出 ping 说明连接还活着
                except Exception:
                    consecutive_missed += 1
                    logger.warning(
                        "[AgentBus] Ping 发送失败 (%d/%d)",
                        consecutive_missed, max_missed,
                    )
                    if consecutive_missed >= max_missed:
                        logger.error("[AgentBus] 连续 %d 次心跳失败，判定断线", max_missed)
                        self._ws_connected = False
                        break
        except asyncio.CancelledError:
            pass

    # ── HTTP 轮询模式 ───────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        """HTTP 轮询主循环。"""
        while not self._stop_event.is_set():
            try:
                await self._poll_once()
            except Exception as e:
                logger.debug("[AgentBus] 轮询异常: %s", e)

            await asyncio.sleep(self.poll_interval)

    async def _poll_once(self) -> None:
        """执行一次轮询。"""
        if self._http_client is None:
            return

        bus_url = self.bus_url.rstrip("/")

        try:
            resp = await self._http_client.get(
                f"{bus_url}/api/messages/inbox",
                params={"limit": 20, "mark_read": "true"},
                headers={"Authorization": f"Bearer {self.agent_token}"},
                timeout=15.0,
            )

            if resp.status_code == 200:
                data = resp.json()
                messages = data.get("data", data)
                if isinstance(messages, dict):
                    messages = messages.get("messages", [])
                if not isinstance(messages, list):
                    messages = []

                for msg_data in messages:
                    await self._process_inbound(msg_data)

        except httpx.TimeoutException:
            pass  # 超时是正常的
        except Exception as e:
            logger.debug("[AgentBus] 轮询请求异常: %s", e)

    # ── 消息处理 ─────────────────────────────────────────────────────────

    async def _process_inbound(self, data: dict) -> None:
        """处理一条入站消息（总线 → Hermes）。"""
        msg = BusInboundMessage(data)

        # 去重
        if msg.message_id in self._seen_messages:
            logger.debug("[AgentBus] 跳过重复消息: %s", msg.message_id)
            return

        self._seen_messages.add(msg.message_id)
        if len(self._seen_messages) > self._MAX_SEEN:
            # 清理一半旧记录
            self._seen_messages = set(list(self._seen_messages)[-self._MAX_SEEN // 2:])

        # 忽略发给其他人的消息
        if msg.to_agent and msg.to_agent != self.agent_id:
            return

        # 忽略自己的消息（防止回复循环）
        if msg.from_agent == self.agent_id:
            return

        logger.info("[AgentBus] 收到来自 %s 的消息: type=%s, id=%s", msg.from_agent, msg.type, msg.message_id[:16])

        # 构建 Hermes 标准 MessageEvent
        source = self.build_source(
            agent_id=msg.from_agent,
            sender_type=msg.sender_type,
            message_id=msg.message_id,
        )

        text_content = msg.content
        message_type = MessageType.TEXT

        # 处理文件消息
        media_urls: list[str] = []
        media_types: list[str] = []

        if msg.type == "file":
            if msg.file_id:
                # 通过总线 API 下载文件
                try:
                    local_path = await self._download_file(msg.file_id, msg.file_name)
                    if local_path:
                        ext = Path(local_path).suffix.lower()
                        if ext in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
                            media_urls.append(local_path)
                            media_types.append("image")
                            message_type = MessageType.PHOTO
                        elif ext in (".pdf", ".docx", ".xlsx", ".md", ".txt"):
                            media_urls.append(local_path)
                            media_types.append("document")
                            message_type = MessageType.DOCUMENT
                        else:
                            media_urls.append(local_path)
                            media_types.append("document")
                            message_type = MessageType.DOCUMENT

                        if msg.caption:
                            text_content = msg.caption
                except Exception as e:
                    logger.warning("[AgentBus] 文件下载失败: %s", e)

            # 检查 BASE64 编码数据
            if not msg.file_id and msg.content:
                try:
                    file_data = json.loads(msg.content)
                    if "base64" in file_data:
                        import base64

                        raw = base64.b64decode(file_data["base64"])
                        fname = file_data.get("filename", "file.bin")
                        local_path = cache_document_from_bytes(raw, fname)
                        media_urls.append(local_path)
                        media_types.append("document")
                        message_type = MessageType.DOCUMENT
                        if msg.caption:
                            text_content = msg.caption
                except (json.JSONDecodeError, Exception):
                    pass  # 不是 BASE64，按普通文本处理

        event = MessageEvent(
            text=text_content,
            message_type=message_type,
            source=source,
            raw_message=data,
            message_id=msg.message_id,
            media_urls=media_urls,
            media_types=media_types,
            reply_to_message_id=msg.ref_id,
        )

        # 分发给 Hermes 消息处理管道
        await self.handle_message(event)

    async def _send_over_bus(self, msg: BusOutboundMessage) -> SendResult:
        """通过总线 API 发送消息。"""
        if self._http_client is None:
            return SendResult(success=False, error="Not connected")

        bus_url = self.bus_url.rstrip("/")
        payload = msg.to_dict()
        # 服务端需要 from 字段标识发送方
        payload["from"] = self.agent_id

        try:
            resp = await self._http_client.post(
                f"{bus_url}/api/messages/send",
                json=payload,
                headers={"Authorization": f"Bearer {self.agent_token}"},
                timeout=15.0,
            )

            if resp.status_code == 200:
                data = resp.json()
                msg_id = data.get("message_id", str(uuid.uuid4()))
                return SendResult(success=True, message_id=msg_id)
            else:
                return SendResult(
                    success=False,
                    error=f"Bus API error (HTTP {resp.status_code}): {resp.text[:200]}",
                )

        except httpx.TimeoutException:
            return SendResult(success=False, error="Bus API timeout", retryable=True)
        except Exception as e:
            return SendResult(success=False, error=str(e), retryable=True)

    async def _download_file(self, file_id: str, file_name: Optional[str] = None) -> Optional[str]:
        """通过总线 API 下载文件到本地缓存。"""
        if self._http_client is None:
            return None

        bus_url = self.bus_url.rstrip("/")

        resp = await self._http_client.get(
            f"{bus_url}/api/files/{file_id}",
            headers={"Authorization": f"Bearer {self.agent_token}"},
            timeout=60.0,
        )

        if resp.status_code != 200:
            logger.warning("[AgentBus] 文件下载返回 %d: %s", resp.status_code, resp.text[:100])
            return None

        # 保存到缓存
        content_type = resp.headers.get("content-type", "")
        data = resp.content
        name = file_name or f"file_{file_id[:8]}"

        # 从 content-type 推断扩展名
        ext_map = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/webp": ".webp",
            "image/gif": ".gif",
            "application/pdf": ".pdf",
            "text/markdown": ".md",
            "text/plain": ".txt",
            "application/zip": ".zip",
        }
        ext = ".bin"
        for ct, e in ext_map.items():
            if ct in content_type:
                ext = e
                break

        # 检查是否是图片
        if "image/" in content_type:
            return cache_image_from_bytes(data, ext)
        else:
            return cache_document_from_bytes(data, name)

    # ── 生命周期钩子 ────────────────────────────────────────────────────

    async def on_processing_start(self, event: MessageEvent) -> None:
        """消息开始处理时的钩子。"""
        pass

    async def on_processing_complete(self, event: MessageEvent, outcome) -> None:
        """消息处理完成时的钩子。"""
        pass
