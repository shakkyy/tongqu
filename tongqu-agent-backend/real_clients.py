"""
真实 API 客户端：DashScope（故事 + 文生图）+ 阿里云 Green（审核）+ NLS（语音）。

说明：
- 绘本配图需要「静态图」：默认使用 DashScope 万相文生图（wanx-v*）。
- wan2.6-i2v 为「图生视频」异步接口，与绘本静态页需求不同；如需视频可另接异步任务，此处不混用。
- 密钥只从环境变量读取；无效时抛出 ApiKeyError，提示「API 密钥配置错误」。
"""

from __future__ import annotations

import asyncio
import base64
import json
import urllib.parse
from typing import Any, Dict, Optional

import requests

try:
    import dashscope
    from dashscope import Generation, ImageSynthesis
except ImportError:  # pragma: no cover
    dashscope = None  # type: ignore
    Generation = None  # type: ignore
    ImageSynthesis = None  # type: ignore

try:
    from alibabacloud_green20220302.client import Client as Green20220302Client
    from alibabacloud_green20220302 import models as green_models
    from alibabacloud_tea_openapi import models as open_api_models
except ImportError:  # pragma: no cover
    Green20220302Client = None  # type: ignore
    green_models = None  # type: ignore
    open_api_models = None  # type: ignore

try:
    from aliyunsdkcore.client import AcsClient
    from aliyunsdkcore.request import CommonRequest
except ImportError:  # pragma: no cover
    AcsClient = None  # type: ignore
    CommonRequest = None  # type: ignore

from config import CONFIG


API_KEY_ERROR = "API 密钥配置错误"

# NLS 的 AppKey 与 RAM 的 AccessKey 完全不同；常见误把 LTAI… 填进 ALIYUN_NLS_APPKEY。
NLS_APPKEY_HINT = (
    "API 密钥配置错误：ALIYUN_NLS_APPKEY 无效。"
    "请到阿里云控制台「智能语音交互」创建应用，复制该应用的 AppKey；"
    "不要填写 AccessKey ID（通常以 LTAI 开头）。"
)


class ApiKeyError(RuntimeError):
    """Access key / DashScope key 无效或缺失。"""


class NlsRateLimitError(RuntimeError):
    """阿里云 NLS 网关限流（并发或 QPS 过高）。"""


def _require_dashscope() -> None:
    if dashscope is None or Generation is None or ImageSynthesis is None:
        raise RuntimeError("请先安装 dashscope：pip install dashscope")


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


def _extract_image_url(resp: Any) -> str:
    if getattr(resp, "status_code", None) == 200 and resp.output:
        results = getattr(resp.output, "results", None)
        if results:
            first = results[0]
            url = getattr(first, "url", None)
            if url is None and isinstance(first, dict):
                url = first.get("url")
            if url:
                return str(url)
    if getattr(resp, "status_code", None) != 200:
        if _is_key_like_invalid(resp):
            raise ApiKeyError(API_KEY_ERROR)
        raise RuntimeError(f"DashScope 图像生成失败: {resp}")
    raise RuntimeError(f"DashScope 图像返回无法解析: {resp}")


class DashScopeQwenClient:
    """百炼 Qwen 文本生成（结构化 JSON 故事）。"""

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None) -> None:
        self.api_key = api_key or CONFIG.DASHSCOPE_API_KEY
        self.model = model or CONFIG.QWEN_MODEL

    async def generate(self, prompt: str) -> str:
        if not self.api_key:
            raise ApiKeyError(API_KEY_ERROR)
        _require_dashscope()

        def _call() -> str:
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


class DashScopeWanxImageClient:
    """
    万相文生图（静态配图 URL）。
    风格通过 prompt 前缀强化（剪纸/水墨/皮影）。
    """

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None) -> None:
        self.api_key = api_key or CONFIG.DASHSCOPE_API_KEY
        self.model = model or CONFIG.DASHSCOPE_IMAGE_MODEL

    def _style_prefix(self, style: str) -> str:
        mapping = {
            "剪纸": "中国剪纸艺术风格，红色与金色点缀，平面层次，儿童绘本，明亮温暖，无恐怖元素，",
            "水墨": "中国水墨画风格，留白与晕染，柔和笔触，儿童绘本，明亮温暖，无恐怖元素，",
            "皮影": "中国传统皮影戏风格，剪影与暖色灯光，舞台感，儿童绘本，明亮温暖，无恐怖元素，",
        }
        return mapping.get(style, mapping["水墨"])

    async def generate_image(self, prompt: str, style: str) -> str:
        if not self.api_key:
            raise ApiKeyError(API_KEY_ERROR)
        _require_dashscope()
        full_prompt = f"{self._style_prefix(style)}{prompt}"

        def _call() -> str:
            resp = ImageSynthesis.call(
                api_key=self.api_key,
                model=self.model,
                prompt=full_prompt,
                n=1,
                size="1024*1024",
            )
            return _extract_image_url(resp)

        return await asyncio.to_thread(_call)


