"""
童趣绘梦中枢 Agent：沙盒式 ReAct（Sandboxed ReAct + Function Calling）

- 前置：filter_input；可选「风格关键词增强」（与 StorybookPipeline.run 逻辑对齐），再进入主循环。
- 核心：while 循环 + Qwen OpenAI 兼容 tools，由模型自主编排工具调用。
- 后置：StorybookPipeline.finalize_from_structured（保留同伴的 style_keyword 元数据回传）。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from agent.tools import (
    CharacterScriptEntry,
    StoryPlanningArgs,
    StoryboardGenerationArgs,
    TongquToolHandlers,
)
from config import CONFIG
from core.clients import ApiKeyError
from core.models import CreationSource, Scene
from services.sketch_service import SketchUnderstandingService
from services.story_pipeline import StorybookPipeline

MAX_REACT_TURNS = 8

_REACT_SYSTEM_PROMPT = """你是「童趣绘梦」的儿童绘本主理人，负责把用户素材变成可配图、可朗读的分镜内容。

你必须使用提供的工具（Function Calling）完成工作，不要只在对话里讲故事而不调用工具。

**标准作业流程（SOP）——须严格遵守：**
1. 若工作区标明「用户带有草图图片」，必须先调用 `analyze_sketch` 获取画面语义；若无草图，可跳过此步。
2. 调用 `draft_story`：结合工作区中的「用于写故事的核心素材 safe_keywords」与（若有）视觉语义，生成标题、大纲、人物脚本、价值观与完整故事正文（150–250 字）。
3. 调用 `review_safety`：对故事正文做自我审查（BERT 位点）。若结果不安全或高风险，**不要**继续分镜，应再次调用 `draft_story` 改写后再调用 `review_safety`。
4. 仅在审查通过后，调用 `generate_storyboard`：将故事切分为 3～4 个分镜，每镜含中文旁白与**纯英文** image_prompt，并保持角色视觉锚点一致。
5. 当你确认分镜合理且已通过安全审查时，调用 `finish_creation` 传入 `title`、`story_body_zh` 与 `scenes` 列表以**结束**整个创作流程。

