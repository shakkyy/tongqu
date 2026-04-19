"""
故事成书流水线：Qwen Plus 生成结构化故事 JSON → 全部由 Gemini 配图 → NLS 朗读。

输入仅为已整理好的「故事素材」纯文本（语音/选词/草图模块需先合并完成）。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Sequence

from config import CONFIG
from core.clients import ApiKeyError
from core.models import (
    MAX_IMAGE_RETRY,
    USER_FACING_FALLBACK,
    ImageClient,
    LLMClient,
    SafetyClient,
    Scene,
    TTSClient,
)
from core.safety import SafetyMiddleware
from services.style_keyword_enhancer import StyleKeywordEnhancer


class StorybookPipeline:
    """
    Qwen Plus（叙事）+ Gemini（全部插图）+ 安全与 TTS。
    """

    def __init__(
        self,
        llm_client: LLMClient,
        image_client: ImageClient,
        tts_client: TTSClient,
        safety_client: SafetyClient,
        safety_middleware: SafetyMiddleware | None = None,
        style_keyword_enhancer: StyleKeywordEnhancer | None = None,
    ) -> None:
        self.llm_client = llm_client
        self.image_client = image_client
        self.tts_client = tts_client
        self.safety_client = safety_client
        self.safety_middleware = safety_middleware or SafetyMiddleware()
        self.style_keyword_enhancer = style_keyword_enhancer or StyleKeywordEnhancer()

    async def run(
        self,
        story_keywords: str,
        style: str,
        *,
        enable_style_keyword_enhancer: bool | None = None,
    ) -> Dict[str, Any]:
        try:
            filtered = await self.safety_middleware.filter_input(story_keywords)
            safe_keywords = filtered["sanitized_keywords"]
            normalized_style = self._normalize_style(style)
            enhancer_enabled = (
                CONFIG.STYLE_KEYWORD_ENHANCER_ENABLED
                if enable_style_keyword_enhancer is None
                else enable_style_keyword_enhancer
            )
            if enhancer_enabled:
                enhancement_result = self.style_keyword_enhancer.enhance(
                    safe_keywords,
                    normalized_style,
                    enabled=True,
                )
                enhancement = {
                    "selected_keywords": enhancement_result.selected_keywords,
                    "rewritten_prompt": enhancement_result.rewritten_prompt,
                    "used_model": enhancement_result.used_model,
                    "model_error": enhancement_result.model_error,
                }
            else:
                enhancement = {
                    "selected_keywords": [],
                    "rewritten_prompt": safe_keywords,
                    "used_model": False,
                    "model_error": None,
                }

            prompt = self._build_story_prompt(
                keywords=enhancement["rewritten_prompt"],
                style=normalized_style,
            )

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
                "style_keyword_enhancer_enabled": enhancer_enabled,
                "style_keywords": enhancement["selected_keywords"],
                "enhanced_keywords_prompt": enhancement["rewritten_prompt"],
                "style_keyword_model_used": enhancement["used_model"],
                "style_keyword_model_error": enhancement["model_error"],
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
                "style_keyword_enhancer_enabled": False,
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
                "style_keyword_enhancer_enabled": False,
                "intercept_logs": self.safety_middleware.list_intercept_logs(),
            }

    async def finalize_from_structured(
        self,
        *,
        style: str,
        title: str,
        story_text: str,
        scenes: List[Scene],
        input_blocked: bool,
        input_hits: List[str],
        enhancement: Dict[str, Any],
        enhancer_enabled: bool,
    ) -> Dict[str, Any]:
        """
        ReAct / 沙盒主链完成后：配图 + TTS + 终审；并回传与 run() 一致的风格关键词增强元数据
        （enhancement 由上游在 filter 之后按与 run() 相同逻辑预先计算）。
        """
        normalized_style = self._normalize_style(style)
        try:
            bundle = json.dumps(
                {
                    "title": title,
                    "story": story_text,
                    "scenes": [
                        {
                            "scene_no": s.scene_no,
                            "text": s.text,
                            "image_prompt": s.image_prompt,
                        }
                        for s in scenes
                    ],
                },
                ensure_ascii=False,
            )
            safe_bundle = await self._ensure_safe_text(bundle)
            try:
                data = json.loads(safe_bundle)
                title = str(data.get("title", title))
                story_text = str(data.get("story", story_text))
                raw_scenes = data.get("scenes") or []
                if isinstance(raw_scenes, list) and raw_scenes:
                    parsed: List[Scene] = []
                    for idx, item in enumerate(raw_scenes[:4], start=1):
                        if not isinstance(item, dict):
                            continue
                        parsed.append(
                            Scene(
                                scene_no=int(item.get("scene_no", idx)),
                                text=str(item.get("text", "")),
                                image_prompt=str(item.get("image_prompt", "")),
                            )
                        )
                    if parsed:
                        scenes = parsed
            except json.JSONDecodeError:
                pass

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
                "input_blocked": input_blocked,
                "input_hits": input_hits,
                "style_keyword_enhancer_enabled": enhancer_enabled,
                "style_keywords": enhancement["selected_keywords"],
                "enhanced_keywords_prompt": enhancement["rewritten_prompt"],
                "style_keyword_model_used": enhancement["used_model"],
                "style_keyword_model_error": enhancement["model_error"],
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
                "style_keyword_enhancer_enabled": enhancer_enabled,
                "style_keywords": enhancement.get("selected_keywords", []),
                "enhanced_keywords_prompt": enhancement.get("rewritten_prompt", ""),
                "style_keyword_model_used": enhancement.get("used_model", False),
                "style_keyword_model_error": enhancement.get("model_error"),
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
                "style_keyword_enhancer_enabled": enhancer_enabled,
                "style_keywords": enhancement.get("selected_keywords", []),
                "enhanced_keywords_prompt": enhancement.get("rewritten_prompt", ""),
                "style_keyword_model_used": enhancement.get("used_model", False),
                "style_keyword_model_error": enhancement.get("model_error"),
                "intercept_logs": self.safety_middleware.list_intercept_logs(),
            }

    def _build_story_prompt(self, keywords: str, style: str) -> str:
        system_prompt = self.safety_middleware.build_safe_system_prompt(style=style)
        return f"""
{system_prompt}

