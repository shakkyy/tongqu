"""
童趣绘梦 HTTP API（FastAPI）
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent_orchestrator import build_default_orchestrator

app = FastAPI(title="童趣绘梦 API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class StorybookCreateRequest(BaseModel):
    keywords: str = Field(..., min_length=1, description="关键词或灵感描述")
    style: str = Field(
        default="ink-wash",
        description="paper-cut | ink-wash | shadow-puppet | comic",
    )
    sketch_image_base64: str | None = Field(
        default=None,
        description="可选。草图 data URL（data:image/png;base64,...），将先用千问 VL 理解再生成故事；配图仍走 Gemini",
    )
    sketch_text: str | None = Field(
        default=None,
        description="可选。草图模式下孩子自己输入的一小段文字描述，与 VL 理解结果一并作为故事输入",
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/storybook/create")
async def create_storybook(body: StorybookCreateRequest) -> dict:
    orchestrator = build_default_orchestrator()
    return await orchestrator.run(
        keywords=body.keywords,
        style=body.style,
        sketch_image_base64=body.sketch_image_base64,
        sketch_text=body.sketch_text,
    )
