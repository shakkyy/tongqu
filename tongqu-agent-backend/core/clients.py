"""
真实 API 客户端：DashScope Qwen / 千问 VL / CosyVoice TTS + Gemini 配图。

绘本配图由 Gemini 文生图单独提供（见本文件内 GeminiImageClient）；密钥只从环境变量读取。
"""

from __future__ import annotations

import asyncio
import base64
import json
from typing import Any, Dict, Optional

import logging
import re

import requests
try:
    from openai import OpenAI
except ImportError:  # pragma: no cover
    OpenAI = None  # type: ignore

try:
    import dashscope
    from dashscope import Generation
    from dashscope import MultiModalConversation
except ImportError:  # pragma: no cover
    dashscope = None  # type: ignore
    Generation = None  # type: ignore
    MultiModalConversation = None  # type: ignore

from config import CONFIG


API_KEY_ERROR = "API 密钥配置错误"


class ApiKeyError(RuntimeError):
    """Access key / DashScope key 无效或缺失。"""


class TtsRateLimitError(RuntimeError):
    """DashScope TTS 网关限流（并发或 QPS 过高）。"""


def _apply_dashscope_base_url() -> None:
    """给 VL 调用设置原生 DashScope 网关（非 compatible-mode）。"""
    if dashscope is None:
        return
    dashscope.base_http_api_url = CONFIG.DASHSCOPE_VL_BASE_HTTP_API_URL


def _require_dashscope() -> None:
    if dashscope is None or Generation is None:
        raise RuntimeError("请先安装 dashscope：pip install dashscope")


def _require_vl() -> None:
    if dashscope is None or MultiModalConversation is None:
        raise RuntimeError("请先安装 dashscope（含 MultiModalConversation）：pip install -U dashscope")


def _is_key_like_invalid(resp: Any) -> bool:
    text = str(resp).lower()
    return any(
        s in text
        for s in (
            "invalidapikey",
            "invalid api key",
            "unauthorized",
            "401",
            "access denied",
            "invalidaccesskeyid",
        )
    )


def _extract_generation_text(resp: Any) -> str:
    """从 DashScope Generation 响应中取出 assistant 文本。"""
    if getattr(resp, "status_code", None) == 200 and getattr(resp, "output", None):
        out = resp.output
        choices = getattr(out, "choices", None)
        if choices:
            msg = getattr(choices[0], "message", None)
            if msg is not None:
                content = getattr(msg, "content", None) or getattr(msg, "text", None)
                if content:
                    return str(content)
        legacy = getattr(out, "text", None)
        if legacy:
            return str(legacy)
    if getattr(resp, "status_code", None) != 200:
        if _is_key_like_invalid(resp):
            raise ApiKeyError(API_KEY_ERROR)
        raise RuntimeError(f"DashScope 文本生成失败: {resp}")
    raise RuntimeError(f"DashScope 返回无法解析: {resp}")


def _extract_vl_text(resp: Any) -> str:
    """千问 VL（MultiModalConversation）返回文本。"""
    if getattr(resp, "status_code", None) != 200:
        if _is_key_like_invalid(resp):
            raise ApiKeyError(API_KEY_ERROR)
        raise RuntimeError(f"千问 VL 调用失败: {resp}")
    out = getattr(resp, "output", None)
    if not out:
        raise RuntimeError(f"千问 VL 无 output: {resp}")
    choices = getattr(out, "choices", None)
    if choices:
        msg = getattr(choices[0], "message", None)
        if msg is not None:
            content = getattr(msg, "content", None)
            if isinstance(content, str) and content.strip():
                return content.strip()
            if isinstance(content, list):
                parts: list[str] = []
                for item in content:
                    if isinstance(item, dict):
                        t = item.get("text")
                        if t:
                            parts.append(str(t))
                    elif isinstance(item, str):
                        parts.append(item)
                if parts:
                    return "".join(parts).strip()
    legacy = getattr(out, "text", None)
    if legacy:
        return str(legacy).strip()
    raise RuntimeError(f"千问 VL 返回无法解析: {resp}")


SKETCH_VL_USER_PROMPT = (
    "请用中文简要描述这张儿童手绘草图里画了什么、可能表达的主题或情感。"
    "优先保留画面中具体可见物体、角色、动作、空间关系和孩子写下的可辨识文字；"
    "不要只抽象成主题，也不要把具体物体泛化丢失。"
    "如果看起来像品牌、logo 或文字，只说明它代表的普通物体含义，后续绘图不要求复现品牌标识或文字。"
    "要求：5～10 句话，面向后续儿童绘本创作；避免技术术语；不要输出 JSON 或 Markdown 标题。"
)

