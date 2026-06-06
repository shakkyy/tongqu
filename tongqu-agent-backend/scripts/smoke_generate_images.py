from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent.tools import StoryPlanningArgs, TongquToolHandlers
from core.clients import GeminiImageClient
from core.clients import DashScopeQwenClient, OpenAITextClient
from core.models import Scene
from config import CONFIG
from services.run_artifacts import RunArtifactRecorder
from services.sketch_service import SketchUnderstandingService
from services.story_pipeline import StorybookPipeline


class DummyTTS:
    async def synthesize(self, text: str, voice: str) -> str:
        raise RuntimeError("DummyTTS is not used by this image smoke test.")


class DummySafety:
    async def scan_text(self, text: str) -> dict[str, Any]:
        return {"passed": True}

    async def scan_image(self, image_url: str) -> dict[str, Any]:
        return {"passed": True}

    async def rewrite_to_safe(self, text: str) -> str:
        return text


def _image_assets(run_file: Path) -> list[str]:
    data = json.loads(run_file.read_text(encoding="utf-8"))
    assets: list[str] = []
    for event in data.get("events", []):
        if event.get("stage") != "image_generation_response":
            continue
        payload = event.get("payload") or {}
        image = payload.get("image_url") or {}
        rel = image.get("relative_path")
        if rel:
            assets.append(str(run_file.parent / rel))
    return assets


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--style", default="ink-wash")
    parser.add_argument("--pages", type=int, default=4)
    parser.add_argument(
        "--prompt",
        default=(
            "孩子画了一台没有品牌标识的银色笔记本电脑，旁边有一个小兔朋友。"
            "他们在温暖的卧室里发现屏幕里透出月光，想把电脑变成通往童话世界的小窗。"
        ),
    )
    args = parser.parse_args()

    user_prompt = args.prompt

    recorder = RunArtifactRecorder(creation_source="smoke-image", style=args.style)
    recorder.record(
        "simulated_user_input",
        {
            "user_prompt": user_prompt,
            "style": args.style,
            "requested_image_count": args.pages,
        },
    )

    text_client = (
        OpenAITextClient()
        if CONFIG.OPENAI_API_KEY and CONFIG.OPENAI_BASE_URL and CONFIG.OPENAI_MODEL
        else DashScopeQwenClient()
    )
    pipeline = StorybookPipeline(
        llm_client=text_client,
        image_client=GeminiImageClient(),
        tts_client=DummyTTS(),
        safety_client=DummySafety(),
    )
    handlers = TongquToolHandlers(SketchUnderstandingService(None), pipeline)
    handlers.set_run_recorder(recorder)

    plan = await handlers.story_planning_tool(
        StoryPlanningArgs(
            core_keywords=user_prompt,
            visual_semantics=None,
            culture_context=None,
            style=args.style,
        )
    )
    requested_pages = max(1, min(args.pages, len(plan.scenes)))
    scenes = [
        Scene(
            scene_no=item.scene_no,
            text=item.text_zh,
            image_prompt=item.image_prompt_en,
        )
        for item in plan.scenes[:requested_pages]
    ]
    visual_consistency = {
        "characters": [item.model_dump() for item in plan.character_script],
        "key_props": [item.model_dump() for item in plan.key_props],
        "setting_anchor_en": plan.setting_anchor_en,
        "source_visual_semantics": user_prompt,
    }
    recorder.record(
        "smoke_story_plan_selected",
        {
            "title": plan.title_zh,
            "outline": plan.outline_zh,
            "positive_values": plan.positive_values,
            "story_body": plan.story_body_zh,
            "selected_scene_count": len(scenes),
            "selected_scenes": [
                {
                    "scene_no": scene.scene_no,
                    "text": scene.text,
                    "image_prompt": scene.image_prompt,
                }
                for scene in scenes
            ],
            "visual_consistency": visual_consistency,
        },
    )
    consistent_scenes, consistency_records = pipeline._apply_visual_consistency_to_scenes(
        scenes,
        visual_consistency,
    )
    recorder.record(
        "visual_consistency_enforcement",
        {
            "visual_consistency": visual_consistency,
            "records": consistency_records,
            "scenes_after_consistency": [
                {
                    "scene_no": scene.scene_no,
                    "text": scene.text,
                    "image_prompt": scene.image_prompt,
                }
                for scene in consistent_scenes
            ],
        },
    )
    image_urls = await pipeline._generate_images_with_retry(
        scenes=consistent_scenes,
        style=args.style,
        run_recorder=recorder,
    )
    assets = _image_assets(recorder.run_file)
    recorder.finish(
        {
            "ok": True,
            "title": plan.title_zh,
            "style": args.style,
            "scene_count": len(consistent_scenes),
            "image_count": len(image_urls),
            "image_assets": assets,
        }
    )
    print(
        json.dumps(
            {
                "ok": True,
                "title": plan.title_zh,
                "run_file": str(recorder.run_file),
                "run_dir": str(recorder.run_dir),
                "image_assets": assets,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
