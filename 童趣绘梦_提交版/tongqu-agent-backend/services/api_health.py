"""启动前 / 运维用：探测各外部 API 密钥与连通性（不返回密钥明文）。"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from config import CONFIG


def _mask_configured(value: str | None) -> dict[str, Any]:
    v = (value or "").strip()
    if not v:
        return {"configured": False, "hint": "未设置"}
    looks_placeholder = v.isdigit() or len(v) < 12
    return {
        "configured": True,
        "length": len(v),
        "looks_placeholder": looks_placeholder,
    }


async def check_all_services() -> dict[str, Any]:
    """逐项探测；返回 overall ok 与分项 status。"""
    from core.clients import (
        ApiKeyError,
        DashScopeCosyVoiceTtsClient,
        DashScopeQwenClient,
        GeminiImageClient,
        OpenAITextClient,
        _openai_image_api_key,
    )

    use_openai_text = bool(CONFIG.OPENAI_API_KEY and CONFIG.OPENAI_BASE_URL and CONFIG.OPENAI_MODEL)
    env: dict[str, Any] = {
        "openai_text": _mask_configured(CONFIG.OPENAI_API_KEY),
        "openai_base_url": CONFIG.OPENAI_BASE_URL,
        "openai_model": CONFIG.OPENAI_MODEL,
        "dashscope": _mask_configured(CONFIG.DASHSCOPE_API_KEY),
        "dashscope_tts_model": CONFIG.DASHSCOPE_TTS_MODEL,
        "dashscope_tts_voice": CONFIG.DASHSCOPE_TTS_VOICE,
        "gemini_openai": _mask_configured(CONFIG.GEMINI_OPENAI_API_KEY),
        "google_direct": _mask_configured(CONFIG.GOOGLE_API_KEY),
        "gemini_openai_base_url": (CONFIG.GEMINI_OPENAI_BASE_URL or "").strip() or None,
        "gemini_image_model": CONFIG.GEMINI_IMAGE_MODEL,
        "hints": [],
    }
    if not CONFIG.DASHSCOPE_API_KEY:
        env["hints"].append("草图 VL、ASR 与 CosyVoice TTS 需 DASHSCOPE_API_KEY")
    if not use_openai_text and not CONFIG.DASHSCOPE_API_KEY:
        env["hints"].append("叙事文本需 OPENAI_* 或 DASHSCOPE_API_KEY")
    if not CONFIG.GOOGLE_API_KEY and not CONFIG.GEMINI_OPENAI_API_KEY:
        env["hints"].append("配图需 GOOGLE_API_KEY 或 GEMINI_OPENAI_API_KEY + GEMINI_OPENAI_BASE_URL")

    checks: dict[str, dict[str, Any]] = {}

    async def run_check(name: str, action: Callable[[], Awaitable[Any]]) -> None:
        try:
            await action()
            checks[name] = {"ok": True}
        except ApiKeyError as exc:
            checks[name] = {"ok": False, "error": "api_key", "detail": str(exc)}
        except Exception as exc:  # noqa: BLE001
            checks[name] = {"ok": False, "error": type(exc).__name__, "detail": str(exc)[:400]}

    if use_openai_text:
        await run_check("openai_text_llm", lambda: OpenAITextClient().generate("好"))
    else:
        await run_check("dashscope_qwen", lambda: DashScopeQwenClient().generate("好"))
    await run_check("dashscope_cosyvoice_tts", lambda: DashScopeCosyVoiceTtsClient().synthesize("测试", CONFIG.DASHSCOPE_TTS_VOICE))

    try:
        _openai_image_api_key()
        image_base = (CONFIG.GEMINI_OPENAI_BASE_URL or "").strip()
        if image_base and (":generateContent" in image_base or "/v1beta/models/" in image_base):
            image_mode = "gemini_generate_content"
        elif image_base:
            image_mode = "openai_compat"
        else:
            image_mode = "google_genai"
        checks["gemini_image_config"] = {"ok": True, "mode": image_mode}
        # 轻量探测：仅当显式设置 SKIP_GEMINI_IMAGE_PROBE 时不调用生图
        if not __import__("os").getenv("SKIP_GEMINI_IMAGE_PROBE"):
            await run_check(
                "gemini_image",
                lambda: GeminiImageClient().generate_image("一只可爱的小兔子", "水墨"),
            )
    except ApiKeyError as exc:
        checks["gemini_image_config"] = {"ok": False, "error": "api_key", "detail": str(exc)}

    critical = ["openai_text_llm" if use_openai_text else "dashscope_qwen", "dashscope_cosyvoice_tts", "gemini_image"]
    ok = all(checks.get(k, {}).get("ok") for k in critical if k in checks)

    return {
        "ok": ok,
        "env": env,
        "checks": checks,
    }
