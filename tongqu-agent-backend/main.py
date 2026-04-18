"""
童趣绘梦 HTTP API（FastAPI）

路由层仅负责协议转换；业务由 agent.TongquAgent 与各 services 模块完成。
"""

from __future__ import annotations

import asyncio
import json
from typing import Literal

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent.tongqu_agent import build_default_tongqu_agent
from config import CONFIG

app = FastAPI(title="童趣绘梦 API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class StorybookCreateRequest(BaseModel):
    keywords: str = Field(..., min_length=1, description="故事素材：语音转写、选词拼接或草图引导语")
    style: str = Field(
        default="ink-wash",
        description="paper-cut | ink-wash | shadow-puppet | comic",
    )
    sketch_image_base64: str | None = Field(
        default=None,
        description="草图 data URL；将经 Qwen-VL Plus 理解后并入素材，再交 Qwen Plus 写故事、Gemini 配图",
    )
    sketch_text: str | None = Field(
        default=None,
        description="孩子对自己画的补充说明，与 VL 结果一并作为素材",
    )
    creation_source: Literal["voice", "keywords", "sketch"] | None = Field(
        default=None,
        description="创作来源，用于追踪：voice | keywords | sketch",
    )
    enable_style_keyword_enhancer: bool = Field(
        default=False,
        description="是否启用中文风格关键词增强器，默认关闭",
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/api/asr/ws")
async def asr_realtime_ws(websocket: WebSocket) -> None:
    """语音子模块：收 PCM 音频后调用 qwen3-asr-flash（OpenAI兼容）转写。"""
    await websocket.accept()
    from services.asr_realtime import AsrRealtimeBridge, require_asr_sdk

    if not CONFIG.DASHSCOPE_API_KEY:
        await websocket.send_json({"type": "error", "detail": "未配置 DASHSCOPE_API_KEY"})
        await websocket.close(code=4000)
        return
    try:
        require_asr_sdk()
    except RuntimeError as exc:
        await websocket.send_json({"type": "error", "detail": str(exc)})
        await websocket.close(code=4001)
        return

    bridge = AsrRealtimeBridge(websocket)
    bridge.start_worker()
    try:
        await bridge.wait_ready(timeout=35.0)
    except Exception as exc:  # noqa: BLE001
        try:
            await websocket.send_json({"type": "error", "detail": f"实时识别未就绪: {exc}"})
        except Exception:
            pass
        bridge.end_audio_stream()
        try:
            await asyncio.wait_for(bridge.wait_done(), timeout=20.0)
        except Exception:
            pass
        await websocket.close()
        return

    await websocket.send_json(
        {
            "type": "ready",
            "pcm": {"sample_rate_hz": 16000, "encoding": "pcm_s16le", "channels": 1},
        }
    )

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            chunk = message.get("bytes")
            if chunk is not None:
                bridge.push_audio(chunk)
                continue
            raw_text = message.get("text")
            if raw_text is not None:
                try:
                    data = json.loads(raw_text)
                except json.JSONDecodeError:
                    continue
                if data.get("type") == "end":
                    break
    except WebSocketDisconnect:
        pass
    finally:
        bridge.end_audio_stream()
        try:
            await asyncio.wait_for(bridge.wait_done(), timeout=90.0)
        except Exception:
            pass


@app.post("/api/storybook/create")
async def create_storybook(body: StorybookCreateRequest) -> dict:
    agent = build_default_tongqu_agent()
    return await agent.run(
        keywords=body.keywords,
        style=body.style,
        sketch_image_base64=body.sketch_image_base64,
        sketch_text=body.sketch_text,
        creation_source=body.creation_source,
        enable_style_keyword_enhancer=body.enable_style_keyword_enhancer,
    )
