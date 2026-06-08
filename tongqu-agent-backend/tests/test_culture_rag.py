from __future__ import annotations

import asyncio
import json
import unittest
from pathlib import Path
from types import SimpleNamespace

from agent.tongqu_agent import TongquAgent
from core.models import Scene
from core.safety import SafetyMiddleware
from services.culture_rag import CultureRagService
from services.sketch_service import SketchUnderstandingService
from services.style_keyword_enhancer import StyleKeywordEnhancer
from services.story_pipeline import StorybookPipeline


CORPUS = Path(__file__).resolve().parents[2] / "chinese-stories-database"


class CaptureCultureRag(CultureRagService):
    def __init__(self) -> None:
        super().__init__(CORPUS, embedding_enabled=False)
        self.queries: list[str] = []

    def retrieve(self, query: str, top_k: int = 3):
        self.queries.append(query)
        return super().retrieve(query, top_k)


class FakeVisionClient:
    async def describe_sketch(self, image_data_url: str) -> str:
        return "草图里有一条河、一艘龙舟、几个孩子和漂亮香包。"


class FakeImageClient:
    async def generate_image(self, prompt: str, style: str) -> str:
        return "https://example.test/image.png"


class FakeTtsClient:
    async def synthesize(self, text: str, voice: str) -> str:
        return "https://example.test/audio.mp3"


def make_fake_scenes() -> list[dict[str, object]]:
    return [
        {
            "scene_no": idx,
            "text_zh": f"第{idx}页，安安和小兔沿着月光小路继续寻找家的方向。",
            "image_prompt_en": (
                "a 6-year-old Chinese child wearing a green jacket, a small white rabbit, "
                f"page {idx} moonlit path, traditional Chinese ink wash painting, "
                "no text, no letters, no watermark, no logo"
            ),
        }
        for idx in range(1, 7)
    ]


class FakeSafetyClient:
    async def scan_text(self, text: str) -> dict:
        return {"passed": True}

    async def scan_image(self, image_url: str) -> dict:
        return {"passed": True}

    async def rewrite_to_safe(self, text: str) -> str:
        return text


class FakeChatLlm:
    def __init__(self, *, with_sketch: bool = False) -> None:
        self.with_sketch = with_sketch
        self.calls = 0
        self.last_story_prompt = ""

    async def generate(self, prompt: str) -> str:
        if "故事策划" in prompt:
            self.last_story_prompt = prompt
            return json.dumps(
                {
                    "title_zh": "月光小车回家",
                    "outline_zh": "小兔想家，孩子用月光灯笼陪它找到朋友，一起分享圆圆点心。",
                    "character_script": [
                        {
                            "role": "主角",
                            "name": "安安",
                            "appearance_anchor_en": "a 6-year-old Chinese child wearing a green jacket",
                            "traits_zh": "细心、愿意帮助朋友",
                        }
                    ],
                    "positive_values": ["珍惜家人", "陪伴", "合作"],
                    "story_body_zh": "安安遇见一只想家的小兔。她没有照搬老故事，而是做了一盏月光灯笼，和伙伴沿着桂花香的小路寻找家的方向。大家分享圆圆点心，把思念说成祝福。小兔发现，朋友的陪伴也像一轮温柔的月亮。",
                    "scenes": make_fake_scenes(),
                },
                ensure_ascii=False,
            )
        return json.dumps(
            {
                "scenes": make_fake_scenes()
            },
            ensure_ascii=False,
        )

    async def chat_completion(self, messages, tools, tool_choice="auto", parallel_tool_calls=False):
        self.calls += 1
        if self.with_sketch and self.calls == 1:
            return _tool_response("analyze_sketch", {"has_sketch_image": True})
        offset = 1 if self.with_sketch else 0
        sequence = [
            ("retrieve_culture", {"query": "月亮 小兔 想家", "top_k": 3}),
            ("draft_story", {"core_keywords": "月亮 小兔 想家", "style": "ink-wash"}),
            ("review_safety", {"story_body_zh": "安安遇见一只想家的小兔，做月光灯笼陪它找家。"}),
            (
                "finish_creation",
                {
                    "title": "月光小车回家",
                    "story_body_zh": "安安遇见一只想家的小兔，做月光灯笼陪它找家。",
                    "scenes": make_fake_scenes(),
                },
            ),
        ]
        name, args = sequence[self.calls - 1 - offset]
        return _tool_response(name, args)