FAMILY_PHOTO_VL_USER_PROMPT = """
你是儿童绘本产品的亲子合照安全审核与角色锚点提取助手。请严格只输出一个 JSON 对象，不要 Markdown。

安全审核标准：
- 如果图片包含明显裸露、性暗示、暴力、受伤、血腥、危险行为、仇恨符号、成人不雅内容，safe 必须为 false。
- 如果图片包含身份证件、手机号、地址、学校班级、车牌、二维码等可识别隐私信息，safe 必须为 false。
- 不要识别真实人物身份，不要推断姓名、年龄、职业、住址或其他敏感身份。

通过时，请只提取适合儿童绘本的非敏感视觉锚点：大致人数、亲子关系氛围、服装主色、发型轮廓、表情气质、可安全泛化的亲子互动。不要要求复刻真实人脸。

JSON schema:
{
  "safe": true,
  "risk_reason": "",
  "family_summary_zh": "适合后续创作的中文照片理解，3-5句",
  "character_anchors_en": [
    "child character: non-photorealistic picture-book avatar, ...",
    "parent character: non-photorealistic picture-book avatar, ..."
  ],
  "story_seed_zh": "把这组亲子角色穿越到古代中国传统故事中的安全创作建议，1-2句"
}
""".strip()


class DashScopeQwenVLClient:
    """
    千问多模态：理解儿童草图，输出中文描述，供故事模型使用。
    使用 DashScope MultiModalConversation（如 qwen-vl-plus）。
    """

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None) -> None:
        self.api_key = api_key or CONFIG.DASHSCOPE_API_KEY
        self.model = model or CONFIG.QWEN_VL_MODEL

    async def _describe_with_prompt(self, image_data_url: str, user_prompt: str) -> str:
        if not self.api_key:
            raise ApiKeyError(API_KEY_ERROR)
        img = (image_data_url or "").strip()
        if not img:
            raise RuntimeError("图片为空")
        if not img.startswith("data:"):
            img = f"data:image/png;base64,{img}"

        def _call() -> str:
            compat_url = CONFIG.DASHSCOPE_COMPAT_BASE_URL

            # 1) 优先走 OpenAI 兼容（与官方 compatible-mode 示例一致）
            if compat_url:
                if OpenAI is None:
                    raise RuntimeError("请先安装 openai：pip install openai")
                client = OpenAI(api_key=self.api_key, base_url=compat_url)
                resp = client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "image_url", "image_url": {"url": img}},
                                {"type": "text", "text": user_prompt},
                            ],
                        }
                    ],
                )
                if not resp.choices:
                    raise RuntimeError(f"OpenAI兼容VL返回为空: {resp}")
                content = resp.choices[0].message.content
                if isinstance(content, str):
                    text = content.strip()
                    if text:
                        return text
                if isinstance(content, list):
                    parts: list[str] = []
                    for item in content:
                        if isinstance(item, dict):
                            t = item.get("text")
                            if t:
                                parts.append(str(t))
                    text = "".join(parts).strip()
                    if text:
                        return text
                raise RuntimeError(f"OpenAI兼容VL返回无法解析: {resp}")

            # 2) 兜底：走原生 DashScope MultiModalConversation
            _require_vl()
            _apply_dashscope_base_url()
            dashscope.api_key = self.api_key
            assert MultiModalConversation is not None
            resp = MultiModalConversation.call(
                model=self.model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"image": img},
                            {"text": user_prompt},
                        ],
                    }
                ],
            )
            return _extract_vl_text(resp)

        return await asyncio.to_thread(_call)

    async def describe_sketch(self, image_data_url: str) -> str:
        return await self._describe_with_prompt(image_data_url, SKETCH_VL_USER_PROMPT)

    async def describe_family_photo(self, image_data_url: str) -> str:
        return await self._describe_with_prompt(image_data_url, FAMILY_PHOTO_VL_USER_PROMPT)


