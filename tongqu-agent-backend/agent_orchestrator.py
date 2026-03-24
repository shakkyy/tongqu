"""
童趣绘梦 - Agent 调度核心（Mock First）

核心策略：
1) 默认 USE_REAL_API=False，所有 AI 能力返回本地高质量 Mock 数据；
2) 打开 USE_REAL_API=True 后，保持同样输入参数与输出 JSON 结构，平滑切换到真实 API；
3) 在开发阶段通过 1-2 秒人为延迟，模拟真实生成等待感，便于前端联调加载动画。
"""

from __future__ import annotations

import asyncio
import json
import random
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Dict, List, Protocol, Sequence

from config import CONFIG
from mock_data import MOCK_STYLE_STORIES
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
    """语言模型协议：可对接 Qwen-Turbo 或其他大模型。"""

    async def generate(self, prompt: str) -> str:
        ...


class ImageClient(Protocol):
    """图像模型协议：可对接 SDXL + LoRA 生成服务。"""

    async def generate_image(self, prompt: str, style: str) -> str:
        ...


class TTSClient(Protocol):
    """语音模型协议：可对接 Azure TTS 等服务。"""

    async def synthesize(self, text: str, voice: str) -> str:
        ...


class SafetyClient(Protocol):
    """安全审查协议：输入/输出双向扫描，必要时给重写建议。"""

    async def scan_text(self, text: str) -> Dict[str, Any]:
        ...

    async def scan_image(self, image_url: str) -> Dict[str, Any]:
        ...

    async def rewrite_to_safe(self, text: str) -> str:
        ...


# =========================
# 可运行的占位客户端（Demo）
# =========================
# 真实项目中可替换为：
# - LangChain 对接 Qwen
# - SDXL + LoRA 推理服务
# - Azure TTS SDK
# - 你自己的安全模型服务


class FakeQwenClient:
    async def generate(self, prompt: str) -> str:
        await asyncio.sleep(0.15)
        # 用结构化 JSON 让后续分镜更稳定，减少解析歧义。
        return json.dumps(
            {
                "title": "孙悟空与神龟的云海约定",
                "story": (
                    "孙悟空在花果山遇见一只会说话的神龟。"
                    "他们一起穿越云海，帮助迷路的小鸟回家。"
                    "最终大家学会了勇敢、合作与守信。"
                ),
                "scenes": [
                    {
                        "scene_no": 1,
                        "text": "清晨，孙悟空在花果山练棍，神龟从溪边缓缓走来。",
                        "image_prompt": "中国水墨风，花果山晨雾，孙悟空与神龟相遇，温暖童话感",
                    },
                    {
                        "scene_no": 2,
                        "text": "两位新朋友乘着云朵，寻找迷路的小鸟。",
                        "image_prompt": "中国水墨风，云海与飞鸟，孙悟空和神龟并肩前行，明亮治愈",
                    },
                    {
                        "scene_no": 3,
                        "text": "他们把小鸟送回巢中，夕阳照亮整片山谷。",
                        "image_prompt": "中国水墨风，金色夕阳下的山谷，团圆与感恩，儿童绘本质感",
                    },
                ],
            },
            ensure_ascii=False,
        )


class FakeSDXLClient:
    async def generate_image(self, prompt: str, style: str) -> str:
        await asyncio.sleep(0.2)
        # 随机模拟偶发失败，验证重试链路是否生效。
        if random.random() < 0.15:
            raise RuntimeError("image backend busy")
        slug = abs(hash((prompt, style))) % 100000
        return f"https://cdn.tongqu.local/images/{style}-{slug}.png"


class FakeAzureTTSClient:
    async def synthesize(self, text: str, voice: str) -> str:
        await asyncio.sleep(0.1)
        slug = abs(hash((text, voice))) % 100000
        return f"https://cdn.tongqu.local/audio/{voice}-{slug}.mp3"


class FakeSafetyClient:
    async def scan_text(self, text: str) -> Dict[str, Any]:
        await asyncio.sleep(0.02)
        # 简化示例：若含敏感词则判高风险。
        banned = ["暴力", "恐怖", "血腥", "仇恨"]
        hit = [w for w in banned if w in text]
        if hit:
            return {"passed": False, "risk": "high", "hits": hit}
        return {"passed": True, "risk": "low", "hits": []}

    async def scan_image(self, image_url: str) -> Dict[str, Any]:
        await asyncio.sleep(0.01)
        # 示例默认通过；真实场景应接入 NSFW/暴力分类服务。
        return {"passed": True, "risk": "low"}

    async def rewrite_to_safe(self, text: str) -> str:
        await asyncio.sleep(0.05)
        return f"（安全改写）{text}"


