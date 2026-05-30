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