class DashScopeQwenClient:
    """百炼 Qwen 文本生成（结构化 JSON 故事）。"""

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None) -> None:
        self.api_key = api_key or CONFIG.DASHSCOPE_API_KEY
        self.model = model or CONFIG.QWEN_MODEL

    async def generate(self, prompt: str) -> str:
        if not self.api_key:
            raise ApiKeyError(API_KEY_ERROR)

        def _call() -> str:
            compat_url = CONFIG.DASHSCOPE_COMPAT_BASE_URL

            # 1) 优先走 OpenAI 兼容（解决 compatible-mode 下 Generation.call 的 URL 报错）
            if compat_url:
                if OpenAI is None:
                    raise RuntimeError("请先安装 openai：pip install openai")
                client = OpenAI(api_key=self.api_key, base_url=compat_url)
                resp = client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {
                            "role": "system",
                            "content": "你是儿童绘本助手，只输出合法 JSON，不要输出多余解释。",
                        },
                        {"role": "user", "content": prompt},
                    ],
                )
                text = (resp.choices[0].message.content or "").strip() if resp.choices else ""
                if not text:
                    raise RuntimeError(f"OpenAI兼容文本生成返回为空: {resp}")
                return text

            # 2) 兜底：走原生 DashScope Generation
            _require_dashscope()
            _apply_dashscope_base_url()
            dashscope.api_key = self.api_key
            resp = Generation.call(
                api_key=self.api_key,
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是儿童绘本助手，只输出合法 JSON，不要输出多余解释。",
                    },
                    {"role": "user", "content": prompt},
                ],
                result_format="message",
            )
            return _extract_generation_text(resp)

        return await asyncio.to_thread(_call)

    async def chat_completion(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str | dict[str, Any] = "auto",
        parallel_tool_calls: bool = False,
    ) -> Any:
        """
        OpenAI 兼容多轮对话 + Function Calling（供沙盒 ReAct 主循环使用）。
        需配置 DASHSCOPE_COMPAT_BASE_URL；原生 DashScope Generation 不支持 tools。
        """
        if not self.api_key:
            raise ApiKeyError(API_KEY_ERROR)

        def _call() -> Any:
            compat_url = CONFIG.DASHSCOPE_COMPAT_BASE_URL
            if not compat_url:
                raise RuntimeError(
                    "沙盒 ReAct（Function Calling）需要 OpenAI 兼容网关，请配置环境变量 "
                    "DASHSCOPE_COMPAT_BASE_URL（例如百炼 compatible-mode 地址）。"
                )
            if OpenAI is None:
                raise RuntimeError("请先安装 openai：pip install openai")
            client = OpenAI(api_key=self.api_key, base_url=compat_url)
            return client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=tools,
                tool_choice=tool_choice,
                parallel_tool_calls=parallel_tool_calls,
            )

        return await asyncio.to_thread(_call)


