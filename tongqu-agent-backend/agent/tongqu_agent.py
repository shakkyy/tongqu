"""
童趣绘梦中枢 Agent：按创作来源整合各模块，再统一调用成书流水线。

- 语音：仅在前端由 services.asr_realtime 完成识别；此处接收已转写文本 + creation_source=voice。
- 选词：前端拼好 keywords + creation_source=keywords。
- 草图：services.sketch_understanding（Qwen-VL Plus）合并图像理解 → Qwen Plus 叙事 → Gemini 配图。
"""

from __future__ import annotations

from typing import Any, Dict

from agent.models import CreationSource
from services.sketch_understanding import SketchUnderstandingService
from services.story_pipeline import StorybookPipeline


class TongquAgent:
    def __init__(
        self,
        story_pipeline: StorybookPipeline,
        sketch_service: SketchUnderstandingService,
    ) -> None:
        self._story = story_pipeline
        self._sketch = sketch_service

    async def run(
        self,
        *,
        keywords: str,
        style: str,
        sketch_image_base64: str | None = None,
        sketch_text: str | None = None,
        creation_source: CreationSource | str | None = None,
        enable_style_keyword_enhancer: bool | None = None,
    ) -> Dict[str, Any]:
        """
        统一入口。草图模式下会先走 VL 再交给 Qwen Plus；语音/选词仅传 keywords 即可。
        """
        src = (
            creation_source
            if isinstance(creation_source, CreationSource)
            else CreationSource.from_optional(creation_source)
        )

        sketch_ctx = await self._sketch.build_keywords(
            base_keywords=keywords,
            sketch_image_base64=sketch_image_base64,
            sketch_text=sketch_text,
        )

        result = await self._story.run(
            sketch_ctx.merged_keywords,
            style,
            enable_style_keyword_enhancer=enable_style_keyword_enhancer,
        )
        result["creation_source"] = src.value
        result["sketch_vl_used"] = sketch_ctx.vl_used
        result["sketch_understanding"] = sketch_ctx.vl_understanding
        return result


def build_default_tongqu_agent() -> TongquAgent:
    """装配默认生产环境：草图 VL + 成书流水线（依赖检查在 build_default_story_pipeline）。"""
    from real_clients import DashScopeQwenVLClient
    from services.story_pipeline import build_default_story_pipeline

    pipeline = build_default_story_pipeline()
    sketch = SketchUnderstandingService(DashScopeQwenVLClient())
    return TongquAgent(story_pipeline=pipeline, sketch_service=sketch)
