"""
童趣绘梦 - Agent 调度核心

编排：百炼 Qwen（故事 JSON）→ Gemini 配图 → 阿里云 NLS 语音；草图模式先经千问 VL 读图。
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Dict, List, Protocol, Sequence

from config import CONFIG
from safety_middleware import SafetyMiddleware
from real_clients import ApiKeyError

# =========================
# 统一常量与数据结构
# =========================

USER_FACING_FALLBACK = "小精灵累了，请稍后再试"
MAX_IMAGE_RETRY = 2


@dataclass
class Scene:
    """分镜场景：每一页故事文本 + 对应图像提示词"""

    scene_no: int
    text: str
    image_prompt: str


class LLMClient(Protocol):
    """语言模型协议（DashScope Qwen 等）。"""

    async def generate(self, prompt: str) -> str:
        ...


class ImageClient(Protocol):
    """配图协议（Gemini 文生图等）。"""

    async def generate_image(self, prompt: str, style: str) -> str:
        ...


class TTSClient(Protocol):
    """语音合成协议（阿里云 NLS 等）。"""

    async def synthesize(self, text: str, voice: str) -> str:
        ...


class SafetyClient(Protocol):
    """内容安全审查。"""

    async def scan_text(self, text: str) -> Dict[str, Any]:
        ...

    async def scan_image(self, image_url: str) -> Dict[str, Any]:
        ...

    async def rewrite_to_safe(self, text: str) -> str:
        ...


class SketchVisionClient(Protocol):
    """草图理解（千问 VL）：将 data URL 草图转为中文描述。"""

    async def describe_sketch(self, image_data_url: str) -> str:
        ...


# =========================
# 核心编排器
# =========================


class StoryOrchestrator:
    """
    童趣绘梦调度器：
    - 面向“意图”编排，不让调用方关心底层模型细节。
    - 统一负责并发、重试、安全复审和错误兜底。
    """

    def __init__(
        self,
        llm_client: LLMClient,
        image_client: ImageClient,
        tts_client: TTSClient,
        safety_client: SafetyClient,
        safety_middleware: SafetyMiddleware | None = None,
        sketch_vision_client: SketchVisionClient | None = None,
    ) -> None:
        self.llm_client = llm_client
        self.image_client = image_client
        self.tts_client = tts_client
        self.safety_client = safety_client
        self.safety_middleware = safety_middleware or SafetyMiddleware()
        self.sketch_vision_client = sketch_vision_client

    async def run(
        self,
        keywords: str,
        style: str,
        sketch_image_base64: str | None = None,
        sketch_text: str | None = None,
    ) -> Dict[str, Any]:
        """
        主入口：
        输入：关键词 + 风格
        输出：结构化 JSON（故事文本、图片URL列表、音频URL列表）
        """
        try:
            sketch_understanding: str | None = None
            merged_keywords = keywords
            st = (sketch_text or "").strip()
            if st:
                merged_keywords = f"{merged_keywords}\n\n【孩子说的话】{st}".strip()
            if (
                sketch_image_base64
                and sketch_image_base64.strip()
                and self.sketch_vision_client is not None
            ):
                sketch_understanding = await self.sketch_vision_client.describe_sketch(
                    sketch_image_base64.strip()
                )
                merged_keywords = (
                    f"{merged_keywords}\n\n【孩子草图理解】{sketch_understanding}".strip()
                )

            filtered = await self.safety_middleware.filter_input(merged_keywords)
            safe_keywords = filtered["sanitized_keywords"]
            normalized_style = self._normalize_style(style)

            prompt = self._build_story_prompt(keywords=safe_keywords, style=normalized_style)

            raw_story = await self.llm_client.generate(prompt)
            safe_story = await self._ensure_safe_text(raw_story)
            title, story_text, scenes = self._parse_story_and_scenes(safe_story)
            image_urls, audio_urls = await asyncio.gather(
                self._generate_images_with_retry(scenes=scenes, style=normalized_style),
                self._synthesize_all_scenes(scenes=scenes, voice="亲切姐姐"),
            )

            title, story_text, scenes = await self._final_safety_review(
                title=title,
                story_text=story_text,
                scenes=scenes,
                image_urls=image_urls,
            )
            story_text = await self.safety_middleware.align_values(story_text)

            return {
                "ok": True,
                "mode": "real",
                "input_blocked": filtered["blocked"],
                "input_hits": filtered["hits"],
                "sketch_understanding": sketch_understanding,
                "title": title,
                "story_text": story_text,
                "scenes": [
                    {
                        "scene_no": s.scene_no,
                        "text": s.text,
                        "image_prompt": s.image_prompt,
                    }
                    for s in scenes
                ],
                "image_urls": image_urls,
                "audio_urls": audio_urls,
                "intercept_logs": self.safety_middleware.list_intercept_logs(),
            }
        except ApiKeyError as exc:
            return {
                "ok": False,
                "error": str(exc),
                "detail": str(exc),
                "mode": "real",
                "title": "",
                "story_text": "",
                "scenes": [],
                "image_urls": [],
                "audio_urls": [],
                "intercept_logs": self.safety_middleware.list_intercept_logs(),
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "ok": False,
                "error": USER_FACING_FALLBACK,
                "detail": str(exc),
                "mode": "real",
                "title": "",
                "story_text": "",
                "scenes": [],
                "image_urls": [],
                "audio_urls": [],
                "intercept_logs": self.safety_middleware.list_intercept_logs(),
            }

    def _build_story_prompt(self, keywords: str, style: str) -> str:
        system_prompt = self.safety_middleware.build_safe_system_prompt(style=style)
        return f"""
{system_prompt}

