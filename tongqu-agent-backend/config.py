from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# 优先加载项目根目录 .env（不把密钥写进代码）
load_dotenv(Path(__file__).resolve().parent / ".env")


def _as_bool(raw: str | None, default: bool = False) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class AppConfig:
    # Mock First：False=本地 Mock；True=真实 API
    USE_REAL_API: bool = _as_bool(os.getenv("USE_REAL_API"), default=False)
    MOCK_MIN_DELAY_SEC: float = float(os.getenv("MOCK_MIN_DELAY_SEC", "1.0"))
    MOCK_MAX_DELAY_SEC: float = float(os.getenv("MOCK_MAX_DELAY_SEC", "2.0"))

    # DashScope（百炼）
    DASHSCOPE_API_KEY: str | None = os.getenv("DASHSCOPE_API_KEY")
    QWEN_MODEL: str = os.getenv("QWEN_MODEL", "qwen-plus")
    # 绘本静态配图：万相文生图（与 wan2.6-i2v 图生视频不同）
    DASHSCOPE_IMAGE_MODEL: str = os.getenv("DASHSCOPE_IMAGE_MODEL", "wanx-v1")

    # 阿里云 AK（Green + NLS）
    ALIYUN_ACCESS_KEY_ID: str | None = os.getenv("ALIYUN_ACCESS_KEY_ID")
    ALIYUN_ACCESS_KEY_SECRET: str | None = os.getenv("ALIYUN_ACCESS_KEY_SECRET")
    ALIYUN_REGION: str = os.getenv("ALIYUN_REGION", "cn-shanghai")

    # NLS 语音合成（需在控制台创建应用获取 AppKey）
    ALIYUN_NLS_APPKEY: str | None = os.getenv("ALIYUN_NLS_APPKEY")
    ALIYUN_NLS_VOICE: str = os.getenv("ALIYUN_NLS_VOICE", "xiaoyun")

    # Green 服务标识（按控制台已开通的检测项调整）
    GREEN_TEXT_SERVICE: str = os.getenv("GREEN_TEXT_SERVICE", "chat_detection_pro")
    GREEN_IMAGE_SERVICE: str = os.getenv("GREEN_IMAGE_SERVICE", "baselineCheck")


CONFIG = AppConfig()
