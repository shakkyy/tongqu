"""
Agent 工具层：原 tool_schemas.py 与 tool_handlers.py 合并（Pydantic 模型 + 工具实现）。
"""

from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# sketch_understanding_tool
# ---------------------------------------------------------------------------
class SketchUnderstandingArgs(BaseModel):
    base_keywords: str = Field(..., min_length=1)
    sketch_image_base64: str | None = None
    sketch_text: str | None = None


class SketchUnderstandingResult(BaseModel):
    merged_story_material: str = Field(
        ...,
        description="合并后的故事素材（与 SketchContextResult.merged_keywords 语义一致）",
    )
    visual_semantics: str | None = Field(
        None,
        description="VL 画面语义；无图或未启用 VL 时为 null",
    )
    vl_used: bool = False


# ---------------------------------------------------------------------------
# story_planning_tool
# ---------------------------------------------------------------------------
class CharacterScriptEntry(BaseModel):
    role: str = Field(..., description="主角 / 配角 / 动物朋友 等")
    name: str
    appearance_anchor_en: str = Field(
        ...,
        description="英文视觉锚点，后续每个 image_prompt 必须复用",
    )
    traits_zh: str = Field(..., description="性格与口吻（中文，短）")


class StoryPlanningArgs(BaseModel):
    core_keywords: str = Field(..., min_length=1, description="已过滤的安全素材")
    visual_semantics: str | None = Field(
        None,
        description="来自草图理解；无草图可为空",
    )
    style: str = Field(
        ...,
        description="paper-cut | ink-wash | shadow-puppet | comic",
    )


class StoryPlanningResult(BaseModel):
    title_zh: str
    outline_zh: str = Field(..., description="分幕式大纲，供分镜工具切分参考")
    character_script: list[CharacterScriptEntry] = Field(
        ...,
        min_length=1,
        description="至少一名角色，含英文视觉锚点",
    )
    positive_values: list[str] = Field(
        ...,
        min_length=1,
        description="本故事要体现的正向价值观",
    )
    story_body_zh: str = Field(
        ...,
        description="150–250 字完整故事正文",
    )


# ---------------------------------------------------------------------------
# storyboard_generation_tool
# ---------------------------------------------------------------------------
class StoryboardSceneSpec(BaseModel):
    scene_no: int = Field(..., ge=1)
    text_zh: str = Field(..., description="该页旁白（中文）")
    image_prompt_en: str = Field(..., description="纯英文生图提示词")


class StoryboardGenerationArgs(BaseModel):
    outline_zh: str
    character_script: list[CharacterScriptEntry]
    style: str
    story_body_zh: str = Field(..., min_length=1)


class StoryboardGenerationResult(BaseModel):
    scenes: list[StoryboardSceneSpec] = Field(..., min_length=3, max_length=4)


# ---------------------------------------------------------------------------
# ReAct 轨迹（仅内存使用，不写入 API 响应）
# ---------------------------------------------------------------------------
class ReActStep(BaseModel):
    phase: str = Field(..., description="thought | action | observation | final")
    content: str | None = None
    tool_name: str | None = None
    tool_ok: bool | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


from services.sketch_service import SketchUnderstandingService
from services.story_pipeline import StorybookPipeline