并请基于以下要求输出严格 JSON：
1) 年龄适配：3-10岁可读，语言温暖，句式简洁；
2) 内容风格：中国风，视觉风格偏向“{style}”；
3) 价值观：积极向上，强调勇气、合作、善良、诚信；
4) 每个场景的 image_prompt 必须用中文描述画面，且必须与画风「{style}」一致，不要写与之冲突的技法词：
   - 水墨：写意、留白、墨色浓淡、晕染、山水/物象轮廓，避免「色彩鲜艳厚涂、3D立体、照片写实、赛璐璐高光」等；
   - 剪纸：平面层次、红金配色、剪纸纹样，避免写实透视油画；
   - 皮影：剪影、灯影、舞台感，避免写实肖像；
   - 漫画：线稿、分块上色、夸张表情，避免水墨飞白。
5) 输出结构：
   - title: 故事标题
   - story: 完整故事（120-220字）
   - scenes: 3-4个场景，每个场景包含 scene_no, text, image_prompt
输入关键词：{keywords}
""".strip()

    def _normalize_style(self, style: str) -> str:
        mapping = {
            "paper-cut": "剪纸",
            "ink-wash": "水墨",
            "shadow-puppet": "皮影",
            "comic": "漫画",
            "剪纸": "剪纸",
            "水墨": "水墨",
            "皮影": "皮影",
            "漫画": "漫画",
        }
        return mapping.get(style, "水墨")

    async def _ensure_safe_text(self, text: str) -> str:
        result = await self.safety_client.scan_text(text)
        if result.get("passed", False):
            return text
        return await self.safety_client.rewrite_to_safe(text)

    def _parse_story_and_scenes(self, raw: str) -> tuple[str, str, List[Scene]]:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError("LLM 输出不是合法 JSON") from exc

        title = str(data.get("title", "童趣绘梦"))
        story_text = str(data.get("story", ""))
        raw_scenes: Sequence[Dict[str, Any]] = data.get("scenes", [])
        if not raw_scenes:
            raise ValueError("LLM 未返回 scenes")

        scenes: List[Scene] = []
        for idx, item in enumerate(raw_scenes[:4], start=1):
            scenes.append(
                Scene(
                    scene_no=int(item.get("scene_no", idx)),
                    text=str(item.get("text", "")),
                    image_prompt=str(item.get("image_prompt", "")),
                )
            )
        return title, story_text, scenes

    async def _generate_images_with_retry(self, scenes: Sequence[Scene], style: str) -> List[str]:
        async def _task(scene: Scene) -> str:
            last_error: Exception | None = None
            for attempt in range(MAX_IMAGE_RETRY + 1):
                try:
                    return await self.image_client.generate_image(scene.image_prompt, style)
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if attempt < MAX_IMAGE_RETRY:
                        await asyncio.sleep(0.5 * (2**attempt))
                        continue
                    inner = str(last_error)[:500]
                    raise RuntimeError(
                        f"场景{scene.scene_no}图片生成失败（已重试{MAX_IMAGE_RETRY}次）：{inner}"
                    ) from last_error

            raise RuntimeError("图片生成异常终止")

        # Gemini 文生图并行易触发 RPM/并发限流，串行 + 间隔。
        urls: List[str] = []
        for idx, scene in enumerate(scenes):
            if idx > 0:
                await asyncio.sleep(0.9)
            urls.append(await _task(scene))
        return urls

    async def _synthesize_all_scenes(self, scenes: Sequence[Scene], voice: str) -> List[str]:
        # NLS 网关对并发/QPS 敏感，串行 + 间隔。
        urls: List[str] = []
        for idx, scene in enumerate(scenes):
            if idx > 0:
                await asyncio.sleep(0.45)
            urls.append(await self.tts_client.synthesize(scene.text, voice))
        return urls

    async def _final_safety_review(
        self,
        title: str,
        story_text: str,
        scenes: Sequence[Scene],
        image_urls: Sequence[str],
    ) -> tuple[str, str, List[Scene]]:
        merged_text = " ".join([title, story_text, *[s.text for s in scenes]])
        text_result = await self.safety_client.scan_text(merged_text)
        if not text_result.get("passed", False):
            story_text = await self.safety_client.rewrite_to_safe(story_text)
            scenes = [
                Scene(scene_no=s.scene_no, text=await self.safety_client.rewrite_to_safe(s.text), image_prompt=s.image_prompt)
                for s in scenes
            ]

        safe_image_urls: List[str] = []
        for url in image_urls:
            img_result = await self.safety_client.scan_image(url)
            if img_result.get("passed", False):
                safe_image_urls.append(url)
            else:
                safe_image_urls.append("https://cdn.tongqu.local/images/safe-fallback.png")

        return title, story_text, list(scenes)


def build_default_orchestrator() -> StoryOrchestrator:
    """装配真实客户端：百炼 Qwen + 千问 VL + Green/NLS + Gemini 配图。"""
    missing: list[str] = []
    if not CONFIG.DASHSCOPE_API_KEY:
        missing.append("DASHSCOPE_API_KEY")
    if not CONFIG.ALIYUN_ACCESS_KEY_ID or not CONFIG.ALIYUN_ACCESS_KEY_SECRET:
        missing.append("ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET")
    if not (CONFIG.GOOGLE_API_KEY or CONFIG.GEMINI_OPENAI_API_KEY):
        missing.append("GOOGLE_API_KEY（或 GEMINI_OPENAI_API_KEY，用于配图）")
    if missing:
        raise RuntimeError(
            "请配置：" + "、".join(missing) + "。"
            "故事与语音走阿里云，配图走 Gemini 或 OpenAI 兼容中转。"
        )

    from gemini_clients import GeminiImageClient
    from real_clients import (
        AliyunGreenSafetyClient,
        AliyunNlsTtsClient,
        DashScopeQwenClient,
        DashScopeQwenVLClient,
    )

    return StoryOrchestrator(
        llm_client=DashScopeQwenClient(),
        image_client=GeminiImageClient(),
        tts_client=AliyunNlsTtsClient(),
        safety_client=AliyunGreenSafetyClient(),
        sketch_vision_client=DashScopeQwenVLClient(),
    )


class LangChainQwenClient:
    """可选：将 LangChain ChatModel 接入 LLMClient 协议。"""

    def __init__(self, chat_model: Any) -> None:
        self.chat_model = chat_model

    async def generate(self, prompt: str) -> str:
        msg = await self.chat_model.ainvoke(prompt)
        return getattr(msg, "content", str(msg))


async def demo() -> None:
    orchestrator = build_default_orchestrator()
    result = await orchestrator.run(keywords="孙悟空+神龟", style="水墨")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(demo())