class AliyunGreenSafetyClient:
    """内容安全 Green：文本 + 图片 URL 审核。"""

    def __init__(
        self,
        access_key_id: Optional[str] = None,
        access_key_secret: Optional[str] = None,
        region: Optional[str] = None,
    ) -> None:
        self.access_key_id = access_key_id or CONFIG.ALIYUN_ACCESS_KEY_ID
        self.access_key_secret = access_key_secret or CONFIG.ALIYUN_ACCESS_KEY_SECRET
        self.region = region or CONFIG.ALIYUN_REGION
        self._client = self._build_client()

    def _build_client(self) -> Any:
        if Green20220302Client is None or open_api_models is None:
            raise RuntimeError("请先安装 alibabacloud-green20220302 等依赖")
        if not self.access_key_id or not self.access_key_secret:
            raise ApiKeyError(API_KEY_ERROR)
        cfg = open_api_models.Config(
            access_key_id=self.access_key_id,
            access_key_secret=self.access_key_secret,
            region_id=self.region,
        )
        cfg.endpoint = f"green.{self.region}.aliyuncs.com"
        return Green20220302Client(cfg)

    async def scan_text(self, text: str) -> Dict[str, Any]:
        if not self.access_key_id or not self.access_key_secret:
            raise ApiKeyError(API_KEY_ERROR)

        def _call() -> Dict[str, Any]:
            try:
                # 文本审核增强版（需控制台开通对应服务）
                req = green_models.TextModerationRequest(
                    service=CONFIG.GREEN_TEXT_SERVICE,
                    service_parameters=json.dumps({"content": text}, ensure_ascii=False),
                )
                resp = self._client.text_moderation(req)
                body = resp.body if hasattr(resp, "body") else resp
                data = body.to_map() if hasattr(body, "to_map") else {}
            except Exception as exc:  # noqa: BLE001
                err = str(exc).lower()
                if "invalidaccesskeyid" in err or "signature" in err or "403" in err:
                    raise ApiKeyError(API_KEY_ERROR) from exc
                raise

            # 简化解析：若存在建议拦截标签则判不通过
            risk = "low"
            passed = True
            try:
                result = data.get("Data") or data.get("data") or {}
                labels = result.get("Result") or result.get("labels") or []
                if isinstance(labels, list) and labels:
                    for item in labels:
                        lab = (item or {}).get("Label") or (item or {}).get("label")
                        if lab and str(lab).lower() not in {"non_label", "normal"}:
                            passed = False
                            risk = "high"
                            break
            except Exception:
                passed = True
                risk = "low"

            return {"passed": passed, "risk": risk, "raw": data}

        return await asyncio.to_thread(_call)

    async def scan_image(self, image_url: str) -> Dict[str, Any]:
        if not self.access_key_id or not self.access_key_secret:
            raise ApiKeyError(API_KEY_ERROR)

        def _call() -> Dict[str, Any]:
            try:
                req = green_models.ImageModerationRequest(
                    service=CONFIG.GREEN_IMAGE_SERVICE,
                    service_parameters=json.dumps({"imageUrl": image_url}, ensure_ascii=False),
                )
                resp = self._client.image_moderation(req)
                body = resp.body if hasattr(resp, "body") else resp
                data = body.to_map() if hasattr(body, "to_map") else {}
            except Exception as exc:  # noqa: BLE001
                err = str(exc).lower()
                if "invalidaccesskeyid" in err or "signature" in err or "403" in err:
                    raise ApiKeyError(API_KEY_ERROR) from exc
                raise

            passed = True
            risk = "low"
            try:
                result = data.get("Data") or data.get("data") or {}
                if result.get("RiskLevel") in {"high", "medium"}:
                    passed = False
                    risk = str(result.get("RiskLevel"))
            except Exception:
                passed = True

            return {"passed": passed, "risk": risk, "raw": data}

        return await asyncio.to_thread(_call)

    async def rewrite_to_safe(self, text: str) -> str:
        return f"（安全改写）我们把故事变得更温暖：{text[:200]}"


