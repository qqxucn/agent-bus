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
