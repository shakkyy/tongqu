"""与各云厂商实现解耦的协议与共用数据结构。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Protocol, Sequence

USER_FACING_FALLBACK = "小精灵累了，请稍后再试"
MAX_IMAGE_RETRY = 2


@dataclass
class Scene:
    """分镜：每页故事文本 + 供 Gemini 使用的画面描述。"""

    scene_no: int
    text: str
    image_prompt: str


class LLMClient(Protocol):
    """Qwen Plus 等：生成结构化故事 JSON。"""

    async def generate(self, prompt: str) -> str:
        ...


class ImageClient(Protocol):
    """Gemini 文生图。"""

    async def generate_image(self, prompt: str, style: str) -> str:
        ...


class TTSClient(Protocol):
    """朗读合成（如阿里云 NLS）。"""

    async def synthesize(self, text: str, voice: str) -> str:
        ...


class SafetyClient(Protocol):
    """内容安全审查。"""

    async def scan_text(self, text: str) -> Dict[str, Any]:
        ...

    async def scan_image(self, image_url: str) -> Dict[str, Any]:
        ...

    async def rewrite_to_safe(self, text: str) -> str:
        ...


class SketchVisionClient(Protocol):
    """Qwen-VL Plus：草图 → 中文描述。"""

    async def describe_sketch(self, image_data_url: str) -> str:
        ...