def _strip_json_fence(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\s*```\s*$", "", t)
    return t.strip()


def parse_llm_json_object(raw: str) -> dict[str, Any]:
    """从模型输出中提取单个 JSON object。"""
    cleaned = _strip_json_fence(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            return json.loads(cleaned[start : end + 1])
        raise


def _style_prompt_fragment(style_cn: str) -> str:
    return f"当前绘本视觉风格为「{style_cn}」。分镜的英文 image_prompt 必须包含与该风格一致的高级修饰词，并避免相冲突的技法（与系统提示中的风格表一致）。"


def build_story_planning_prompt(
    args: StoryPlanningArgs,
    *,
    correction_hint: str | None,
    system_safe_block: str,
    style_cn: str,
) -> str:
    hint = ""
    if correction_hint:
        hint = f"\n\n【上次输出未通过校验，请严格修正】\n{correction_hint}\n"

    vs = (args.visual_semantics or "").strip()
    vs_block = f"【视觉语义（来自草图理解，可能为空）】\n{vs}\n" if vs else "【视觉语义】无（非草图创作）。\n"

    return f"""
{system_safe_block}

你是儿童绘本主理人中的「故事策划」角色。只输出一个 JSON 对象，不要 Markdown、不要解释。

输出字段与要求：
1) title_zh: 故事标题（中文），简短有童趣。
2) outline_zh: 分幕式故事大纲（中文），覆盖起承转合，便于后续切成 3-4 页。
3) character_script: 数组，至少 1 条。每项含：
   - role: 角色定位（如 主角 / 配角）
   - name: 角色名（中文）
   - appearance_anchor_en: **英文**固定外观描述（如年龄、服饰颜色、发型），供生图复用
   - traits_zh: 性格特点（中文，短）
4) positive_values: 字符串数组，列出本故事要体现的正向价值观（如 勇敢、友谊、合作）。
5) story_body_zh: **完整故事正文**（中文），**150–250 个汉字**，与 outline_zh 一致、叙事连贯有结局。

{vs_block}
【核心素材（已做安全过滤）】
{args.core_keywords}

【绘画风格 slug】{args.style}
{_style_prompt_fragment(style_cn)}
{hint}
""".strip()


def build_storyboard_prompt(
    args: StoryboardGenerationArgs,
    *,
    correction_hint: str | None,
    system_safe_block: str,
    style_cn: str,
) -> str:
    hint = ""
    if correction_hint:
        hint = f"\n\n【上次输出未通过校验，请严格修正】\n{correction_hint}\n"

    chars = json.dumps(
        [c.model_dump() for c in args.character_script],
        ensure_ascii=False,
    )

    return f"""
{system_safe_block}

你是儿童绘本主理人中的「分镜导演」角色。只输出一个 JSON 对象，不要 Markdown、不要解释。

任务：将给定故事正文 **切分为 3-4 个分镜**，每镜一段旁白；并为每镜写 **纯英文** 的 image_prompt。

硬性规则：
1) scenes 数组长度必须为 3 或 4。
2) 每个 scene：
   - scene_no: 从 1 递增
   - text_zh: 该页中文旁白（约 30-50 字），全部来自或紧密改编自 story_body_zh，四镜合起来覆盖完整故事。
   - image_prompt_en: **必须全英文**；**不要叙事动作**（禁止 decided to / felt 等），只描述定格画面可见内容。
   - 结构建议：[Main Subject & Appearance] + [Action/Pose] + [Environment] + [Lighting/Atmosphere]
   - **角色一致性**：将 character_script 中每条 appearance_anchor_en **原样嵌入**每个场景的 image_prompt_en（可微调语序但特征词保持一致）。
3) 风格：{style_cn}；在英文 prompt 中加入与该风格匹配的修饰词（参考系统提示中的风格表）。

【大纲参考】
{args.outline_zh}

【人物脚本 JSON】
{chars}

【完整故事正文（切分依据）】
{args.story_body_zh}
{hint}
""".strip()


def _normalize_style_slug_to_cn(style: str) -> str:
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


class TongquToolHandlers:
    """三个创造性工具的底层实现。"""

    def __init__(
        self,
        sketch_service: SketchUnderstandingService,
        story_pipeline: StorybookPipeline,
    ) -> None:
        self._sketch = sketch_service
        self._pipeline = story_pipeline

    async def sketch_understanding_tool(
        self,
        args: SketchUnderstandingArgs,
    ) -> SketchUnderstandingResult:
        ctx = await self._sketch.build_keywords(
            base_keywords=args.base_keywords,
            sketch_image_base64=args.sketch_image_base64,
            sketch_text=args.sketch_text,
        )
        return SketchUnderstandingResult(
            merged_story_material=ctx.merged_keywords,
            visual_semantics=ctx.vl_understanding,
            vl_used=ctx.vl_used,
        )

    async def story_planning_tool(
        self,
        args: StoryPlanningArgs,
        *,
        correction_hint: str | None = None,
    ) -> StoryPlanningResult:
        style_cn = _normalize_style_slug_to_cn(args.style)
        system_safe = self._pipeline.safety_middleware.build_safe_system_prompt(style=style_cn)
        prompt = build_story_planning_prompt(
            args,
            correction_hint=correction_hint,
            system_safe_block=system_safe,
            style_cn=style_cn,
        )
        raw = await self._pipeline.llm_client.generate(prompt)
        data = parse_llm_json_object(raw)
        return StoryPlanningResult.model_validate(data)

    async def storyboard_generation_tool(
        self,
        args: StoryboardGenerationArgs,
        *,
        correction_hint: str | None = None,
    ) -> StoryboardGenerationResult:
        style_cn = _normalize_style_slug_to_cn(args.style)
        system_safe = self._pipeline.safety_middleware.build_safe_system_prompt(style=style_cn)
        prompt = build_storyboard_prompt(
            args,
            correction_hint=correction_hint,
            system_safe_block=system_safe,
            style_cn=style_cn,
        )
        raw = await self._pipeline.llm_client.generate(prompt)
        data = parse_llm_json_object(raw)
        return StoryboardGenerationResult.model_validate(data)
