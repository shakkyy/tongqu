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


class VisualAnchorEntry(BaseModel):
    name_zh: str = Field(..., description="核心物品或场景元素中文名")
    anchor_en: str = Field(..., description="稳定复用的英文视觉锚点")
    appears_in_scenes: list[int] = Field(
        default_factory=list,
        description="建议出现或需要保持一致的页码；为空表示出现时保持一致",
    )


class StoryPlanningArgs(BaseModel):
    core_keywords: str = Field(..., min_length=1, description="已过滤的安全素材")
    visual_semantics: str | None = Field(
        None,
        description="来自草图理解；无草图可为空",
    )
    culture_context: str | None = Field(
        None,
        description="文化 RAG 检索后用于故事策划的短上下文；无命中可为空",
    )
    style: str = Field(
        ...,
        description="paper-cut | ink-wash | shadow-puppet | comic",
    )


class StoryboardSceneSpec(BaseModel):
    scene_no: int = Field(..., ge=1)
    text_zh: str = Field(..., description="该页旁白（中文）")
    image_prompt_en: str = Field(..., description="纯英文生图提示词")


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
        description="650–900 字完整故事正文，适合切成 8-10 页绘本",
    )
    scenes: list[StoryboardSceneSpec] = Field(
        ...,
        min_length=8,
        max_length=10,
        description="8-10 个连续绘本页面，含中文旁白与英文生图提示词",
    )
    key_props: list[VisualAnchorEntry] = Field(
        default_factory=list,
        description="核心道具/物品的英文视觉锚点，供全书生图复用",
    )
    setting_anchor_en: str = Field(
        default="",
        description="主场景/空间关系的英文视觉锚点，供跨页保持一致",
    )


class StoryboardGenerationArgs(BaseModel):
    outline_zh: str
    character_script: list[CharacterScriptEntry]
    style: str
    story_body_zh: str = Field(..., min_length=1)


class StoryboardGenerationResult(BaseModel):
    scenes: list[StoryboardSceneSpec] = Field(..., min_length=8, max_length=10)


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


def _coerce_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(
                    "：".join(str(v) for v in item.values() if v is not None)
                )
            elif item is not None:
                parts.append(str(item))
        return "\n".join(part.strip() for part in parts if part and part.strip())
    if isinstance(value, dict):
        return "\n".join(
            f"{k}：{v}" for k, v in value.items() if v is not None
        )
    return "" if value is None else str(value)


