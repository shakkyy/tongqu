"""
童趣绘梦中枢 Agent：沙盒式 ReAct（Sandboxed ReAct + Function Calling）

- 前置：filter_input；可选「风格关键词增强」（与 StorybookPipeline.run 逻辑对齐），再进入主循环。
- 核心：while 循环 + Qwen OpenAI 兼容 tools，由模型自主编排工具调用。
- 后置：StorybookPipeline.finalize_from_structured（保留同伴的 style_keyword 元数据回传）。
"""

from __future__ import annotations

import json
from typing import Any, Awaitable, Callable, Dict, List, Optional

from agent.tools import (
    CharacterScriptEntry,
    StoryPlanningArgs,
    StoryboardGenerationArgs,
    TongquToolHandlers,
)
from config import CONFIG
from core.clients import ApiKeyError
from core.models import CreationSource, Scene
from services.culture_rag import CultureHit, CultureRagService
from services.sketch_service import SketchUnderstandingService
from services.story_pipeline import StorybookPipeline

MAX_REACT_TURNS = 8
ProgressReporter = Callable[[dict[str, Any]], Awaitable[None]]

_REACT_SYSTEM_PROMPT = """你是「童趣绘梦」的儿童绘本主理人，负责把用户素材变成可配图、可朗读的分镜内容。

你必须使用提供的工具（Function Calling）完成工作，不要只在对话里讲故事而不调用工具。

**标准作业流程（SOP）——须严格遵守：**
1. 若工作区标明「用户带有草图图片」，必须先调用 `analyze_sketch` 获取画面语义；若无草图，可跳过此步。
2. 调用 `retrieve_culture`：基于 safe_keywords、sketch_text 与（若有）visual_semantics 检索文化语料，取得 culture_context。
3. 调用 `draft_story`：结合工作区中的「用于写故事的核心素材 safe_keywords」、（若有）视觉语义与 culture_context，生成标题、大纲、人物脚本、价值观与完整故事正文（ 600-800 字）。
4. 调用 `review_safety`：对故事正文做自我审查（BERT 位点）。若结果不安全或高风险，**不要**继续分镜，应再次调用 `draft_story` 改写后再调用 `review_safety`。
5. 仅在审查通过后，调用 `generate_storyboard`：将故事切分为 8-10 个分镜，每镜含中文旁白与**纯英文** image_prompt，并保持角色视觉锚点一致。
6. 当你确认分镜合理且已通过安全审查时，调用 `finish_creation` 传入 `title`、`story_body_zh` 与 `scenes` 列表以**结束**整个创作流程。

**重要约束：**
- 面向 4～10 岁儿童，积极正向；不得输出违法、暴力、色情、恐怖或歧视内容。
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
                "description": "根据安全过滤后的关键词、（可选）草图视觉语义与文化 RAG 上下文，生成完整故事策划 JSON（含 title_zh、outline_zh、character_script、positive_values、story_body_zh）。",
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
                        "culture_context": {
                            "type": ["string", "null"],
                            "description": "来自 retrieve_culture；无命中时为 null。",
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
                "name": "retrieve_culture",
                "description": "基于安全素材和草图语义检索中国传统文化 frontmatter RAG 字段，返回可注入故事策划的短上下文。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "由 safe_keywords、sketch_text、visual_semantics 组合而成的检索查询。",
                        },
                        "top_k": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 5,
                            "description": "返回条数，默认 3。",
                        },
                    },
                    "required": ["query"],
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
        culture_rag_service: CultureRagService | None = None,
    ) -> None:
        self._story = story_pipeline
        self._sketch = sketch_service
        self._culture = culture_rag_service or CultureRagService()
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
        self._ctx_culture_hits: list[CultureHit] = []
        self._ctx_culture_context: str = ""
        self._ctx_culture_integration_note: str = ""

    def _merge_agent_fields(
        self,
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
        out["culture_rag_used"] = bool(self._ctx_culture_hits)
        out["culture_hits"] = [hit.to_public_dict() for hit in self._ctx_culture_hits]
        out["culture_context"] = self._ctx_culture_context[:1200]
        out["culture_integration_note"] = self._ctx_culture_integration_note
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

    def _culture_payload(self) -> dict[str, Any]:
        return {
            "used": bool(self._ctx_culture_hits),
            "hits": [hit.to_api_dict() for hit in self._ctx_culture_hits],
            "culture_context": self._ctx_culture_context,
            "culture_integration_note": self._ctx_culture_integration_note,
        }

    def _retrieve_culture_for_query(self, query: str, top_k: int | None = None) -> dict[str, Any]:
        hits = self._culture.retrieve(
            query,
            top_k=top_k or CONFIG.CULTURE_RAG_TOP_K,
        )
        self._ctx_culture_hits = hits
        self._ctx_culture_context = self._culture.build_culture_context(hits)
        self._ctx_culture_integration_note = self._culture.integration_note(hits)
        titles = ", ".join(f"{hit.title}({hit.score:.2f})" for hit in hits) or "none"
        print(f"[culture_rag] query={query[:80]!r} hits={titles}", flush=True)
        return self._culture_payload()

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
        if ctx.vl_understanding:
            query = "\n".join(
                part
                for part in [
                    self._ctx_safe_keywords,
                    self._ctx_sketch_text or "",
                    ctx.vl_understanding,
                ]
                if part
            )
            self._retrieve_culture_for_query(query)
        return {
            "visual_semantics": ctx.vl_understanding,
            "vl_used": ctx.vl_used,
            "culture_rag": self._culture_payload(),
            "message": "草图语义已生成，请在 draft_story 中传入 visual_semantics 与 core_keywords（工作区 safe_keywords）。",
        }

    async def _tool_retrieve_culture(self, args: dict[str, Any]) -> dict[str, Any]:
        query = (args.get("query") or "").strip()
        if not query:
            query = "\n".join(
                part
                for part in [
                    self._ctx_safe_keywords,
                    self._ctx_sketch_text or "",
                    self._ctx_visual_semantics or "",
                ]
                if part
            )
        top_k = int(args.get("top_k") or CONFIG.CULTURE_RAG_TOP_K)
        return self._retrieve_culture_for_query(query, top_k=top_k)

    async def _tool_draft_story(self, args: dict[str, Any]) -> dict[str, Any]:
        core = (args.get("core_keywords") or self._ctx_material_for_llm or "").strip()
        if not core:
            raise ValueError("core_keywords 不能为空")
        style = (args.get("style") or self._ctx_style).strip()
        vs = args.get("visual_semantics")
        if isinstance(vs, str) and not vs.strip():
            vs = None
        culture_context = args.get("culture_context")
        if isinstance(culture_context, str) and not culture_context.strip():
            culture_context = None
        plan_args = StoryPlanningArgs(
            core_keywords=core,
            visual_semantics=vs,
            culture_context=culture_context or self._ctx_culture_context or None,
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
            elif name == "retrieve_culture":
                payload = await self._tool_retrieve_culture(args)
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

    async def _emit_agent_trace(
        self,
        reporter: ProgressReporter | None,
        *,
        kind: str,
        title: str,
        detail: str,
        **meta: Any,
    ) -> None:
        if reporter is None:
            return
        await reporter(
            {
                "id": "agent_trace",
                "title": title,
                "detail": detail,
                "meta": {
                    "agent_trace": {
                        "kind": kind,
                        "title": title,
                        "detail": detail,
                        **meta,
                    }
                },
            }
        )

    async def run(
        self,
        *,
        keywords: str,
        style: str,
        sketch_image_base64: str | None = None,
        sketch_text: str | None = None,
        creation_source: CreationSource | str | None = None,
        enable_style_keyword_enhancer: bool | None = None,
        on_progress: ProgressReporter | None = None,
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

        await self._emit_progress(
            on_progress,
            "orchestrate",
            "中枢 Agent 编排",
            "正在进行素材整理与安全预处理",
        )
        await self._emit_agent_trace(
            on_progress,
            kind="observe",
            title="理解输入",
            detail=f"收到 {src.value} 模式素材，准备先做安全过滤，再进入文化检索与故事编排。",
            creation_source=src.value,
            has_sketch=bool((sketch_image_base64 or "").strip()),
        )
        baseline = self._baseline_material_for_filter(keywords, sketch_text)
        filtered = await self._story.safety_middleware.filter_input(baseline)
        safe_keywords = filtered["sanitized_keywords"]
        await self._emit_agent_trace(
            on_progress,
            kind="decision",
            title="安全预处理完成",
            detail=(
                "输入素材可继续创作。"
                if not filtered["blocked"]
                else "输入命中敏感项，已使用安全改写后的素材继续。"
            ),
            hits=filtered["hits"],
            safe_keywords=safe_keywords[:240],
        )

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
        self._ctx_culture_hits = []
        self._ctx_culture_context = ""
        self._ctx_culture_integration_note = ""

        culture_query = "\n".join(
            part
            for part in [safe_keywords, (sketch_text or "").strip()]
            if part
        )
        self._retrieve_culture_for_query(culture_query)
        await self._emit_agent_trace(
            on_progress,
            kind="tool_result",
            title="文化检索结果",
            detail=(
                "命中：" + "、".join(hit.title for hit in self._ctx_culture_hits)
                if self._ctx_culture_hits
                else "没有高相关文化条目，本轮不会强行注入传统故事。"
            ),
            culture_hits=[hit.to_public_dict() for hit in self._ctx_culture_hits],
        )

        workspace = {
            "style_slug": style,
            "safe_keywords": material_for_llm,
            "raw_safe_keywords_after_input_filter": safe_keywords,
            "culture_context": self._ctx_culture_context,
            "culture_hits": [hit.to_api_dict() for hit in self._ctx_culture_hits],
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
                    await self._emit_agent_trace(
                        on_progress,
                        kind="repair",
                        title="中枢自我纠偏",
                        detail="模型没有调用工具，系统已提醒它必须按 analyze/retrieve/draft/review/board/finish 的工具链继续。",
                        turn=step,
                    )
                    messages.append(_assistant_message_to_dict(msg))
                    messages.append(
                        {
                            "role": "user",
                            "content": "请使用工具继续：若有草图请先 analyze_sketch，然后 retrieve_culture，再 draft_story → review_safety → generate_storyboard → finish_creation。",
                        }
                    )
                    continue

                messages.append(_assistant_message_to_dict(msg))

                for tc in msg.tool_calls:
                    name = tc.function.name
                    await self._emit_agent_trace(
                        on_progress,
                        kind="tool_call",
                        title=f"调用工具：{name}",
                        detail={
                            "analyze_sketch": "先理解草图里的角色、场景和动作，再把视觉语义补进故事素材。",
                            "retrieve_culture": "根据安全素材和草图语义检索传统文化条目，提取可儿童化改写的核心思想。",
                            "draft_story": "把用户素材、草图语义和文化参考交给故事策划工具，生成标题、正文和价值观。",
                            "review_safety": "对故事正文做儿童安全初审，不通过则要求重新改写。",
                            "generate_storyboard": "把故事拆成分镜，并生成每页英文生图提示词。",
                            "finish_creation": "确认结构化成稿，准备进入配图和语音合成流水线。",
                        }.get(name, "执行中枢选择的工具。"),
                        turn=step,
                    )
                    if name == "analyze_sketch":
                        await self._emit_progress(
                            on_progress,
                            "sketch",
                            "解析草图灵感",
                            "正在理解草图中的角色与场景语义",
                        )
                    elif name == "retrieve_culture":
                        await self._emit_progress(
                            on_progress,
                            "culture",
                            "检索文化语料",
                            "正在从传统文化 frontmatter 中提取可改写灵感",
                        )
                    elif name == "draft_story":
                        await self._emit_progress(
                            on_progress,
                            "draft",
                            "撰写故事正文",
                            "正在构思标题、正文与角色设定",
                        )
                    elif name == "review_safety":
                        await self._emit_progress(
                            on_progress,
                            "orchestrate",
                            "中枢 Agent 编排",
                            "正在执行故事文本安全初审",
                            phase="story_draft_review",
                        )
                    elif name == "generate_storyboard":
                        await self._emit_progress(
                            on_progress,
                            "board",
                            "生成分镜脚本",
                            "正在拆分故事并生成每页画面提示词",
                        )
                    elif name == "finish_creation":
                        await self._emit_progress(
                            on_progress,
                            "orchestrate",
                            "中枢 Agent 编排",
                            "分镜确认完成，准备进入插图与语音制作",
                        )
                    raw_args = tc.function.arguments or "{}"
                    body, fin = await self._dispatch_tool(name, raw_args)
                    try:
                        tool_payload = json.loads(body)
                    except json.JSONDecodeError:
                        tool_payload = {}
                    if isinstance(tool_payload, dict) and "error" in tool_payload:
                        await self._emit_agent_trace(
                            on_progress,
                            kind="tool_error",
                            title=f"工具返回错误：{name}",
                            detail=f"{tool_payload.get('error')}：{tool_payload.get('detail', '等待中枢根据错误信息修正参数后重试。')}",
                            turn=step,
                        )
                    else:
                        summary = {
                            "analyze_sketch": (
                                "草图理解完成。"
                                if tool_payload.get("vl_used")
                                else "未使用草图视觉理解，可继续文本创作。"
                            ),
                            "retrieve_culture": (
                                "文化检索完成："
                                + "、".join(hit.get("title", "") for hit in tool_payload.get("hits", [])[:3])
                                if tool_payload.get("used")
                                else "文化检索完成：没有高相关命中。"
                            ),
                            "draft_story": f"故事草案完成：{tool_payload.get('title_zh', '未命名')}。",
                            "review_safety": (
                                "安全初审通过，可以进入分镜。"
                                if tool_payload.get("safe_for_storyboard")
                                else "安全初审未通过，中枢会要求重新改写故事。"
                            ),
                            "generate_storyboard": f"分镜生成完成，共 {tool_payload.get('count', 0)} 页。",
                            "finish_creation": "结构化成稿已确认，进入插图与朗读制作。",
                        }.get(name, "工具执行完成。")
                        await self._emit_agent_trace(
                            on_progress,
                            kind="tool_result",
                            title=f"工具结果：{name}",
                            detail=summary,
                            turn=step,
                        )
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
        await self._emit_agent_trace(
            on_progress,
            kind="decision",
            title="进入成书流水线",
            detail=f"中枢已得到《{title}》和 {len(scenes)} 个分镜，开始并行配图、合成朗读与最终安全复核。",
            title_zh=title,
            scene_count=len(scenes),
        )

        result = await self._story.finalize_from_structured(
            style=style,
            title=title,
            story_text=story_text,
            scenes=scenes,
            input_blocked=filtered["blocked"],
            input_hits=filtered["hits"],
            enhancement=enhancement,
            enhancer_enabled=enhancer_enabled,
            on_progress=on_progress,
        )
        await self._emit_agent_trace(
            on_progress,
            kind="finish" if result.get("ok") else "error",
            title="成书完成" if result.get("ok") else "成书失败",
            detail=(
                f"绘本《{result.get('title', title)}》已生成，包含 {len(result.get('scenes', []))} 页。"
                if result.get("ok")
                else str(result.get("detail") or result.get("error") or "流水线返回失败")
            ),
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
