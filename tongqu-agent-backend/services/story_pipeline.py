"""
故事成书流水线：Qwen Plus 生成结构化故事 JSON → 全部由 Gemini 配图 → CosyVoice 朗读。

输入仅为已整理好的「故事素材」纯文本（语音/选词/草图模块需先合并完成）。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable, Dict, List, Sequence

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

ProgressReporter = Callable[[dict[str, Any]], Awaitable[None]]

IMAGE_PROMPT_LAYOUT_FRAGMENT = (
    "Landscape 16:10 aspect ratio for the final image, matched to the book viewer frame, "
    "full scene composition with important characters and props inside the safe center area, avoid edge cropping."
)


def _ensure_image_prompt_layout(prompt: str) -> str:
    body = (prompt or "").strip()
    if "16:10" in body or "16 by 10" in body.lower():
        return body
    if not body:
        return IMAGE_PROMPT_LAYOUT_FRAGMENT
    return f"{IMAGE_PROMPT_LAYOUT_FRAGMENT} {body}"


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
        on_progress: ProgressReporter | None = None,
        run_recorder: Any | None = None,
    ) -> Dict[str, Any]:
        try:
            await self._emit_progress(
                on_progress,
                "orchestrate",
                "中枢 Agent 编排",
                "正在进行输入安全过滤与任务编排",
            )
            filtered = await self.safety_middleware.filter_input(story_keywords)
            safe_keywords = filtered["sanitized_keywords"]
            normalized_style = self._normalize_style(style)
            enhancer_enabled = (
                CONFIG.STYLE_KEYWORD_ENHANCER_ENABLED
                if enable_style_keyword_enhancer is None
                else enable_style_keyword_enhancer
            )
            enhancement = {
                "selected_keywords": [],
                "rewritten_prompt": safe_keywords,
                "used_model": False,
                "model_error": None,
                "image_prompt_enhancements": [],
            }

            prompt = self._build_story_prompt(
                keywords=enhancement["rewritten_prompt"],
                style=normalized_style,
            )
            if run_recorder is not None:
                run_recorder.record(
                    "legacy_story_llm_request",
                    {
                        "safe_keywords": safe_keywords,
                        "normalized_style": normalized_style,
                        "prompt": prompt,
                    },
                )

            await self._emit_progress(
                on_progress,
                "draft",
                "撰写故事正文",
                "正在生成故事标题、正文与分镜草案",
            )
            raw_story = await self.llm_client.generate(prompt)
            if run_recorder is not None:
                run_recorder.record("legacy_story_llm_response", {"raw": raw_story})
            safe_story = await self._ensure_safe_text(raw_story)
            title, story_text, scenes = self._parse_story_and_scenes(safe_story)
            await self._emit_progress(
                on_progress,
                "board",
                "生成分镜脚本",
                f"已完成故事草稿，准备生成 {len(scenes)} 个场景",
            )
            await self._emit_progress(
                on_progress,
                "image",
                "绘制插画场景",
                f"开始为 {len(scenes)} 个分镜生成配图",
                total=len(scenes),
            )
            scenes, image_prompt_enhancements = self._enhance_scene_image_prompts(
                scenes,
                style=normalized_style,
                enabled=enhancer_enabled,
            )
            enhancement = self._merge_image_prompt_enhancement(
                enhancement,
                image_prompt_enhancements,
            )
            image_urls = await self._generate_images_with_retry(
                scenes=scenes,
                style=normalized_style,
                on_progress=on_progress,
                run_recorder=run_recorder,
            )
            await self._emit_progress(
                on_progress,
                "tts",
                "合成朗读音频",
                f"开始用 DashScope CosyVoice（{CONFIG.DASHSCOPE_TTS_MODEL} / {CONFIG.DASHSCOPE_TTS_VOICE}）为 {len(scenes)} 页旁白合成音频",
                total=len(scenes),
            )
            audio_urls = await self._synthesize_all_scenes(
                scenes=scenes,
                voice="亲切姐姐",
                on_progress=on_progress,
                run_recorder=run_recorder,
            )

            await self._emit_progress(
                on_progress,
                "review",
                "安全审阅与润色",
                "正在执行图文安全复核与价值观对齐",
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
                "image_prompt_enhancements": enhancement["image_prompt_enhancements"],
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
                "style_keywords": [],
                "enhanced_keywords_prompt": "",
                "image_prompt_enhancements": [],
                "style_keyword_model_used": False,
                "style_keyword_model_error": None,
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
                "style_keywords": [],
                "enhanced_keywords_prompt": "",
                "image_prompt_enhancements": [],
                "style_keyword_model_used": False,
                "style_keyword_model_error": None,
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
        on_progress: ProgressReporter | None = None,
        run_recorder: Any | None = None,
        visual_consistency: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        """
        ReAct / 沙盒主链完成后：按页增强 image_prompt、配图、TTS 与终审；
        并回传与 run() 一致的风格关键词增强元数据。
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
            if run_recorder is not None:
                run_recorder.record(
                    "finalize_structured_input",
                    {
                        "style": style,
                        "normalized_style": normalized_style,
                        "title": title,
                        "story_text": story_text,
                        "visual_consistency": visual_consistency or {},
                        "scenes": [
                            {
                                "scene_no": s.scene_no,
                                "text": s.text,
                                "image_prompt": s.image_prompt,
                            }
                            for s in scenes
                        ],
                        "bundle_for_safety": bundle,
                    },
                )
            safe_bundle = await self._ensure_safe_text(bundle)
            if run_recorder is not None and safe_bundle != bundle:
                run_recorder.record("finalize_structured_safety_rewrite", {"safe_bundle": safe_bundle})
            try:
                data = json.loads(safe_bundle)
                title = str(data.get("title", title))
                story_text = str(data.get("story", story_text))
                raw_scenes = data.get("scenes") or []
                if isinstance(raw_scenes, list) and raw_scenes:
                    parsed: List[Scene] = []
                    for idx, item in enumerate(raw_scenes[:10], start=1):
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

            scenes, consistency_records = self._apply_visual_consistency_to_scenes(
                scenes,
                visual_consistency or {},
            )
            if run_recorder is not None:
                run_recorder.record(
                    "visual_consistency_enforcement",
                    {
                        "visual_consistency": visual_consistency or {},
                        "records": consistency_records,
                        "scenes_after_consistency": [
                            {
                                "scene_no": s.scene_no,
                                "text": s.text,
                                "image_prompt": s.image_prompt,
                            }
                            for s in scenes
                        ],
                    },
                )

            await self._emit_progress(
                on_progress,
                "image",
                "绘制插画场景",
                f"开始为 {len(scenes)} 个分镜生成配图",
                total=len(scenes),
            )
            scenes, image_prompt_enhancements = self._enhance_scene_image_prompts(
                scenes,
                style=normalized_style,
                enabled=enhancer_enabled,
            )
            enhancement = self._merge_image_prompt_enhancement(
                enhancement,
                image_prompt_enhancements,
            )
            if run_recorder is not None:
                run_recorder.record(
                    "scene_image_prompt_enhancement",
                    {
                        "enabled": enhancer_enabled,
                        "records": image_prompt_enhancements,
                        "scenes_after_enhancement": [
                            {
                                "scene_no": s.scene_no,
                                "text": s.text,
                                "image_prompt": s.image_prompt,
                            }
                            for s in scenes
                        ],
                    },
                )
            image_urls = await self._generate_images_with_retry(
                scenes=scenes,
                style=normalized_style,
                on_progress=on_progress,
                run_recorder=run_recorder,
            )
            await self._emit_progress(
                on_progress,
                "tts",
                "合成朗读音频",
                f"开始用 DashScope CosyVoice（{CONFIG.DASHSCOPE_TTS_MODEL} / {CONFIG.DASHSCOPE_TTS_VOICE}）为 {len(scenes)} 页旁白合成音频",
                total=len(scenes),
            )
            audio_urls = await self._synthesize_all_scenes(
                scenes=scenes,
                voice="亲切姐姐",
                on_progress=on_progress,
                run_recorder=run_recorder,
            )

            await self._emit_progress(
                on_progress,
                "review",
                "安全审阅与润色",
                "正在执行图文安全复核与价值观对齐",
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
                "image_prompt_enhancements": enhancement.get("image_prompt_enhancements", []),
                "style_keyword_model_used": enhancement["used_model"],
                "style_keyword_model_error": enhancement["model_error"],
                "visual_consistency": visual_consistency or {},
                "visual_consistency_records": consistency_records,
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
                "image_prompt_enhancements": enhancement.get("image_prompt_enhancements", []),
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
                "image_prompt_enhancements": enhancement.get("image_prompt_enhancements", []),
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
   - story: 完整故事连贯流畅（总字数 650-900 字），像一本真正的 8-10 页绘本，有清楚的起因、经过、转折和结尾。
   - scenes: 将故事拆分为 8-10 个连续画面场景，每个场景承接上一页并推进下一页，不要各写各的。
4) 场景字段要求 (scenes)：
   - scene_no: 场景序号 (1, 2, 3...)
   - text: 该画面的绘本旁白（中文，约 55-90 字）
   - image_prompt: 提交给 AI 生图模型的提示词【重要规范如下】：
     a. **必须完全使用英文 (English)** 输出。
     b. **不要带叙事动作**（如 "decided to", "felt happy"），只描述定格画面可见的内容。
     c. **画面结构**：[Main Subject & Appearance] + [Action/Pose] + [Environment/Background] + [Lighting/Atmosphere].
     d. **角色一致性**：在第一个场景为主角设定简短的英文视觉特征（如 "a 5-year-old Chinese boy wearing a red shirt and blue pants"），并在后续**每一个**场景的 image_prompt 中严格重复这段特征；重要配角和关键道具出现时也要复用固定特征，以保持角色长相、服饰、颜色和道具连贯。
     e. **风格适配**：基于当前的风格「{style}」，在英文中加入对应的高级修饰词，并避开冲突技法：
        - 水墨 (Ink wash): "traditional Chinese ink wash painting, minimalist, expressive brushstrokes, negative space", 避免 "3D, photorealistic, thick impasto".
        - 剪纸 (Paper cutting): "Chinese paper cutting art, layered flat paper, intricate cutout patterns, red and gold color palette", 避免 "realistic perspective, oil painting".
        - 皮影 (Shadow play): "Chinese shadow puppetry, silhouette against an illuminated screen, theatrical lighting, jointed flat figures", 避免 "realistic portraits, daylight".
        - 漫画 (Comic): "vibrant comic book style, clear line art, flat colors, expressive features", 避免 "ink wash, photorealism".
     f. **禁止画面文字**：每条 image_prompt 必须包含 "no text, no letters, no watermark, no logo"，避免画面出现英文标题、标牌字和水印。

