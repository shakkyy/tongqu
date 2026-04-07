"""中枢与 API 共用的创作来源枚举。"""

from __future__ import annotations

from enum import Enum


class CreationSource(str, Enum):
    """与前端三种创作方式一一对应。"""

    VOICE = "voice"
    KEYWORDS = "keywords"
    SKETCH = "sketch"

    @classmethod
    def from_optional(cls, raw: str | None) -> CreationSource:
        if not raw:
            return cls.KEYWORDS
        try:
            return cls(raw)
        except ValueError:
            return cls.KEYWORDS
