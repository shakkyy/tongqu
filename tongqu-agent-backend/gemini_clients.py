"""
绘本配图（文生图）：

- 未设置 GEMINI_OPENAI_BASE_URL：直连 Google（google-genai + GOOGLE_API_KEY）
- 设置 GEMINI_OPENAI_BASE_URL：OpenAI 兼容接口（如易步云 https://yibuapi.com/v1 + 平台 API Key）
"""

from __future__ import annotations

import asyncio
import base64
import re
from typing import Any

from config import CONFIG

try:
    from google import genai as google_genai
    from google.genai import types as genai_types
except ImportError:  # pragma: no cover
    google_genai = None  # type: ignore
    genai_types = None  # type: ignore

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover
    OpenAI = None  # type: ignore

from real_clients import API_KEY_ERROR, ApiKeyError


def _require_genai() -> Any:
    if google_genai is None or genai_types is None:
        raise RuntimeError("请先安装：pip install google-genai")
    return google_genai


def _google_client() -> Any:
    key = CONFIG.GOOGLE_API_KEY
    if not key:
        raise ApiKeyError(API_KEY_ERROR)
    g = _require_genai()
    return g.Client(api_key=key)


def _openai_image_api_key() -> str:
    key = CONFIG.GEMINI_OPENAI_API_KEY or CONFIG.GOOGLE_API_KEY
    if not key:
        raise ApiKeyError(API_KEY_ERROR)
    return key


def _parse_openai_image_content(content: Any) -> str:
    """从 OpenAI 兼容 Chat Completions 的 message.content 中解析出 data:image/...;base64,..."""
    if content is None:
        raise RuntimeError("OpenAI 兼容接口返回 content 为空")

    if isinstance(content, str):
        s = content.strip()
        if s.startswith("data:image"):
            return s
        m = re.search(r"!\[[^\]]*\]\((data:image/[^)]+)\)", s)
        if m:
            return m.group(1)
        m2 = re.search(r"(data:image/[\w+.-]+;base64,[\w+/=]+)", s, re.DOTALL)
        if m2:
            return m2.group(1)
        raise RuntimeError(f"OpenAI 兼容返回无法解析为图片（纯文本前 200 字）：{s[:200]!r}")

    if isinstance(content, list):
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "image_url":
                iu = part.get("image_url")
                if isinstance(iu, dict):
                    url = iu.get("url")
                    if isinstance(url, str) and url.startswith("data:image"):
                        return url
            if part.get("type") == "text":
                txt = part.get("text")
                if isinstance(txt, str):
                    return _parse_openai_image_content(txt)

    raise RuntimeError(f"OpenAI 兼容返回格式未识别: {type(content).__name__} {repr(content)[:300]}")


def _style_prefix(style: str) -> str:
    """英文前置：文生图模型对英文指令更稳；避免与画风矛盾的词（如水墨不宜强调 warm bright）。"""
    return {
        "剪纸": (
            "Chinese paper-cut art style, red and gold, flat layers, decorative folk pattern, "
            "children's picture book, warm and clear, no horror. "
        ),
        "水墨": (
            "Traditional Chinese shuimo ink wash painting, sumi-e on rice paper, "
            "soft wet brush strokes and controlled bleeding, generous negative space (留白), "
            "muted ink grays and light sepia washes, NOT photorealistic, NOT 3D render, "
            "NOT thick glossy cel-shaded anime, avoid saturated rainbow colors, "
            "poetic children's book illustration, no horror. "
        ),
        "皮影": (
            "Chinese shadow puppetry theater style, warm amber backlight, flat colored silhouette cutouts, "
            "stage-like framing, children's picture book, no horror. "
        ),
        "漫画": (
            "Friendly children's comic panel style, clean ink outlines, soft flat or light cel shading, "
            "bright but harmonious colors, Chinese cultural elements, no horror. "
        ),
    }.get(
        style,
        "Chinese children's picture book illustration, culturally appropriate, warm, no horror. ",
    )


def _style_suffix(style: str) -> str:
    """句末再强调一次，减弱中间中文 scene 描述「带偏」画风的几率。"""
    return {
        "剪纸": "Final image must look like paper-cut folk art, not oil painting or 3D.",
        "水墨": "Final image must read clearly as Chinese ink wash (水墨), not digital painting or photo.",
        "皮影": "Final image must look like shadow puppet silhouettes under stage light.",
        "漫画": "Final image must look like friendly children's comic illustration.",
    }.get(style, "Keep a consistent children's book illustration style.")


def _generate_via_openai_compat(full_prompt: str) -> str:
    if OpenAI is None:
        raise RuntimeError("请先安装：pip install openai")
    base = (CONFIG.GEMINI_OPENAI_BASE_URL or "").strip().rstrip("/")
    if not base:
        raise RuntimeError("未配置 GEMINI_OPENAI_BASE_URL")

    client = OpenAI(
        api_key=_openai_image_api_key(),
        base_url=base,
    )
    response = client.chat.completions.create(
        model=CONFIG.GEMINI_IMAGE_MODEL,
        messages=[
            {
                "role": "user",
                "content": [{"type": "text", "text": full_prompt}],
            }
        ],
        stream=False,
    )
    choice = response.choices[0]
    msg = choice.message
    content = getattr(msg, "content", None)
    return _parse_openai_image_content(content)


def _generate_via_google_genai(full_prompt: str) -> str:
    client = _google_client()
    assert genai_types is not None
    cfg = genai_types.GenerateContentConfig(
        response_modalities=[genai_types.Modality.IMAGE],
    )
    resp = client.models.generate_content(
        model=CONFIG.GEMINI_IMAGE_MODEL,
        contents=full_prompt,
        config=cfg,
    )
    if getattr(resp, "candidates", None):
        for cand in resp.candidates:
            content = getattr(cand, "content", None)
            if not content:
                continue
            for part in getattr(content, "parts", []) or []:
                inline = getattr(part, "inline_data", None)
                if inline is not None:
                    data = getattr(inline, "data", None)
                    mime = getattr(inline, "mime_type", None) or "image/png"
                    if data is None:
                        continue
                    if isinstance(data, str):
                        b64 = data
                    else:
                        b64 = base64.b64encode(data).decode("ascii")
                    return f"data:{mime};base64,{b64}"
    raise RuntimeError(f"Gemini 图像返回无法解析（请检查 GEMINI_IMAGE_MODEL 是否支持文生图）: {resp!r}")


class GeminiImageClient:
    """文生图：返回 data:image/png;base64,... 供前端直接展示。"""

    async def generate_image(self, prompt: str, style: str) -> str:
        body = (prompt or "").strip()
        full_prompt = f"{_style_prefix(style)}{body} {_style_suffix(style)}".strip()

        def _call() -> str:
            if (CONFIG.GEMINI_OPENAI_BASE_URL or "").strip():
                return _generate_via_openai_compat(full_prompt)
            return _generate_via_google_genai(full_prompt)

        return await asyncio.to_thread(_call)
