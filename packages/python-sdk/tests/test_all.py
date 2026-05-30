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