class MockBundleClient:
    """
    一体化 Mock 数据提供器：
    - 按风格返回预设“故事+分镜+图片URL+音频URL”；
    - 统一在此处模拟 1-2 秒延迟，保持前端加载行为稳定。
    """

    def __init__(self, min_delay: float, max_delay: float) -> None:
        self.min_delay = min_delay
        self.max_delay = max_delay

    async def fetch(self, keywords: str, style: str) -> Dict[str, Any]:
        await asyncio.sleep(random.uniform(self.min_delay, self.max_delay))
        style_bucket = MOCK_STYLE_STORIES.get(style, MOCK_STYLE_STORIES["水墨"])
        idx = abs(hash(keywords)) % len(style_bucket)
        return deepcopy(style_bucket[idx])


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
        mock_bundle_client: MockBundleClient | None = None,
        use_real_api: bool | None = None,
    ) -> None:
        self.llm_client = llm_client
        self.image_client = image_client
        self.tts_client = tts_client
        self.safety_client = safety_client
        self.safety_middleware = safety_middleware or SafetyMiddleware()
        self.mock_bundle_client = mock_bundle_client or MockBundleClient(
            min_delay=CONFIG.MOCK_MIN_DELAY_SEC,
            max_delay=CONFIG.MOCK_MAX_DELAY_SEC,
        )
        self.use_real_api = CONFIG.USE_REAL_API if use_real_api is None else use_real_api

    async def run(self, keywords: str, style: str) -> Dict[str, Any]:
        """
        主入口：
        输入：关键词 + 风格
        输出：结构化 JSON（故事文本、图片URL列表、音频URL列表）
        """
        try:
            # Step 0: 输入层过滤，若命中风险词则自动引导到正向主题。
            filtered = await self.safety_middleware.filter_input(keywords)
            safe_keywords = filtered["sanitized_keywords"]
            normalized_style = self._normalize_style(style)

            # Step 1: 构造儿童向 Prompt（明确“儿童适龄+中国风+正向价值观”约束）
            prompt = self._build_story_prompt(keywords=safe_keywords, style=normalized_style)

            if self.use_real_api:
                # ===== 生产模式：真实 API =====
                raw_story = await self.llm_client.generate(prompt)
                safe_story = await self._ensure_safe_text(raw_story)
                title, story_text, scenes = self._parse_story_and_scenes(safe_story)
                image_urls, audio_urls = await asyncio.gather(
                    self._generate_images_with_retry(scenes=scenes, style=normalized_style),
                    self._synthesize_all_scenes(scenes=scenes, voice="亲切姐姐"),
                )
            else:
                # ===== 开发模式：Mock First =====
                # 说明：即使是 mock，也保持和真实模式一致的输出结构。
                bundle = await self.mock_bundle_client.fetch(keywords=safe_keywords, style=normalized_style)
                title = str(bundle["title"])
                story_text = str(bundle["story"])
                scenes = [
                    Scene(scene_no=int(s["scene_no"]), text=str(s["text"]), image_prompt=str(s["image_prompt"]))
                    for s in bundle["scenes"]
                ]
                image_urls = [str(url) for url in bundle["image_urls"]]
                audio_urls = [str(url) for url in bundle["audio_urls"]]

            # Step 6: 输出二次安全复审（文本 + 图片）
            title, story_text, scenes = await self._final_safety_review(
                title=title,
                story_text=story_text,
                scenes=scenes,
                image_urls=image_urls,
            )
            story_text = await self.safety_middleware.align_values(story_text)

            return {
                "ok": True,
                "mode": "real" if self.use_real_api else "mock",
                "input_blocked": filtered["blocked"],
                "input_hits": filtered["hits"],
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
                "mode": "real" if self.use_real_api else "mock",
                "title": "",
                "story_text": "",
                "scenes": [],
                "image_urls": [],
                "audio_urls": [],
                "intercept_logs": self.safety_middleware.list_intercept_logs(),
            }
        except Exception as exc:  # noqa: BLE001
            # 兜底策略：记录内部错误，外部返回儿童友好文案，避免崩溃泄露细节。
            return {
                "ok": False,
                "error": USER_FACING_FALLBACK,
                "detail": str(exc),
                "mode": "real" if self.use_real_api else "mock",
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
4) 输出结构：
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
            "剪纸": "剪纸",
            "水墨": "水墨",
            "皮影": "皮影",
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
                        # 退避等待，给下游推理服务“喘息”时间。
                        await asyncio.sleep(0.25 * (attempt + 1))
                        continue
                    raise RuntimeError(
                        f"场景{scene.scene_no}图片生成失败（已重试{MAX_IMAGE_RETRY}次）"
                    ) from last_error

            raise RuntimeError("图片生成异常终止")

        return await asyncio.gather(*[_task(scene) for scene in scenes])

    async def _synthesize_all_scenes(self, scenes: Sequence[Scene], voice: str) -> List[str]:
        # 真实 NLS 网关对并发/QPS 敏感，多路并行易触发 TOO_MANY_REQUESTS；Mock 仍可并行。
        if self.use_real_api:
            urls: List[str] = []
            for idx, scene in enumerate(scenes):
                if idx > 0:
                    await asyncio.sleep(0.45)
                urls.append(await self.tts_client.synthesize(scene.text, voice))
            return urls
        return await asyncio.gather(*[self.tts_client.synthesize(scene.text, voice) for scene in scenes])

    async def _final_safety_review(
        self,
        title: str,
        story_text: str,
        scenes: Sequence[Scene],
        image_urls: Sequence[str],
    ) -> tuple[str, str, List[Scene]]:
        # 文本复审：标题 + 正文 + 分镜文本合并后一次扫描。
        merged_text = " ".join([title, story_text, *[s.text for s in scenes]])
        text_result = await self.safety_client.scan_text(merged_text)
        if not text_result.get("passed", False):
            story_text = await self.safety_client.rewrite_to_safe(story_text)
            scenes = [
                Scene(scene_no=s.scene_no, text=await self.safety_client.rewrite_to_safe(s.text), image_prompt=s.image_prompt)
                for s in scenes
            ]

        # 图片复审：逐张检测，若发现高风险则替换为安全占位图。
        safe_image_urls: List[str] = []
        for url in image_urls:
            img_result = await self.safety_client.scan_image(url)
            if img_result.get("passed", False):
                safe_image_urls.append(url)
            else:
                safe_image_urls.append("https://cdn.tongqu.local/images/safe-fallback.png")

        # 注意：此处只返回改写后的内容，调用方可继续决定是否触发再次生成。
        return title, story_text, list(scenes)