class OpenAITextClient:
    """OpenAI 兼容文本模型：叙事生成 + Function Calling 调度。"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> None:
        self.api_key = api_key or CONFIG.OPENAI_API_KEY
        self.base_url = (base_url or CONFIG.OPENAI_BASE_URL or "").strip().rstrip("/")
        self.model = model or CONFIG.OPENAI_MODEL
        self.timeout_seconds = timeout_seconds or CONFIG.OPENAI_TIMEOUT_SECONDS
        self.max_retries = CONFIG.OPENAI_MAX_RETRIES

    def _client(self) -> Any:
        if not self.api_key:
            raise ApiKeyError("OPENAI_API_KEY 未配置")
        if not self.base_url:
            raise RuntimeError("OPENAI_BASE_URL 未配置")
        if not self.model:
            raise RuntimeError("OPENAI_MODEL 未配置")
        if OpenAI is None:
            raise RuntimeError("请先安装 openai：pip install openai")
        return OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=self.timeout_seconds,
            max_retries=self.max_retries,
        )

    async def generate(self, prompt: str) -> str:
        def _call() -> str:
            client = self._client()
            resp = client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是儿童绘本助手，只输出合法 JSON，不要输出多余解释。",
                    },
                    {"role": "user", "content": prompt},
                ],
            )
            text = (resp.choices[0].message.content or "").strip() if resp.choices else ""
            if not text:
                raise RuntimeError(f"OpenAI兼容文本生成返回为空: {resp}")
            return text

        return await asyncio.to_thread(_call)

    async def chat_completion(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str | dict[str, Any] = "auto",
        parallel_tool_calls: bool = False,
    ) -> Any:
        def _call() -> Any:
            client = self._client()
            params: dict[str, Any] = {
                "model": self.model,
                "messages": messages,
                "tools": tools,
                "tool_choice": tool_choice,
            }
            if parallel_tool_calls is not None:
                params["parallel_tool_calls"] = parallel_tool_calls
            try:
                return client.chat.completions.create(**params)
            except Exception as exc:
                detail = str(exc)
                if "parallel_tool_calls" in detail and "parallel_tool_calls" in params:
                    params.pop("parallel_tool_calls", None)
                    return client.chat.completions.create(**params)
                raise

        return await asyncio.to_thread(_call)


class LocalSafetyClient:
    """本地安全检查：不依赖云端内容安全服务。"""

    async def scan_text(self, text: str) -> Dict[str, Any]:
        high_risk_tokens = ["杀", "尸体", "仇恨", "报复", "霸凌", "恐怖", "血腥"]
        medium_risk_tokens = ["争吵", "撒谎", "欺骗"]
        high_hits = [token for token in high_risk_tokens if token in text]
        medium_hits = [token for token in medium_risk_tokens if token in text]
        if high_hits:
            return {
                "passed": False,
                "risk": "high",
                "raw": {"provider": "local", "hits": high_hits},
            }
        return {
            "passed": True,
            "risk": "medium" if medium_hits else "low",
            "raw": {"provider": "local", "hits": medium_hits},
        }

    async def scan_image(self, image_url: str) -> Dict[str, Any]:
        return {
            "passed": True,
            "risk": "low",
            "raw": {"provider": "local", "note": "image scan skipped"},
        }

    async def rewrite_to_safe(self, text: str) -> str:
        return f"（安全改写）我们把故事变得更温暖：{text[:200]}"


def _raise_if_dashscope_tts_error(status_code: int, body_text: str) -> None:
    """将 DashScope TTS 网关典型错误映射为前端可理解的错误。"""
    if status_code == 200:
        return
    lower = body_text.lower()
    if status_code in (400, 429) and (
        "throttling" in lower
        or "too_many_requests" in lower
        or "too many requests" in lower
        or "rate limit" in lower
    ):
        raise TtsRateLimitError(body_text[:500])
    if status_code in (401, 403):
        raise ApiKeyError(API_KEY_ERROR)
    if "invalidapikey" in lower or "invalid api key" in lower:
        raise ApiKeyError(API_KEY_ERROR)
    raise RuntimeError(f"DashScope TTS 请求失败: {status_code} {body_text[:500]}")


def _find_audio_url(value: Any) -> str | None:
    """CosyVoice 非流式接口返回 JSON，其中包含 24 小时有效音频 URL。"""
    if isinstance(value, dict):
        for key in ("url", "audio_url", "file_url"):
            raw = value.get(key)
            if isinstance(raw, str) and raw.startswith(("http://", "https://")):
                return raw
        for child in value.values():
            found = _find_audio_url(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = _find_audio_url(child)
            if found:
                return found
    return None


class DashScopeCosyVoiceTtsClient:
    """
    DashScope CosyVoice 语音合成：返回可前端播放的 data URL。
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        voice: Optional[str] = None,
        audio_format: Optional[str] = None,
        sample_rate: Optional[int] = None,
        endpoint: Optional[str] = None,
    ) -> None:
        self.api_key = api_key or CONFIG.DASHSCOPE_API_KEY
        self.model = model or CONFIG.DASHSCOPE_TTS_MODEL
        self.voice = voice or CONFIG.DASHSCOPE_TTS_VOICE
        self.audio_format = (audio_format or CONFIG.DASHSCOPE_TTS_FORMAT).lower()
        self.sample_rate = sample_rate or CONFIG.DASHSCOPE_TTS_SAMPLE_RATE
        self.endpoint = endpoint or CONFIG.DASHSCOPE_TTS_URL

    async def synthesize(self, text: str, voice: str) -> str:
        if not self.api_key:
            raise ApiKeyError(API_KEY_ERROR)
        selected_voice = voice if voice and voice != "亲切姐姐" else self.voice

        def _call_once() -> str:
            payload = {
                "model": self.model,
                "input": {
                    "text": text,
                    "voice": selected_voice,
                    "format": self.audio_format,
                    "sample_rate": self.sample_rate,
                },
            }
            r = requests.post(
                self.endpoint,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=90,
            )
            _raise_if_dashscope_tts_error(r.status_code, r.text or "")
            content_type = (r.headers.get("content-type") or "").lower()
            if "json" in content_type:
                data = r.json()
                audio_url = _find_audio_url(data)
                if not audio_url:
                    raise RuntimeError(f"DashScope TTS 未返回音频 URL: {r.text[:500]}")
                audio_resp = requests.get(audio_url, timeout=90)
                if audio_resp.status_code != 200:
                    raise RuntimeError(
                        f"下载 DashScope TTS 音频失败: {audio_resp.status_code} {audio_resp.text[:300]}"
                    )
                audio = audio_resp.content
                content_type = (audio_resp.headers.get("content-type") or "").lower()
            else:
                audio = r.content
            if not audio:
                raise RuntimeError("DashScope TTS 返回空音频")
            if audio[:1] in {b"{", b"["}:
                raise RuntimeError(f"DashScope TTS 返回疑似 JSON 而非音频: {audio[:500].decode('utf-8', errors='ignore')}")
            b64 = base64.b64encode(audio).decode("ascii")
            mime = next(
                (x for x in ("audio/mpeg", "audio/mp3", "audio/wav", "audio/aac") if x in content_type),
                None,
            ) or {
                "mp3": "audio/mpeg",
                "wav": "audio/wav",
                "pcm": "audio/L16",
            }.get(self.audio_format, "audio/mpeg")
            return f"data:{mime};base64,{b64}"

        # 限流时退避重试（多页并行时网关易返回 TOO_MANY_REQUESTS）
        max_attempts = 5
        last_exc: Exception | None = None
        for attempt in range(max_attempts):
            try:
                return await asyncio.to_thread(_call_once)
            except TtsRateLimitError as exc:
                last_exc = exc
                if attempt < max_attempts - 1:
                    await asyncio.sleep(1.0 * (2**attempt))
                    continue
                raise RuntimeError(
                    "语音服务繁忙（请求过于频繁），请稍后再试。"
                ) from exc
        raise RuntimeError("语音合成失败") from last_exc

