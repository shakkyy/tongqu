from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")


@dataclass(frozen=True)
class AppConfig:
    # ========== 绘本配图（文生图）==========
    # 直连 Google：仅 GOOGLE_API_KEY + GEMINI_IMAGE_MODEL（google-genai）
    # OpenAI 兼容中转（如易步云 yibuapi.com）：额外设置 GEMINI_OPENAI_BASE_URL，密钥仍用 GOOGLE_API_KEY 或 GEMINI_OPENAI_API_KEY
    GOOGLE_API_KEY: str | None = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    GEMINI_OPENAI_API_KEY: str | None = os.getenv("GEMINI_OPENAI_API_KEY")
    GEMINI_OPENAI_BASE_URL: str | None = os.getenv("GEMINI_OPENAI_BASE_URL")
    GEMINI_IMAGE_MODEL: str = os.getenv(
        "GEMINI_IMAGE_MODEL",
        "gemini-2.0-flash-preview-image-generation",
    )

    # ========== 阿里云百炼：故事文本 + 草图理解（千问 VL）==========
    DASHSCOPE_API_KEY: str | None = os.getenv("DASHSCOPE_API_KEY")
    QWEN_MODEL: str = os.getenv("QWEN_MODEL", "qwen-plus")
    QWEN_VL_MODEL: str = os.getenv("QWEN_VL_MODEL", "qwen-vl-plus")

    ALIYUN_ACCESS_KEY_ID: str | None = os.getenv("ALIYUN_ACCESS_KEY_ID")
    ALIYUN_ACCESS_KEY_SECRET: str | None = os.getenv("ALIYUN_ACCESS_KEY_SECRET")
    ALIYUN_REGION: str = os.getenv("ALIYUN_REGION", "cn-shanghai")
    ALIYUN_NLS_APPKEY: str | None = os.getenv("ALIYUN_NLS_APPKEY")
    ALIYUN_NLS_VOICE: str = os.getenv("ALIYUN_NLS_VOICE", "xiaoyun")
    GREEN_TEXT_SERVICE: str = os.getenv("GREEN_TEXT_SERVICE", "chat_detection_pro")
    GREEN_IMAGE_SERVICE: str = os.getenv("GREEN_IMAGE_SERVICE", "baselineCheck")


CONFIG = AppConfig()
