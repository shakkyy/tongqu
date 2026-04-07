from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")


@dataclass(frozen=True)
class AppConfig:
    # ========== 绘本配图（文生图）==========

    GOOGLE_API_KEY: str | None = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    GEMINI_OPENAI_API_KEY: str | None = os.getenv("GEMINI_OPENAI_API_KEY")
    GEMINI_OPENAI_BASE_URL: str | None = os.getenv("GEMINI_OPENAI_BASE_URL")
    GEMINI_IMAGE_MODEL: str = os.getenv(
        "GEMINI_IMAGE_MODEL",
        "gemini-2.0-flash-preview-image-generation",
    )

    # ========== 阿里云百炼：故事文本 + 草图理解（千问 VL）==========
    DASHSCOPE_API_KEY: str | None = os.getenv("DASHSCOPE_API_KEY")
    # 文本/ASR 统一走 OpenAI 兼容网关（北京默认）
    DASHSCOPE_COMPAT_BASE_URL: str = (
        (os.getenv("DASHSCOPE_COMPAT_BASE_URL") or "").strip().rstrip("/")
        or "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
    # VL 走原生 DashScope 网关（北京默认）
    DASHSCOPE_VL_BASE_HTTP_API_URL: str = (
        (os.getenv("DASHSCOPE_VL_BASE_HTTP_API_URL") or "").strip().rstrip("/")
        or "https://dashscope.aliyuncs.com/api/v1"
    )
    QWEN_MODEL: str = os.getenv("QWEN_MODEL", "qwen3.6-plus")
    QWEN_VL_MODEL: str = os.getenv("QWEN_VL_MODEL", "qwen3-vl-plus")
    QWEN_ASR_MODEL: str = os.getenv("QWEN_ASR_MODEL", "qwen3-asr-flash")

    ALIYUN_ACCESS_KEY_ID: str | None = os.getenv("ALIYUN_ACCESS_KEY_ID")
    ALIYUN_ACCESS_KEY_SECRET: str | None = os.getenv("ALIYUN_ACCESS_KEY_SECRET")
    ALIYUN_REGION: str = os.getenv("ALIYUN_REGION", "cn-shanghai")
    ALIYUN_NLS_APPKEY: str | None = os.getenv("ALIYUN_NLS_APPKEY")
    ALIYUN_NLS_VOICE: str = os.getenv("ALIYUN_NLS_VOICE", "xiaoyun")
    GREEN_TEXT_SERVICE: str = os.getenv("GREEN_TEXT_SERVICE", "chat_detection_pro")
    GREEN_IMAGE_SERVICE: str = os.getenv("GREEN_IMAGE_SERVICE", "baselineCheck")


CONFIG = AppConfig()