# ========== 原 gemini_clients.py 合并段（共用上方 ApiKeyError / API_KEY_ERROR / CONFIG）==========
# 配置日志
logger = logging.getLogger(__name__)

try:
    from google import genai as google_genai
    from google.genai import types as genai_types
except ImportError:  # pragma: no cover
    google_genai = None  # type: ignore
    genai_types = None  # type: ignore


# ==========================================
# 风格预设常量区
# 将 Prefix 和 Suffix 集中管理，便于后续扩展
# ==========================================
STYLE_PROMPTS: Dict[str, Dict[str, str]] = {
    "剪纸": {
        "prefix": "Chinese paper-cut art style, red and gold, flat layers, decorative folk pattern, children's picture book, warm and clear, ",
        "suffix": ", Final image must look like paper-cut folk art, not oil painting or 3D, no horror, no text, no letters, no watermark, no logo."
    },
    "水墨": {
        "prefix": "Traditional Chinese shuimo ink wash painting, sumi-e on rice paper, soft wet brush strokes and controlled bleeding, generous negative space (留白), muted ink grays and light sepia washes, poetic children's book illustration, ",
        "suffix": ", Final image must read clearly as Chinese ink wash (水墨), NOT photorealistic, NOT 3D render, NOT thick glossy cel-shaded anime, avoid saturated rainbow colors, no horror, no text, no letters, no watermark, no logo."
    },
    "皮影": {
        "prefix": "Chinese shadow puppetry theater style, warm amber backlight, flat colored silhouette cutouts, stage-like framing, children's picture book, ",
        "suffix": ", Final image must look like shadow puppet silhouettes under stage light, no horror, no text, no letters, no watermark, no logo."
    },
    "漫画": {
        "prefix": "Friendly children's comic panel style, clean ink outlines, soft flat or light cel shading, bright but harmonious colors, Chinese cultural elements, ",
        "suffix": ", Final image must look like friendly children's comic illustration, no horror, no text, no letters, no watermark, no logo."
    }
}

DEFAULT_STYLE = {
    "prefix": "Chinese children's picture book illustration, culturally appropriate, warm, ",
    "suffix": ", Keep a consistent children's book illustration style, no horror, no text, no letters, no watermark, no logo."
}

IMAGE_COMPOSITION_PROMPT = (
    "Compose the full scene with important characters and props inside the safe center area, avoid edge cropping, "
)


def build_gemini_image_prompt(prompt: str, style: str) -> str:
    style_config = STYLE_PROMPTS.get(style, DEFAULT_STYLE)
    prefix = style_config["prefix"]
    suffix = style_config["suffix"]
    body = (prompt or "").strip()
    if body.endswith((".", ",")):
        body = body[:-1]
    return f"{prefix}{IMAGE_COMPOSITION_PROMPT}{body}{suffix}".strip()


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


