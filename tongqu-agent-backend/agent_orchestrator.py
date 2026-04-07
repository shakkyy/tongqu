"""
兼容旧导入：历史代码中的 `agent_orchestrator` 与 `StoryOrchestrator`。

新结构：
- 中枢：`agent.tongqu_agent.TongquAgent`
- 成书流水线（Qwen Plus + Gemini）：`services.story_pipeline.StorybookPipeline`
- 草图 VL：`services.sketch_understanding.SketchUnderstandingService`
- 实时语音识别：`services.asr_realtime`
"""

from __future__ import annotations

import asyncio
import json

from agent.tongqu_agent import TongquAgent, build_default_tongqu_agent

StoryOrchestrator = TongquAgent


def build_default_orchestrator() -> TongquAgent:
    return build_default_tongqu_agent()


async def demo() -> None:
    agent = build_default_tongqu_agent()
    out = await agent.run(keywords="孙悟空+神龟", style="水墨", creation_source="keywords")
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(demo())