def _tool_response(name: str, args: dict):
    call = SimpleNamespace(
        id=f"call_{name}",
        type="function",
        function=SimpleNamespace(name=name, arguments=json.dumps(args, ensure_ascii=False)),
    )
    message = SimpleNamespace(role="assistant", content=None, tool_calls=[call])
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def build_agent(culture: CultureRagService, llm: FakeChatLlm) -> TongquAgent:
    pipeline = StorybookPipeline(
        llm_client=llm,
        image_client=FakeImageClient(),
        tts_client=FakeTtsClient(),
        safety_client=FakeSafetyClient(),
        safety_middleware=SafetyMiddleware(guard_enabled=False),
    )
    return TongquAgent(
        story_pipeline=pipeline,
        sketch_service=SketchUnderstandingService(FakeVisionClient()),
        culture_rag_service=culture,
    )


class CultureRagTests(unittest.TestCase):
    def test_qwen3guard_parser_maps_unsafe_output(self) -> None:
        from core.safety import parse_qwen3guard_output

        parsed = parse_qwen3guard_output("Safety: Unsafe\nCategories: Violent")
        self.assertFalse(parsed["passed"])
        self.assertEqual(parsed["risk_level"], "high")
        self.assertIn("Violent", parsed["hits"])

    def test_style_keyword_enhancer_adds_english_fragments_to_image_prompt(self) -> None:
        enhancer = StyleKeywordEnhancer(enabled=True, top_k=3)
        result = enhancer.enhance_image_prompt(
            "a small rabbit walking beside a rainy stone bridge, bamboo forest, no text, no letters, no watermark, no logo",
            "ink-wash",
            context="小兔子撑着荷叶伞，在雨后的石桥边慢慢走回家。",
            enabled=True,
        )
        self.assertEqual(len(result.selected_keywords), 3)
        self.assertEqual(len(result.selected_fragments), 3)
        self.assertTrue(all(fragment for fragment in result.selected_fragments))
        self.assertIn("ranked 水墨 style guidance", result.rewritten_prompt)

    def test_visual_consistency_bible_is_injected_before_image_generation(self) -> None:
        pipeline = StorybookPipeline(
            llm_client=FakeChatLlm(),
            image_client=FakeImageClient(),
            tts_client=FakeTtsClient(),
            safety_client=FakeSafetyClient(),
            safety_middleware=SafetyMiddleware(guard_enabled=False),
        )
        scenes, records = pipeline._apply_visual_consistency_to_scenes(
            [
                Scene(
                    scene_no=1,
                    text="安安抱着电脑坐在窗边。",
                    image_prompt="a child sitting beside a window with a laptop, no text, no letters, no watermark, no logo",
                )
            ],
            {
                "characters": [
                    {
                        "role": "主角",
                        "name": "安安",
                        "appearance_anchor_en": "a 6-year-old Chinese child wearing a green jacket",
                    }
                ],
                "key_props": [
                    {
                        "name_zh": "笔记本电脑",
                        "anchor_en": "a slim silver laptop with a rounded rectangle silhouette and no visible logo",
                    }
                ],
                "setting_anchor_en": "a cozy bedroom with a round wooden desk by the window",
            },
        )
        self.assertEqual(len(records), 1)
        prompt = scenes[0].image_prompt
        self.assertIn("CONSISTENT VISUAL BIBLE", prompt)
        self.assertIn("a 6-year-old Chinese child wearing a green jacket", prompt)
        self.assertIn("a slim silver laptop", prompt)
        self.assertIn("PAGE-SPECIFIC SCENE", prompt)

    def test_moon_rabbit_homesick_retrieves_mid_autumn(self) -> None:
        hits = CultureRagService(CORPUS, embedding_enabled=False).retrieve("月亮、小兔、想家", top_k=3)
        self.assertTrue(any("嫦娥" in hit.title or "中秋" in " ".join(hit.visual_motifs) for hit in hits))
        self.assertIn("团圆", CultureRagService(CORPUS, embedding_enabled=False).build_culture_context(hits))

    def test_moon_rabbit_missing_mom_does_not_retrieve_eshou(self) -> None:
        hits = CultureRagService(CORPUS, embedding_enabled=False).retrieve(
            "我想画一个小兔子在月亮上想妈妈的故事",
            top_k=3,
        )
        self.assertTrue(any("嫦娥" in hit.title or "静夜思" in hit.title for hit in hits))
        self.assertFalse(any(hit.id == "eshou" or hit.title == "讹兽" for hit in hits))

    def test_dragon_boat_sachet_river_retrieves_duanwu(self) -> None:
        hits = CultureRagService(CORPUS, embedding_enabled=False).retrieve("龙舟、香包、河边", top_k=3)
        self.assertTrue(any("端午" in hit.integration_prompt or "龙舟" in hit.visual_motifs for hit in hits))

    def test_low_similarity_does_not_force_culture_context(self) -> None:
        service = CultureRagService(CORPUS, embedding_enabled=False)
        hits = service.retrieve("太空机器人和火星电梯", top_k=3)
        self.assertEqual(hits, [])
        self.assertEqual(service.build_culture_context(hits), "")

    def test_watermelon_escape_does_not_force_solar_myths(self) -> None:
        service = CultureRagService(CORPUS, embedding_enabled=False)
        hits = service.retrieve(
            "西瓜 瓜田 乌鸦 逃跑 河流 太阳 夏日 丰收 传说",
            top_k=3,
        )
        self.assertFalse(any(hit.title in {"后羿射日", "夸父追日"} for hit in hits))

    def test_sketch_visual_semantics_join_culture_query(self) -> None:
        async def run_case() -> None:
            culture = CaptureCultureRag()
            agent = build_agent(culture, FakeChatLlm(with_sketch=True))
            await agent.run(
                keywords="孩子的河边游戏",
                style="ink-wash",
                sketch_image_base64="data:image/png;base64,AAAA",
                creation_source="sketch",
            )
            self.assertTrue(any("龙舟" in q and "香包" in q for q in culture.queries))

        asyncio.run(run_case())

    def test_finish_creation_rejects_model_placeholder_scene_text(self) -> None:
        async def run_case() -> None:
            agent = build_agent(CultureRagService(CORPUS, embedding_enabled=False), FakeChatLlm())
            scenes = make_fake_scenes()
            scenes[1]["text_zh"] = "展示内容超出实例化范围"
            body, finished = await agent._dispatch_tool(
                "finish_creation",
                json.dumps(
                    {
                        "title": "长安灯会奇遇记",
                        "story_body_zh": "一家人来到灯会，跟着小灯笼学习互相照顾。",
                        "scenes": scenes,
                    },
                    ensure_ascii=False,
                ),
            )
            payload = json.loads(body)
            self.assertIsNone(finished)
            self.assertEqual(payload["error"], "ValueError")
            self.assertIn("系统/错误占位文本", payload["detail"])

        asyncio.run(run_case())

    def test_final_result_contains_culture_fields_and_rewritten_story(self) -> None:
        async def run_case() -> None:
            culture = CultureRagService(CORPUS, embedding_enabled=False)
            llm = FakeChatLlm()
            agent = build_agent(culture, llm)
            result = await agent.run(
                keywords="月亮、小兔、想家",
                style="ink-wash",
                creation_source="keywords",
            )
            self.assertTrue(result["culture_rag_used"])
            self.assertGreaterEqual(len(result["culture_hits"]), 1)
            self.assertIn("culture_context", result)
            self.assertNotIn("后羿射日后，王母娘娘送给他一颗长生不老药", result["story_text"])
            self.assertIn("禁止照搬", llm.last_story_prompt)

        asyncio.run(run_case())


if __name__ == "__main__":
    unittest.main()
