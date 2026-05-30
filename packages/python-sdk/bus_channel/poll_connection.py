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
