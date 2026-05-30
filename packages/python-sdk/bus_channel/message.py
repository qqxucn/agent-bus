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