def _gemini_image_config_payload() -> dict[str, str]:
    payload: dict[str, str] = {}
    aspect_ratio = (CONFIG.GEMINI_IMAGE_ASPECT_RATIO or "").strip()
    image_size = (CONFIG.GEMINI_IMAGE_SIZE or "").strip()
    if aspect_ratio:
        payload["aspectRatio"] = aspect_ratio
    if image_size:
        payload["imageSize"] = image_size
    return payload


def _parse_gemini_generate_content_image(resp: dict[str, Any]) -> str:
    """从 Gemini generateContent JSON 响应中解析 inlineData / inline_data 图片。"""
    candidates = resp.get("candidates")
    if isinstance(candidates, list):
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            content = candidate.get("content") or {}
            parts = content.get("parts") if isinstance(content, dict) else None
            if not isinstance(parts, list):
                continue
            for part in parts:
                if not isinstance(part, dict):
                    continue
                inline = part.get("inlineData") or part.get("inline_data")
                if not isinstance(inline, dict):
                    continue
                data = inline.get("data")
                if not isinstance(data, str) or not data.strip():
                    continue
                mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
                return f"data:{mime};base64,{data.strip()}"
    raise RuntimeError(f"Gemini generateContent 返回无法解析为图片: {repr(resp)[:500]}")


def _generate_via_gemini_generate_content(full_prompt: str) -> str:
    url = (CONFIG.GEMINI_OPENAI_BASE_URL or "").strip()
    if not url:
        raise RuntimeError("未配置 GEMINI_OPENAI_BASE_URL")
    key = _openai_image_api_key()
    generation_config: dict[str, Any] = {
        "responseModalities": ["TEXT", "IMAGE"],
    }
    image_config = _gemini_image_config_payload()
    if image_config:
        generation_config["imageConfig"] = image_config
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": full_prompt}],
            }
        ],
        "generationConfig": generation_config,
    }
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=CONFIG.OPENAI_TIMEOUT_SECONDS,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Gemini generateContent 调用失败 HTTP {resp.status_code}: {resp.text[:500]}")
    try:
        data = resp.json()
    except ValueError as exc:
        raise RuntimeError(f"Gemini generateContent 返回非 JSON: {resp.text[:500]}") from exc
    return _parse_gemini_generate_content_image(data)


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
    
    image_config = None
    image_options = _gemini_image_config_payload()
    if image_options:
        image_kwargs: dict[str, str] = {}
        annotations = getattr(genai_types.ImageConfig, "__annotations__", {})
        if "aspect_ratio" in annotations and "aspectRatio" in image_options:
            image_kwargs["aspect_ratio"] = image_options["aspectRatio"]
        if "image_size" in annotations and "imageSize" in image_options:
            image_kwargs["image_size"] = image_options["imageSize"]
        if image_kwargs:
            image_config = genai_types.ImageConfig(**image_kwargs)
        elif "aspectRatio" in image_options:
            image_config = genai_types.ImageConfig(aspect_ratio=image_options["aspectRatio"])

    cfg = genai_types.GenerateContentConfig(
        response_modalities=[genai_types.Modality.IMAGE],
        image_config=image_config,
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
        full_prompt = build_gemini_image_prompt(prompt, style)
        
        # 记录日志，对 AIGC 画风调试极其重要
        logger.info(f"🎨 [Gemini 生图 Prompt] Style: {style} | Prompt: {full_prompt}")

        def _call() -> str:
            try:
                image_base = (CONFIG.GEMINI_OPENAI_BASE_URL or "").strip()
                if image_base and (":generateContent" in image_base or "/v1beta/models/" in image_base):
                    return _generate_via_gemini_generate_content(full_prompt)
                if image_base:
                    return _generate_via_openai_compat(full_prompt)
                return _generate_via_google_genai(full_prompt)
            except Exception as e:
                logger.error(f"生图调用失败 | Error: {e} | Prompt: {full_prompt}")
                err = str(e).lower()
                if "model_not_found" in err or "no available channel" in err:
                    base = (CONFIG.GEMINI_OPENAI_BASE_URL or "").strip() or "Google GenAI"
                    raise RuntimeError(
                        f"配图模型不可用：GEMINI_IMAGE_MODEL={CONFIG.GEMINI_IMAGE_MODEL}，"
                        f"当前通道 {base} 未开通该模型。"
                        "请在中转站文档中选用支持文生图的模型名，或配置 GOOGLE_API_KEY 直连 Google。"
                    ) from e
                raise

        return await asyncio.to_thread(_call)