你是一个专业的儿童绘本创作者。请基于以下要求，将输入的关键词创作为图文并茂的绘本，并输出严格的 JSON 格式：

1) 读者定位：3-10岁儿童。语言温暖童趣，句式简短。
2) 价值观导向：积极向上，自然融入（而非生硬说教）勇气、合作、善良或诚信等品质。
3) 故事结构：
   - title: 创意且吸引人的故事标题（中文）
   - story: 完整故事连贯流畅（总字数 150-250 字）
   - scenes: 将故事拆分为 3-4 个画面场景。
4) 场景字段要求 (scenes)：
   - scene_no: 场景序号 (1, 2, 3...)
   - text: 该画面的绘本旁白（中文，约 30-50 字）
   - image_prompt: 提交给 AI 生图模型的提示词【重要规范如下】：
     a. **必须完全使用英文 (English)** 输出。
     b. **不要带叙事动作**（如 "decided to", "felt happy"），只描述定格画面可见的内容。
     c. **画面结构**：[Main Subject & Appearance] + [Action/Pose] + [Environment/Background] + [Lighting/Atmosphere].
     d. **角色一致性**：在第一个场景为主角设定简短的英文视觉特征（如 "a 5-year-old Chinese boy wearing a red shirt and blue pants"），并在后续**每一个**场景的 image_prompt 中严格重复这段特征，以保持角色长相连贯。
     e. **风格适配**：基于当前的风格「{style}」，在英文中加入对应的高级修饰词，并避开冲突技法：
        - 水墨 (Ink wash): "traditional Chinese ink wash painting, minimalist, expressive brushstrokes, negative space", 避免 "3D, photorealistic, thick impasto".
        - 剪纸 (Paper cutting): "Chinese paper cutting art, layered flat paper, intricate cutout patterns, red and gold color palette", 避免 "realistic perspective, oil painting".
        - 皮影 (Shadow play): "Chinese shadow puppetry, silhouette against an illuminated screen, theatrical lighting, jointed flat figures", 避免 "realistic portraits, daylight".
        - 漫画 (Comic): "vibrant comic book style, clear line art, flat colors, expressive features", 避免 "ink wash, photorealism".

输入素材与风格强化信息：{keywords}
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

        urls: List[str] = []
        for idx, scene in enumerate(scenes):
            if idx > 0:
                await asyncio.sleep(0.9)
            urls.append(await _task(scene))
        return urls

    async def _synthesize_all_scenes(self, scenes: Sequence[Scene], voice: str) -> List[str]:
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
                Scene(
                    scene_no=s.scene_no,
                    text=await self.safety_client.rewrite_to_safe(s.text),
                    image_prompt=s.image_prompt,
                )
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


def build_default_story_pipeline() -> StorybookPipeline:
    """装配：Qwen Plus + Gemini 配图 + Green + NLS。"""
    missing: list[str] = []
    if not CONFIG.DASHSCOPE_API_KEY:
        missing.append("DASHSCOPE_API_KEY")
    if not CONFIG.ALIYUN_ACCESS_KEY_ID or not CONFIG.ALIYUN_ACCESS_KEY_SECRET:
        missing.append("ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET")
    if not (CONFIG.GOOGLE_API_KEY or CONFIG.GEMINI_OPENAI_API_KEY):
        missing.append("GOOGLE_API_KEY（或 GEMINI_OPENAI_API_KEY，用于 Gemini 配图）")
    if missing:
        raise RuntimeError(
            "请配置：" + "、".join(missing) + "。"
            "叙事走百炼 Qwen Plus，配图全部走 Gemini。"
        )

    from core.clients import (
        AliyunGreenSafetyClient,
        AliyunNlsTtsClient,
        DashScopeQwenClient,
        GeminiImageClient,
    )

    return StorybookPipeline(
        llm_client=DashScopeQwenClient(),
        image_client=GeminiImageClient(),
        tts_client=AliyunNlsTtsClient(),
        safety_client=AliyunGreenSafetyClient(),
    )


class LangChainQwenClient:
    """可选：将 LangChain ChatModel 接入 LLMClient 协议。"""

    def __init__(self, chat_model: Any) -> None:
        self.chat_model = chat_model

    async def generate(self, prompt: str) -> str:
        msg = await self.chat_model.ainvoke(prompt)
        return getattr(msg, "content", str(msg))
