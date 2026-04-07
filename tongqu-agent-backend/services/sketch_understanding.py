"""
草图理解模块：Qwen-VL Plus 读图，与「孩子说的话」合并进故事素材文本。

下游统一交给 StorybookPipeline（Qwen Plus 叙事 + Gemini 配图）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from services.protocols import SketchVisionClient


@dataclass(frozen=True)
class SketchContextResult:
    """合并后的关键词素材 + VL 元信息。"""

    merged_keywords: str
    vl_used: bool
    vl_understanding: str | None


class SketchUnderstandingService:
    def __init__(self, vl_client: SketchVisionClient | None) -> None:
        self._vl = vl_client

    async def build_keywords(
        self,
        base_keywords: str,
        sketch_image_base64: str | None,
        sketch_text: str | None,
    ) -> SketchContextResult:
        """
        与历史行为一致：先拼孩子口述，再（若有图）走 VL，把理解追加进素材。
        """
        merged = (base_keywords or "").strip()
        vl_used = False
        understanding: str | None = None

        st = (sketch_text or "").strip()
        if st:
            merged = f"{merged}\n\n【孩子说的话】{st}".strip()

        img = (sketch_image_base64 or "").strip()
        if img and self._vl is not None:
            raw = await self._vl.describe_sketch(img)
            understanding = (raw or "").strip() or None
            vl_used = True
            if understanding:
                merged = f"{merged}\n\n【孩子草图理解】{understanding}".strip()

        return SketchContextResult(
            merged_keywords=merged,
            vl_used=vl_used,
            vl_understanding=understanding,
        )