输入素材：{keywords}
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
        for idx, item in enumerate(raw_scenes[:10], start=1):
            scenes.append(
                Scene(
                    scene_no=int(item.get("scene_no", idx)),
                    text=str(item.get("text") or item.get("text_zh") or ""),
                    image_prompt=str(item.get("image_prompt") or item.get("image_prompt_en") or ""),
                )
            )
        return title, story_text, scenes

    async def _generate_images_with_retry(
        self,
        scenes: Sequence[Scene],
        style: str,
        *,
        on_progress: ProgressReporter | None = None,
        run_recorder: Any | None = None,
    ) -> List[str]:
        async def _task(scene: Scene) -> str:
            image_prompt = _ensure_image_prompt_layout(scene.image_prompt)
            last_error: Exception | None = None
            for attempt in range(MAX_IMAGE_RETRY + 1):
                try:
                    if run_recorder is not None:
                        try:
                            from core.clients import build_gemini_image_prompt

                            full_prompt = build_gemini_image_prompt(image_prompt, style)
                        except Exception:
                            full_prompt = None
                        run_recorder.record(
                            "image_generation_request",
                            {
                                "scene_no": scene.scene_no,
                                "attempt": attempt + 1,
                                "style": style,
                                "scene_text": scene.text,
                                "image_prompt": image_prompt,
                                "gemini_full_prompt": full_prompt,
                            },
                        )
                    url = await self.image_client.generate_image(image_prompt, style)
                    if run_recorder is not None:
                        run_recorder.record(
                            "image_generation_response",
                            {
                                "scene_no": scene.scene_no,
                                "attempt": attempt + 1,
                                "image_url": url,
                            },
                        )
                    return url
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if run_recorder is not None:
                        run_recorder.record(
                            "image_generation_error",
                            {
                                "scene_no": scene.scene_no,
                                "attempt": attempt + 1,
                                "error": type(exc).__name__,
                                "detail": str(exc)[:1000],
                            },
                        )
                    if attempt < MAX_IMAGE_RETRY:
                        await asyncio.sleep(0.5 * (2**attempt))
                        continue
                    inner = str(last_error)[:500]
                    raise RuntimeError(
                        f"场景{scene.scene_no}图片生成失败（已重试{MAX_IMAGE_RETRY}次）：{inner}"
                    ) from last_error

            raise RuntimeError("图片生成异常终止")

        total = len(scenes)
        if total == 0:
            return []

        concurrency = max(1, min(CONFIG.IMAGE_GENERATION_CONCURRENCY, total))
        semaphore = asyncio.Semaphore(concurrency)
        completed = 0

        async def _run_one(idx: int, scene: Scene) -> tuple[int, str]:
            nonlocal completed
            async with semaphore:
                await self._emit_progress(
                    on_progress,
                    "image",
                    "绘制插画场景",
                    f"插图生成中（场景 {idx + 1}/{total}，并发 {concurrency}）",
                    current=idx + 1,
                    total=total,
                    concurrency=concurrency,
                )
                url = await _task(scene)
                completed += 1
                await self._emit_progress(
                    on_progress,
                    "image",
                    "绘制插画场景",
                    f"插图已完成（{completed}/{total}）",
                    current=completed,
                    total=total,
                    concurrency=concurrency,
                )
                return idx, url

        pairs = await asyncio.gather(
            *[_run_one(idx, scene) for idx, scene in enumerate(scenes)]
        )
        return [url for _, url in sorted(pairs, key=lambda item: item[0])]

    def _enhance_scene_image_prompts(
        self,
        scenes: Sequence[Scene],
        *,
        style: str,
        enabled: bool,
    ) -> tuple[List[Scene], list[dict[str, Any]]]:
        if not enabled:
            return list(scenes), []

        enhanced_scenes: List[Scene] = []
        records: list[dict[str, Any]] = []
        for scene in scenes:
            result = self.style_keyword_enhancer.enhance_image_prompt(
                scene.image_prompt,
                style,
                context=scene.text,
                enabled=True,
            )
            enhanced_scenes.append(
                Scene(
                    scene_no=scene.scene_no,
                    text=scene.text,
                    image_prompt=result.rewritten_prompt,
                )
            )
            records.append(
                {
                    "scene_no": scene.scene_no,
                    "style": result.normalized_style,
                    "selected_keywords": result.selected_keywords,
                    "selected_fragments": result.selected_fragments,
                    "original_image_prompt": result.original_prompt,
                    "enhanced_image_prompt": result.rewritten_prompt,
                    "used_model": result.used_model,
                    "model_error": result.model_error,
                }
            )
        return enhanced_scenes, records

    def _merge_image_prompt_enhancement(
        self,
        enhancement: Dict[str, Any],
        image_records: list[dict[str, Any]],
    ) -> Dict[str, Any]:
        if not image_records:
            return {**enhancement, "image_prompt_enhancements": enhancement.get("image_prompt_enhancements", [])}

        selected_keywords: list[str] = []
        seen: set[str] = set()
        for keyword in enhancement.get("selected_keywords", []):
            if keyword not in seen:
                selected_keywords.append(keyword)
                seen.add(keyword)
        for record in image_records:
            for keyword in record.get("selected_keywords", []):
                if keyword not in seen:
                    selected_keywords.append(keyword)
                    seen.add(keyword)

        used_model = bool(enhancement.get("used_model")) or any(
            bool(record.get("used_model")) for record in image_records
        )
        model_error = enhancement.get("model_error")
        if not model_error:
            model_error = next(
                (record.get("model_error") for record in image_records if record.get("model_error")),
                None,
            )
        return {
            **enhancement,
            "selected_keywords": selected_keywords,
            "used_model": used_model,
            "model_error": model_error,
            "image_prompt_enhancements": image_records,
        }

    def _apply_visual_consistency_to_scenes(
        self,
        scenes: Sequence[Scene],
        visual_consistency: Dict[str, Any],
    ) -> tuple[List[Scene], list[dict[str, Any]]]:
        characters = visual_consistency.get("characters") or []
        key_props = visual_consistency.get("key_props") or []
        setting_anchor = str(visual_consistency.get("setting_anchor_en") or "").strip()

        main_character_lines: list[str] = []
        support_character_lines: list[str] = []
        for item in characters:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            role = str(item.get("role") or "").strip()
            anchor = str(item.get("appearance_anchor_en") or "").strip()
            if not anchor:
                continue
            label = f"{name} ({role})" if name and role else name or role or "character"
            line = f"{label}: {anchor}"
            if "主角" in role or "protagonist" in role.lower() or "main" in role.lower():
                main_character_lines.append(line)
            else:
                support_character_lines.append(line)

        prop_lines: list[str] = []
        for item in key_props:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name_zh") or "").strip()
            anchor = str(item.get("anchor_en") or "").strip()
            if anchor:
                prop_lines.append(f"{name or 'prop'}: {anchor}")

        if not (main_character_lines or support_character_lines or prop_lines or setting_anchor):
            return list(scenes), []

        bible_parts = [
            "CONSISTENT VISUAL BIBLE FOR THE WHOLE BOOK:",
            "Do not create alternate versions of the same character, place, or prop.",
            "Keep age, species, outfit, hairstyle, colors, shapes, materials, and relative scale unchanged across pages.",
        ]
        if main_character_lines:
            bible_parts.append(
                "Main character anchors, use these exact visual descriptions whenever the protagonist appears: "
                + " | ".join(main_character_lines)
                + "."
            )
        if support_character_lines:
            bible_parts.append(
                "Supporting character anchors, use exact descriptions when visible: "
                + " | ".join(support_character_lines)
                + "."
            )
        if prop_lines:
            bible_parts.append(
                "Core prop anchors, use exact designs when visible: "
                + " | ".join(prop_lines)
                + "."
            )
        if setting_anchor:
            bible_parts.append(
                "Main setting continuity anchor, use when this page remains in the same place: "
                + setting_anchor
                + "."
            )
        bible_parts.append(
            "Do not add logos, emblems, symbols, brand marks, readable letters, captions, "
            "signs, watermarks, or decorative marks on laptop lids. Do not introduce "
            "prominent extra props unless they are named in the page-specific scene."
        )
        bible = " ".join(bible_parts)

        enhanced: list[Scene] = []
        records: list[dict[str, Any]] = []
        for scene in scenes:
            original = scene.image_prompt
            if "CONSISTENT VISUAL BIBLE FOR THE WHOLE BOOK" in original:
                rewritten = original
            else:
                rewritten = f"{bible} PAGE-SPECIFIC SCENE: {original}".strip()
            enhanced.append(
                Scene(
                    scene_no=scene.scene_no,
                    text=scene.text,
                    image_prompt=rewritten,
                )
            )
            records.append(
                {
                    "scene_no": scene.scene_no,
                    "original_image_prompt": original,
                    "consistent_image_prompt": rewritten,
                    "main_character_anchor_count": len(main_character_lines),
                    "support_character_anchor_count": len(support_character_lines),
                    "prop_anchor_count": len(prop_lines),
                    "has_setting_anchor": bool(setting_anchor),
                }
            )
        return enhanced, records

    async def _synthesize_all_scenes(
        self,
        scenes: Sequence[Scene],
        voice: str,
        *,
        on_progress: ProgressReporter | None = None,
        run_recorder: Any | None = None,
    ) -> List[str]:
        semaphore = asyncio.Semaphore(CONFIG.TTS_SYNTHESIS_CONCURRENCY)

        async def _run_one(idx: int, scene: Scene) -> tuple[int, str]:
            async with semaphore:
                if idx > 0:
                    await asyncio.sleep(0.25)
                await self._emit_progress(
                    on_progress,
                    "tts",
                    "合成朗读音频",
                    f"CosyVoice 语音合成中（{idx + 1}/{len(scenes)}）",
                    current=idx + 1,
                    total=len(scenes),
                )
                if run_recorder is not None:
                    run_recorder.record(
                        "tts_request",
                        {
                            "scene_no": scene.scene_no,
                            "voice": voice,
                            "text": scene.text,
                        },
                    )
                audio = await self.tts_client.synthesize(scene.text, voice)
                if run_recorder is not None:
                    run_recorder.record(
                        "tts_response",
                        {
                            "scene_no": scene.scene_no,
                            "voice": voice,
                            "audio_url": audio,
                        },
                    )
                return idx, audio

        pairs = await asyncio.gather(
            *[_run_one(idx, scene) for idx, scene in enumerate(scenes)]
        )
        return [url for _, url in sorted(pairs, key=lambda item: item[0])]

    async def _emit_progress(
        self,
        reporter: ProgressReporter | None,
        stage_id: str,
        title: str,
        detail: str,
        **meta: Any,
    ) -> None:
        if reporter is None:
            return
        stage: dict[str, Any] = {"id": stage_id, "title": title, "detail": detail}
        if meta:
            stage["meta"] = meta
        await reporter(stage)

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
    """装配：OpenAI兼容/Qwen 文本 + Gemini 配图 + 本地安全检查 + DashScope CosyVoice。"""
    missing: list[str] = []
    if not CONFIG.DASHSCOPE_API_KEY:
        missing.append("DASHSCOPE_API_KEY（草图 VL / ASR / CosyVoice TTS）")
    use_openai_text = bool(CONFIG.OPENAI_API_KEY and CONFIG.OPENAI_BASE_URL and CONFIG.OPENAI_MODEL)
    if not use_openai_text and not CONFIG.DASHSCOPE_API_KEY:
        missing.append("OPENAI_API_KEY + OPENAI_BASE_URL + OPENAI_MODEL（或 DASHSCOPE_API_KEY，用于叙事文本）")
    if not (CONFIG.GOOGLE_API_KEY or CONFIG.GEMINI_OPENAI_API_KEY):
        missing.append("GOOGLE_API_KEY（或 GEMINI_OPENAI_API_KEY，用于 Gemini 配图）")
    if missing:
        raise RuntimeError(
            "请配置：" + "、".join(missing) + "。"
            "叙事优先走 OPENAI_* 兼容文本模型，配图全部走 Gemini。"
        )

    from core.clients import (
        DashScopeQwenClient,
        DashScopeCosyVoiceTtsClient,
        GeminiImageClient,
        LocalSafetyClient,
        OpenAITextClient,
    )

    return StorybookPipeline(
        llm_client=OpenAITextClient() if use_openai_text else DashScopeQwenClient(),
        image_client=GeminiImageClient(),
        tts_client=DashScopeCosyVoiceTtsClient(),
        safety_client=LocalSafetyClient(),
    )


class LangChainQwenClient:
    """可选：将 LangChain ChatModel 接入 LLMClient 协议。"""

    def __init__(self, chat_model: Any) -> None:
        self.chat_model = chat_model

    async def generate(self, prompt: str) -> str:
        msg = await self.chat_model.ainvoke(prompt)
        return getattr(msg, "content", str(msg))