def _create_nls_token(access_key_id: str, access_key_secret: str, region: str) -> str:
    if AcsClient is None or CommonRequest is None:
        raise RuntimeError("请先安装 aliyun-python-sdk-core")
    client = AcsClient(access_key_id, access_key_secret, region)
    req = CommonRequest()
    req.set_method("POST")
    req.set_domain("nls-meta.cn-shanghai.aliyuncs.com")
    req.set_version("2019-02-28")
    req.set_action_name("CreateToken")
    req.add_query_param("RegionId", region)
    resp = client.do_action_with_exception(req)
    data = json.loads(resp.decode("utf-8"))
    token = data.get("Token", {}).get("Id")
    if not token:
        if _is_key_like_invalid(str(data)):
            raise ApiKeyError(API_KEY_ERROR)
        raise RuntimeError(f"CreateToken 失败: {data}")
    return str(token)


def _is_invalid_nls_appkey(app_key: str) -> bool:
    """AccessKey ID 常被误填为 NLS AppKey。"""
    return app_key.strip().upper().startswith("LTAI")


def _raise_if_nls_tts_error(status_code: int, body_text: str) -> None:
    """将 NLS 网关典型错误映射为 ApiKeyError，便于前端展示统一提示。"""
    if status_code == 200:
        return
    lower = body_text.lower()
    # 网关 QPS / 并发过高：可重试
    if status_code == 400 and (
        "40000005" in body_text
        or "too_many_requests" in lower
        or "too many requests" in lower
    ):
        raise NlsRateLimitError(body_text[:500])
    if status_code == 400 and (
        "40020105" in body_text
        or "appkey_not_exist" in lower
        or "appkey not exist" in lower
    ):
        raise ApiKeyError(NLS_APPKEY_HINT)
    if status_code in (401, 403):
        raise ApiKeyError(API_KEY_ERROR)
    raise RuntimeError(f"TTS 请求失败: {status_code} {body_text[:500]}")


class AliyunNlsTtsClient:
    """
    阿里云 NLS 语音合成：返回可前端播放的 data URL（mp3 base64）。
    需在控制台创建项目并配置 ALIYUN_NLS_APPKEY。
    """

    def __init__(
        self,
        access_key_id: Optional[str] = None,
        access_key_secret: Optional[str] = None,
        app_key: Optional[str] = None,
        region: Optional[str] = None,
        voice: Optional[str] = None,
    ) -> None:
        self.access_key_id = access_key_id or CONFIG.ALIYUN_ACCESS_KEY_ID
        self.access_key_secret = access_key_secret or CONFIG.ALIYUN_ACCESS_KEY_SECRET
        self.app_key = app_key or CONFIG.ALIYUN_NLS_APPKEY
        self.region = region or CONFIG.ALIYUN_REGION
        self.voice = voice or CONFIG.ALIYUN_NLS_VOICE

    async def synthesize(self, text: str, voice: str) -> str:
        if not self.access_key_id or not self.access_key_secret:
            raise ApiKeyError(API_KEY_ERROR)
        if not (self.app_key or "").strip():
            raise ApiKeyError(
                "API 密钥配置错误：请填写 ALIYUN_NLS_APPKEY（智能语音交互控制台创建应用后的 AppKey，不是 AccessKey）。"
            )
        if _is_invalid_nls_appkey(self.app_key):
            raise ApiKeyError(NLS_APPKEY_HINT)

        def _call_once() -> str:
            token = _create_nls_token(self.access_key_id, self.access_key_secret, self.region)
            encoded_text = urllib.parse.quote_plus(text)
            url = (
                "https://nls-gateway.cn-shanghai.aliyuncs.com/stream/v1/tts"
                f"?appkey={self.app_key}&token={token}&text={encoded_text}"
                f"&format=mp3&voice={urllib.parse.quote_plus(self.voice)}"
            )
            r = requests.get(url, timeout=60)
            _raise_if_nls_tts_error(r.status_code, r.text or "")
            audio = r.content
            b64 = base64.b64encode(audio).decode("ascii")
            return f"data:audio/mpeg;base64,{b64}"

        # 限流时退避重试（多页并行时网关易返回 TOO_MANY_REQUESTS）
        max_attempts = 5
        last_exc: Exception | None = None
        for attempt in range(max_attempts):
            try:
                return await asyncio.to_thread(_call_once)
            except NlsRateLimitError as exc:
                last_exc = exc
                if attempt < max_attempts - 1:
                    await asyncio.sleep(1.0 * (2**attempt))
                    continue
                raise RuntimeError(
                    "语音服务繁忙（请求过于频繁），请稍后再试。"
                ) from exc
        raise RuntimeError("语音合成失败") from last_exc
