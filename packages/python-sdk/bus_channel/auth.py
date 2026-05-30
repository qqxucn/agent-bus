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