**重要约束：**
- 面向 3～10 岁儿童，积极正向；不得输出违法、暴力、色情、恐怖或歧视内容。
- 最终必须由 `finish_creation` 收尾；不要在没有调用 `finish_creation` 的情况下声称工作已完成。
- 若某工具返回含 error 字段的 JSON，请阅读说明并修正参数或重试。
"""


def _build_react_tools() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "analyze_sketch",
                "description": "当用户上传了草图图片时调用：走 VL 理解画面并返回中文语义；无图时不应声称有图。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "has_sketch_image": {
                            "type": "boolean",
                            "description": "工作区若提供草图图片则为 true，否则 false。",
                        }
                    },
                    "required": ["has_sketch_image"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "draft_story",
                "description": "根据安全过滤后的关键词与（可选）草图视觉语义，生成完整故事策划 JSON（含 title_zh、outline_zh、character_script、positive_values、story_body_zh）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "core_keywords": {
                            "type": "string",
                            "description": "应使用工作区提供的 safe_keywords（可能已含风格关键词增强）。",
                        },
                        "visual_semantics": {
                            "type": ["string", "null"],
                            "description": "来自 analyze_sketch；无草图时为 null。",
                        },
                        "style": {
                            "type": "string",
                            "description": "与工作区 style_slug 一致，如 ink-wash。",
                        },
                    },
                    "required": ["core_keywords", "style"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "review_safety",
                "description": "对故事正文调用 BERT 位点式安全评估，判断是否应重写故事。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "story_body_zh": {"type": "string", "description": "完整故事正文（中文）。"}
                    },
                    "required": ["story_body_zh"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "generate_storyboard",
                "description": "在故事与安全审查通过后，将故事拆成 3-4 个分镜（中文旁白 + 纯英文 image_prompt）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "outline_zh": {"type": "string"},
                        "character_script": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "role": {"type": "string"},
                                    "name": {"type": "string"},
                                    "appearance_anchor_en": {"type": "string"},
                                    "traits_zh": {"type": "string"},
                                },
                                "required": [
                                    "role",
                                    "name",
                                    "appearance_anchor_en",
                                    "traits_zh",
                                ],
                            },
                        },
                        "story_body_zh": {"type": "string"},
                        "style": {"type": "string"},
                    },
                    "required": [
                        "outline_zh",
                        "character_script",
                        "story_body_zh",
                        "style",
                    ],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "finish_creation",
                "description": "当分镜已就绪且安全审查已通过时调用，提交最终结构化结果以结束主循环。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "故事标题（中文）。"},
                        "story_body_zh": {"type": "string", "description": "与分镜一致的故事全文。"},
                        "scenes": {
                            "type": "array",
                            "minItems": 3,
                            "maxItems": 4,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "scene_no": {"type": "integer"},
                                    "text": {"type": "string", "description": "该页中文旁白。"},
                                    "image_prompt": {
                                        "type": "string",
                                        "description": "纯英文生图提示词。",
                                    },
                                },
                                "required": ["scene_no", "text", "image_prompt"],
                            },
                        },
                    },
                    "required": ["title", "story_body_zh", "scenes"],
                },
            },
        },
    ]


def _assistant_message_to_dict(msg: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"role": getattr(msg, "role", "assistant"), "content": msg.content}
    tool_calls = getattr(msg, "tool_calls", None)
    if tool_calls:
        serialized: list[dict[str, Any]] = []
        for tc in tool_calls:
            fn = tc.function
            serialized.append(
                {
                    "id": tc.id,
                    "type": getattr(tc, "type", "function"),
                    "function": {
                        "name": fn.name,
                        "arguments": fn.arguments or "{}",
                    },
                }
            )
        out["tool_calls"] = serialized
    return out


class TongquAgent:
    def __init__(
        self,
        story_pipeline: StorybookPipeline,
        sketch_service: SketchUnderstandingService,
    ) -> None:
        self._story = story_pipeline
        self._sketch = sketch_service
        self._tool_handlers = TongquToolHandlers(sketch_service, story_pipeline)
        self._tools_schema = _build_react_tools()
        self._ctx_original_keywords: str = ""
        self._ctx_safe_keywords: str = ""
        self._ctx_material_for_llm: str = ""
        self._ctx_sketch_image: str | None = None
        self._ctx_sketch_text: str | None = None
        self._ctx_style: str = ""
        self._ctx_visual_semantics: str | None = None
        self._ctx_vl_used: bool = False

    @staticmethod
    def _merge_agent_fields(
        base: Dict[str, Any],
        *,
        creation_source: str,
        sketch_vl_used: bool,
        sketch_understanding: str | None,
    ) -> Dict[str, Any]:
        out = dict(base)
        out["creation_source"] = creation_source
        out["sketch_vl_used"] = sketch_vl_used
        out["sketch_understanding"] = sketch_understanding
        return out

    def _baseline_material_for_filter(self, keywords: str, sketch_text: str | None) -> str:
        merged = (keywords or "").strip()
        st = (sketch_text or "").strip()
        if st:
            merged = f"{merged}\n\n【孩子说的话】{st}".strip()
        return merged

    def _build_enhancement_for_react(
        self,
        safe_keywords: str,
        style: str,
        enable_style_keyword_enhancer: bool | None,
    ) -> tuple[bool, Dict[str, Any], str]:
        """与 StorybookPipeline.run 中增强逻辑对齐；返回 (开关, enhancement 字典, 供 LLM 使用的素材字符串)。"""
        normalized_style = self._story._normalize_style(style)
        enhancer_enabled = (
            CONFIG.STYLE_KEYWORD_ENHANCER_ENABLED
            if enable_style_keyword_enhancer is None
            else enable_style_keyword_enhancer
        )
        if enhancer_enabled:
            er = self._story.style_keyword_enhancer.enhance(
                safe_keywords,
                normalized_style,
                enabled=True,
            )
            enhancement = {
                "selected_keywords": er.selected_keywords,
                "rewritten_prompt": er.rewritten_prompt,
                "used_model": er.used_model,
                "model_error": er.model_error,
            }
            material = er.rewritten_prompt
        else:
            enhancement = {
                "selected_keywords": [],
                "rewritten_prompt": safe_keywords,
                "used_model": False,
                "model_error": None,
            }
            material = safe_keywords
        return enhancer_enabled, enhancement, material

    async def _tool_analyze_sketch(self, args: dict[str, Any]) -> dict[str, Any]:
        has = bool(args.get("has_sketch_image"))
        img = (self._ctx_sketch_image or "").strip()
        if not has or not img:
            self._ctx_vl_used = False
            self._ctx_visual_semantics = None
            return {
                "visual_semantics": None,
                "vl_used": False,
                "message": "无草图或未上传图片，可跳过本工具直接 draft_story。",
            }
        ctx = await self._sketch.build_keywords(
            base_keywords=self._ctx_original_keywords,
            sketch_image_base64=img,
            sketch_text=self._ctx_sketch_text,
        )
        self._ctx_vl_used = ctx.vl_used
        self._ctx_visual_semantics = ctx.vl_understanding
        return {
            "visual_semantics": ctx.vl_understanding,
            "vl_used": ctx.vl_used,
            "message": "草图语义已生成，请在 draft_story 中传入 visual_semantics 与 core_keywords（工作区 safe_keywords）。",
        }

    async def _tool_draft_story(self, args: dict[str, Any]) -> dict[str, Any]:
        core = (args.get("core_keywords") or self._ctx_material_for_llm or "").strip()
        if not core:
            raise ValueError("core_keywords 不能为空")
        style = (args.get("style") or self._ctx_style).strip()
        vs = args.get("visual_semantics")
        if isinstance(vs, str) and not vs.strip():
            vs = None
        plan_args = StoryPlanningArgs(
            core_keywords=core,
            visual_semantics=vs,
            style=style,
        )
        result = await self._tool_handlers.story_planning_tool(plan_args)
        return result.model_dump()

    async def _tool_review_safety(self, args: dict[str, Any]) -> dict[str, Any]:
        body = (args.get("story_body_zh") or "").strip()
        if not body:
            raise ValueError("story_body_zh 不能为空")
        bert = await self._story.safety_middleware.review_text_with_bert(body)
        passed = bool(bert.get("passed", True)) and bert.get("risk_level") != "high"
        return {
            **bert,
            "safe_for_storyboard": passed,
            "next_step_hint": (
                "请再次调用 draft_story 改写故事正文，然后再调用 review_safety。"
                if not passed
                else "可调用 generate_storyboard 生成分镜。"
            ),
        }

    async def _tool_generate_storyboard(self, args: dict[str, Any]) -> dict[str, Any]:
        outline = (args.get("outline_zh") or "").strip()
        raw_cs = args.get("character_script")
        story_body = (args.get("story_body_zh") or "").strip()
        style = (args.get("style") or self._ctx_style).strip()
        if not outline or not story_body:
            raise ValueError("outline_zh 与 story_body_zh 不能为空")
        if not isinstance(raw_cs, list) or not raw_cs:
            raise ValueError("character_script 必须为非空数组")
        characters = [CharacterScriptEntry.model_validate(x) for x in raw_cs]
        board_args = StoryboardGenerationArgs(
            outline_zh=outline,
            character_script=characters,
            style=style,
            story_body_zh=story_body,
        )
        board = await self._tool_handlers.storyboard_generation_tool(board_args)
        scenes_out = [s.model_dump() for s in board.scenes]
        return {"scenes": scenes_out, "count": len(scenes_out)}

    def _tool_finish_creation(self, args: dict[str, Any]) -> tuple[dict[str, Any], List[Scene]]:
        title = str(args.get("title", "")).strip()
        story_body = str(args.get("story_body_zh", "")).strip()
        raw_scenes = args.get("scenes")
        if not title or not story_body:
            raise ValueError("title 与 story_body_zh 不能为空")
        if not isinstance(raw_scenes, list) or not (3 <= len(raw_scenes) <= 4):
            raise ValueError("scenes 必须为 3～4 条")
        scenes: List[Scene] = []
        for item in raw_scenes:
            if not isinstance(item, dict):
                raise ValueError("scenes 每一项必须为对象")
            scenes.append(
                Scene(
                    scene_no=int(item["scene_no"]),
                    text=str(item.get("text", "")),
                    image_prompt=str(item.get("image_prompt", "")),
                )
            )
        scenes.sort(key=lambda s: s.scene_no)
        ack = {
            "ok": True,
            "message": "已收到最终成稿，服务端将配图并合成语音。无需再调用其他工具。",
            "title": title,
            "story_body_zh": story_body,
            "scene_count": len(scenes),
        }
        return ack, scenes

    async def _dispatch_tool(
        self, name: str, arguments_json: str
    ) -> tuple[str, Optional[tuple[str, str, List[Scene]]]]:
        try:
            args = json.loads(arguments_json or "{}")
        except json.JSONDecodeError as exc:
            return json.dumps({"error": f"arguments 非合法 JSON: {exc}"}, ensure_ascii=False), None

        try:
            if name == "analyze_sketch":
                payload = await self._tool_analyze_sketch(args)
            elif name == "draft_story":
                payload = await self._tool_draft_story(args)
            elif name == "review_safety":
                payload = await self._tool_review_safety(args)
            elif name == "generate_storyboard":
                payload = await self._tool_generate_storyboard(args)
            elif name == "finish_creation":
                ack, scenes = self._tool_finish_creation(args)
                return json.dumps(ack, ensure_ascii=False), (
                    ack["title"],
                    ack["story_body_zh"],
                    scenes,
                )
            else:
                return json.dumps({"error": f"未知工具: {name}"}, ensure_ascii=False), None
        except Exception as exc:  # noqa: BLE001
            return json.dumps(
                {"error": type(exc).__name__, "detail": str(exc)[:800]},
                ensure_ascii=False,
            ), None

        return json.dumps(payload, ensure_ascii=False), None

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
        src = (
            creation_source
            if isinstance(creation_source, CreationSource)
            else CreationSource.from_optional(creation_source)
        )

        llm = self._story.llm_client
        if not hasattr(llm, "chat_completion"):
            return self._merge_agent_fields(
                {
                    "ok": False,
                    "error": "当前叙事模型不支持 Function Calling，请使用百炼 OpenAI 兼容网关并配置 DASHSCOPE_COMPAT_BASE_URL。",
                    "detail": "DashScopeQwenClient.chat_completion 不可用",
                    "mode": "real",
                    "title": "",
                    "story_text": "",
                    "scenes": [],
                    "image_urls": [],
                    "audio_urls": [],
                    "style_keyword_enhancer_enabled": False,
                    "style_keywords": [],
                    "enhanced_keywords_prompt": "",
                    "style_keyword_model_used": False,
                    "style_keyword_model_error": None,
                    "intercept_logs": self._story.safety_middleware.list_intercept_logs(),
                },
                creation_source=src.value,
                sketch_vl_used=False,
                sketch_understanding=None,
            )

        baseline = self._baseline_material_for_filter(keywords, sketch_text)
        filtered = await self._story.safety_middleware.filter_input(baseline)
        safe_keywords = filtered["sanitized_keywords"]

        enhancer_enabled, enhancement, material_for_llm = self._build_enhancement_for_react(
            safe_keywords,
            style,
            enable_style_keyword_enhancer,
        )

        self._ctx_original_keywords = (keywords or "").strip()
        self._ctx_safe_keywords = safe_keywords
        self._ctx_material_for_llm = material_for_llm
        self._ctx_sketch_image = sketch_image_base64
        self._ctx_sketch_text = sketch_text
        self._ctx_style = style
        self._ctx_visual_semantics = None
        self._ctx_vl_used = False

        workspace = {
            "style_slug": style,
            "safe_keywords": material_for_llm,
            "raw_safe_keywords_after_input_filter": safe_keywords,
            "original_keywords": (keywords or "").strip(),
            "sketch_text": (sketch_text or "").strip(),
            "has_sketch_image": bool((sketch_image_base64 or "").strip()),
            "input_blocked": filtered["blocked"],
            "input_hits": filtered["hits"],
            "style_keyword_enhancer_enabled": enhancer_enabled,
            "style_keywords_selected": enhancement["selected_keywords"],
        }
        user_intro = (
            "以下是本轮创作的工作区（JSON）。请严格按系统提示使用工具完成绘本主链，"
            "最后用 finish_creation 结束。\n"
            + json.dumps(workspace, ensure_ascii=False)
        )

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": _REACT_SYSTEM_PROMPT},
            {"role": "user", "content": user_intro},
        ]

        finished: Optional[tuple[str, str, List[Scene]]] = None
        step = 0

        try:
            while step < MAX_REACT_TURNS:
                step += 1
                resp = await llm.chat_completion(  # type: ignore[attr-defined]
                    messages=messages,
                    tools=self._tools_schema,
                    tool_choice="auto",
                    parallel_tool_calls=False,
                )
                msg = resp.choices[0].message

                if not getattr(msg, "tool_calls", None):
                    messages.append(_assistant_message_to_dict(msg))
                    messages.append(
                        {
                            "role": "user",
                            "content": "请使用工具继续：若有草图请先 analyze_sketch，再 draft_story → review_safety → generate_storyboard → finish_creation。",
                        }
                    )
                    continue

                messages.append(_assistant_message_to_dict(msg))

                for tc in msg.tool_calls:
                    name = tc.function.name
                    raw_args = tc.function.arguments or "{}"
                    body, fin = await self._dispatch_tool(name, raw_args)
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": body,
                        }
                    )
                    if name == "finish_creation" and fin is not None:
                        finished = fin
                        break

                if finished is not None:
                    break

        except ApiKeyError as exc:
            return self._merge_agent_fields(
                {
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
                    "intercept_logs": self._story.safety_middleware.list_intercept_logs(),
                },
                creation_source=src.value,
                sketch_vl_used=self._ctx_vl_used,
                sketch_understanding=self._ctx_visual_semantics,
            )
        except Exception as exc:  # noqa: BLE001
            return self._merge_agent_fields(
                {
                    "ok": False,
                    "error": "主理人执行失败，请稍后重试。",
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
                    "intercept_logs": self._story.safety_middleware.list_intercept_logs(),
                },
                creation_source=src.value,
                sketch_vl_used=self._ctx_vl_used,
                sketch_understanding=self._ctx_visual_semantics,
            )

        if finished is None:
            return self._merge_agent_fields(
                {
                    "ok": False,
                    "error": f"在 {MAX_REACT_TURNS} 轮内未完成 finish_creation，请重试。",
                    "detail": "sandbox_react_incomplete",
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
                    "intercept_logs": self._story.safety_middleware.list_intercept_logs(),
                },
                creation_source=src.value,
                sketch_vl_used=self._ctx_vl_used,
                sketch_understanding=self._ctx_visual_semantics,
            )

        title, story_text, scenes = finished

        result = await self._story.finalize_from_structured(
            style=style,
            title=title,
            story_text=story_text,
            scenes=scenes,
            input_blocked=filtered["blocked"],
            input_hits=filtered["hits"],
            enhancement=enhancement,
            enhancer_enabled=enhancer_enabled,
        )

        return self._merge_agent_fields(
            result,
            creation_source=src.value,
            sketch_vl_used=self._ctx_vl_used,
            sketch_understanding=self._ctx_visual_semantics,
        )


def build_default_tongqu_agent() -> TongquAgent:
    """装配默认生产环境：草图 VL + 成书流水线（依赖检查在 build_default_story_pipeline）。"""
    from core.clients import DashScopeQwenVLClient
    from services.story_pipeline import build_default_story_pipeline

    pipeline = build_default_story_pipeline()
    sketch = SketchUnderstandingService(DashScopeQwenVLClient())
    return TongquAgent(story_pipeline=pipeline, sketch_service=sketch)
