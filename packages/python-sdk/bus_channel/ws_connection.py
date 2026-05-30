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