# =========================
# LangChain/OpenClaw 适配示意（非必需）
# =========================

def build_default_orchestrator() -> StoryOrchestrator:
    """
    根据 CONFIG.USE_REAL_API 装配客户端：
    - mock：本地假数据 + 假安全/TTS（便于前端联调）
    - real：DashScope + 万相 + Green + NLS
    """
    if CONFIG.USE_REAL_API:
        from real_clients import (
            AliyunGreenSafetyClient,
            AliyunNlsTtsClient,
            DashScopeQwenClient,
            DashScopeWanxImageClient,
        )

        return StoryOrchestrator(
            llm_client=DashScopeQwenClient(),
            image_client=DashScopeWanxImageClient(),
            tts_client=AliyunNlsTtsClient(),
            safety_client=AliyunGreenSafetyClient(),
        )

    return StoryOrchestrator(
        llm_client=FakeQwenClient(),
        image_client=FakeSDXLClient(),
        tts_client=FakeAzureTTSClient(),
        safety_client=FakeSafetyClient(),
    )


class LangChainQwenClient:
    """
    示例适配器：演示如何把 LangChain ChatModel 接入统一 LLMClient 协议。
    """

    def __init__(self, chat_model: Any) -> None:
        self.chat_model = chat_model

    async def generate(self, prompt: str) -> str:
        # 新版 LangChain 常用 ainvoke；不同版本字段可能有差异。
        msg = await self.chat_model.ainvoke(prompt)
        # 兼容 AIMessage/content 风格返回。
        return getattr(msg, "content", str(msg))


async def demo() -> None:
    """
    本地演示入口：python agent_orchestrator.py
    """
    # 风格示例：剪纸 / 水墨 / 皮影
    orchestrator = build_default_orchestrator()
    result = await orchestrator.run(keywords="孙悟空+神龟", style="水墨")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(demo())