def normalize_story_planning_payload(data: dict[str, Any]) -> dict[str, Any]:
    """容错模型 JSON：大纲/正文偶尔会返回数组或对象，这里收敛成 schema 需要的字符串。"""
    out = dict(data)
    out["outline_zh"] = _coerce_text(out.get("outline_zh"))
    out["story_body_zh"] = _coerce_text(out.get("story_body_zh"))
    if not isinstance(out.get("key_props"), list):
        out["key_props"] = []
    if not isinstance(out.get("setting_anchor_en"), str):
        out["setting_anchor_en"] = _coerce_text(out.get("setting_anchor_en"))
    return out


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
    culture = (args.culture_context or "").strip()
    culture_block = (
        f"""
【文化发掘参考】
{culture}

使用规则：
1. 如果文化参考为空或匹配度低，可以不强行使用。
2. 如果文化参考可用，请只吸收其中的核心思想、儿童友好寓意、文化意象和视觉元素。
3. 禁止照搬原始故事情节、原文表达、具体人物关系；对 avoid_direct_copy 中的内容必须规避。
4. 故事必须仍然围绕用户输入展开，文化元素是“灵感来源”，不是替代用户创意。
5. 输出中 positive_values 需要体现文化参考带来的价值观。
6. outline_zh 和 story_body_zh 中要自然体现文化元素，但不要写成百科介绍。
""".strip()
        if culture
        else "【文化发掘参考】无高相关命中，本次不强行注入传统文化素材。"
    )

    return f"""
{system_safe_block}

你是儿童绘本主理人中的「故事策划」角色。只输出一个 JSON 对象，不要 Markdown、不要解释。

输出字段与要求：
1) title_zh: 故事标题（中文），简短有童趣。
2) outline_zh: 分页式故事大纲（中文），必须包含 8-10 个连续故事节拍，便于后续切成 8-10 页。
3) character_script: 数组，至少 1 条。每项含：
   - role: 角色定位（如 主角 / 配角）
   - name: 角色名（中文）
   - appearance_anchor_en: **英文**固定外观描述（如年龄、服饰颜色、发型），供生图复用
   - traits_zh: 性格特点（中文，短）
4) key_props: 数组，列出全书必须保持一致的核心道具/物品。每项含：
   - name_zh: 道具/物品中文名
   - anchor_en: **英文**固定视觉锚点（颜色、形状、材质、尺寸、独特细节），后续相关 image_prompt_en 必须复用
   - appears_in_scenes: 页码数组；不确定可为空
5) setting_anchor_en: **英文**主场景/空间关系锚点，如主场景的布局、光线、背景元素；无固定场景可为空字符串。
6) positive_values: 字符串数组，列出本故事要体现的正向价值观（如 勇敢、友谊、合作）。
7) story_body_zh: **完整故事正文**（中文），**650–900 个汉字**，与 outline_zh 一致、叙事连贯有结局。
8) scenes: 数组，**8-10 条**，直接完成分镜拆页。每项含：
   - scene_no: 从 1 递增
   - text_zh: 该页中文旁白（约 55-90 字），所有页面要串成一个连续的故事，不能各写各的
   - image_prompt_en: **纯英文**生图提示词，只描述画面可见内容；必须包含 "no text, no letters, no watermark, no logo"

语言要求：
- 必须像 4-10 岁儿童绘本，句子短、意思直接、画面清楚。
- 故事要像一本真正的 8-10 页绘本：每一页推进一个小动作或小发现，前后因果清楚，不要把几个互不相干的片段拼在一起。
- 主角、重要配角和关键道具要稳定出现；不要一会儿换设定、一会儿换目标。
- 如果「视觉语义」来自孩子草图，其中的具体可见物体、角色、动作和空间关系是内容锚点，不只是风格灵感。除非不安全或与核心素材明显冲突，否则必须自然进入故事起点，并在相关 scenes 的 image_prompt_en 中用普通英文物体词保留；不要把“笔记本电脑/苹果电脑/房子/河/船”等具体物体只改写成“科技/想象/节日”等抽象主题。
- 如果草图里有品牌标识、logo 或文字，只保留它代表的普通物体语义；image_prompt_en 仍必须遵守 no text, no letters, no watermark, no logo。
- 每页可承载 55-90 字旁白，因此正文要有足够细节：动作、场景、对话、情绪变化都要具体。
- scenes 必须从 story_body_zh 中自然切分，不要新增与正文矛盾的情节。
- image_prompt_en 必须保持角色一致：主角每页复用同一段 appearance_anchor_en；重要配角出现时也复用固定特征。
- image_prompt_en 必须保持核心道具一致：凡是 key_props 中的物品在某页出现，必须原样嵌入对应 anchor_en，不要换颜色、形状、材质、大小或装饰。
- image_prompt_en 要体现页面连续性：同一地点、同一道具、同一角色不要突然改变外观；如仍在主场景中，应复用 setting_anchor_en。
- image_prompt_en 必须把关键主体放在安全中心区域，避免边缘裁切；不要在 prompt 里写图像比例，比例由生图 API 配置控制。
- 少用成语、古风词和成人文学化表达；避免“月华、窗棂、笑靥、刹那、银辉”等孩子不易理解的词。
- 每个关键情节要让孩子能明白：谁在做什么、为什么做、结果怎样。
- 温暖但不要晦涩，不要把故事写成散文诗。

{vs_block}
{culture_block}

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

任务：将给定故事正文 **切分为 8-10 个连续绘本页面**，每页一段旁白；并为每页写 **纯英文** 的 image_prompt。

硬性规则：
1) scenes 数组长度必须为 8 到 10。
2) 每个 scene：
   - scene_no: 从 1 递增
   - text_zh: 该页中文旁白（约 55-90 字），全部来自或紧密改编自 story_body_zh，所有页面合起来覆盖完整故事；每一页都要承接上一页、推进下一页，不能各写各的；语言必须简单直白，适合孩子朗读，避免“月华、窗棂、笑靥、刹那、银辉”等生僻或成人文学化词语。
   - image_prompt_en: **必须全英文**；**不要叙事动作**（禁止 decided to / felt 等），只描述定格画面可见内容。
   - 结构建议：[Main Subject & Appearance] + [Action/Pose] + [Environment] + [Lighting/Atmosphere]
   - **角色一致性**：将 character_script 中每条 appearance_anchor_en **原样嵌入**每个相关场景的 image_prompt_en（主角每页必须出现并复用原锚点；重要配角出现时也复用原锚点）。不要改变主角的颜色、服饰、年龄、发型、物种或关键道具。
   - **连续性**：image_prompt_en 要保留上一页留下的重要物件和空间关系，例如同一只灯笼、同一封信、同一条河岸；不要突然换成无关场景。
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
        self._run_recorder: Any | None = None

    def set_run_recorder(self, recorder: Any | None) -> None:
        self._run_recorder = recorder

    def _record(self, stage: str, payload: Any) -> None:
        if self._run_recorder is not None:
            self._run_recorder.record(stage, payload)

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
        self._record(
            "story_planning_llm_request",
            {
                "args": args.model_dump(),
                "correction_hint": correction_hint,
                "style_cn": style_cn,
                "prompt": prompt,
            },
        )
        raw = await self._pipeline.llm_client.generate(prompt)
        self._record("story_planning_llm_response", {"raw": raw})
        data = parse_llm_json_object(raw)
        data = normalize_story_planning_payload(data)
        self._record("story_planning_parsed", data)
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
        self._record(
            "storyboard_llm_request",
            {
                "args": args.model_dump(),
                "correction_hint": correction_hint,
                "style_cn": style_cn,
                "prompt": prompt,
            },
        )
        raw = await self._pipeline.llm_client.generate(prompt)
        self._record("storyboard_llm_response", {"raw": raw})
        data = parse_llm_json_object(raw)
        self._record("storyboard_parsed", data)
        return StoryboardGenerationResult.model_validate(data)
