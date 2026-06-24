"""
草图理解模块：Qwen-VL Plus 读图，与「孩子说的话」合并进故事素材文本。

下游统一交给 StorybookPipeline（Qwen Plus 叙事 + Gemini 配图）。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Optional

from core.models import SketchVisionClient


@dataclass(frozen=True)
class SketchContextResult:
    """合并后的关键词素材 + VL 元信息。"""

    merged_keywords: str
    vl_used: bool
    vl_understanding: str | None
    image_kind: str = "sketch"
    image_safety_passed: bool | None = None


def _extract_json_object(raw: str) -> dict[str, Any] | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE)
    if fenced:
        try:
            parsed = json.loads(fenced.group(1))
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def _format_family_photo_understanding(raw: str) -> tuple[str, bool]:
    data = _extract_json_object(raw)
    if data is None:
        raise RuntimeError("亲子视觉参考安全审核返回无法解析，请重新上传清晰、无遮挡的图片。")
    safe = data.get("safe")
    if safe is not True:
        reason = str(data.get("risk_reason") or "图片未通过儿童安全审核").strip()
        raise RuntimeError(f"亲子视觉参考未通过安全审核：{reason}")

    summary = str(data.get("family_summary_zh") or "").strip()
    seed = str(data.get("story_seed_zh") or "").strip()
    anchors_raw = data.get("character_anchors_en")
    anchors: list[str] = []
    if isinstance(anchors_raw, list):
        anchors = [str(item).strip() for item in anchors_raw if str(item).strip()]
    if not summary:
        raise RuntimeError("亲子视觉参考安全审核缺少图片理解摘要，请重新上传更清晰的图片。")

    parts = [
        "亲子视觉参考安全审核：通过。",
        f"图片理解：{summary}",
        "角色改写原则：只保留非敏感的亲子关系、服装色彩、发型轮廓和互动氛围；不要复刻真实人脸，不要暴露照片背景隐私。",
    ]
    if anchors:
        parts.append("角色视觉锚点（英文，供后续保持一致）：\n" + "\n".join(f"- {item}" for item in anchors))
    if seed:
        parts.append(f"亲子共创建议：{seed}")
    return "\n".join(parts), True


class SketchUnderstandingService:
    def __init__(self, vl_client: SketchVisionClient | None) -> None:
        self._vl = vl_client

    async def build_keywords(
        self,
        base_keywords: str,
        sketch_image_base64: str | None,
        sketch_text: str | None,
        image_kind: str = "sketch",
    ) -> SketchContextResult:
        """
        与历史行为一致：先拼文字补充，再（若有图）走 VL，把理解追加进素材。
        image_kind="family_photo" 时，VL 必须先完成亲子视觉参考安全审核。
        """
        merged = (base_keywords or "").strip()
        vl_used = False
        understanding: str | None = None
        image_safety_passed: bool | None = None

        st = (sketch_text or "").strip()
        if st:
            label = "亲子共创补充" if image_kind == "family_photo" else "孩子说的话"
            merged = f"{merged}\n\n【{label}】{st}".strip()

        img = (sketch_image_base64 or "").strip()
        if img and self._vl is not None:
            if image_kind == "family_photo" and hasattr(self._vl, "describe_family_photo"):
                raw = await self._vl.describe_family_photo(img)  # type: ignore[attr-defined]
                understanding, image_safety_passed = _format_family_photo_understanding(raw)
            else:
                raw = await self._vl.describe_sketch(img)
                understanding = (raw or "").strip() or None
            vl_used = True
            if understanding:
                label = "亲子视觉参考理解" if image_kind == "family_photo" else "孩子草图理解"
                merged = f"{merged}\n\n【{label}】{understanding}".strip()

        return SketchContextResult(
            merged_keywords=merged,
            vl_used=vl_used,
            vl_understanding=understanding,
            image_kind=image_kind,
            image_safety_passed=image_safety_passed,
        )
