from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from config import CONFIG


STYLE_NAME_MAP = {
    "paper-cut": "剪纸",
    "ink-wash": "水墨",
    "shadow-puppet": "皮影",
    "comic": "漫画",
    "剪纸": "剪纸",
    "水墨": "水墨",
    "皮影": "皮影",
    "漫画": "漫画",
}

DEFAULT_TEMPLATE = (
    "原始内容：{prompt}\n"
    "画面风格：{style}\n"
    "风格强化关键词：{keywords}\n"
    "要求：以上关键词只用于强化画面风格、笔触、构图、光感与材质，不新增角色、不改变剧情。"
)

CATEGORY_HINTS = {
    "构图": ["桥", "山", "村", "院", "窗", "森林", "舞台", "戏台", "远处", "中央"],
    "笔触": ["雨", "雾", "云", "风", "雪", "溪", "荷叶", "竹林", "桃花"],
    "材质": ["纸", "窗花", "幕布", "灯", "月光", "水", "石桥"],
    "氛围": ["夜", "月", "晨", "雾", "静静", "春天", "远处", "梦"],
    "色调": ["红", "金", "暖", "灰", "夜", "晨", "彩色"],
    "装饰": ["春节", "灯笼", "窗花", "福字", "香包", "图案", "庙会", "集市"],
    "造型": ["小兔", "小猫", "小狗", "小鹿", "小猴", "狐狸", "机器人", "朋友"],
    "光感": ["夜", "灯", "月", "透光", "发亮", "幕布", "灯光"],
    "空间": ["远处", "后面", "四周", "屏风", "山谷", "院子"],
    "线条": ["跑", "冲", "飞", "滑板", "速度", "比赛"],
    "上色": ["彩色", "明快", "热闹", "校园", "公园", "舞台"],
}


@dataclass(frozen=True)
class EnhancementResult:
    original_prompt: str
    rewritten_prompt: str
    normalized_style: str
    selected_keywords: list[str]
    used_model: bool
    model_error: str | None = None


class StyleKeywordEnhancer:
    """中文纯风格关键词增强器。"""

    def __init__(
        self,
        *,
        bank_path: str | Path | None = None,
        model_dir: str | Path | None = None,
        top_k: int | None = None,
        enabled: bool | None = None,
    ) -> None:
        self._bank_path = Path(bank_path or CONFIG.STYLE_KEYWORD_BANK_PATH)
        self._model_dir = Path(model_dir or CONFIG.STYLE_KEYWORD_MODEL_DIR)
        self._enabled = CONFIG.STYLE_KEYWORD_ENHANCER_ENABLED if enabled is None else enabled
        self._top_k = top_k or CONFIG.STYLE_KEYWORD_TOP_K
        self._bank = self._load_bank(self._bank_path)
        self._prompt_template = str(self._bank.get("prompt_template") or DEFAULT_TEMPLATE)
        self._torch: Any | None = None
        self._tokenizer: Any | None = None
        self._ranker: Any | None = None
        self._device: Any | None = None
        self._model_ready: bool | None = None
        self._model_error: str | None = None

    def enhance(
        self,
        prompt: str,
        style: str,
        *,
        enabled: bool | None = None,
    ) -> EnhancementResult:
        original_prompt = (prompt or "").strip()
        normalized_style = normalize_style(style)
        enhancer_enabled = self._enabled if enabled is None else enabled
        if not enhancer_enabled or not original_prompt:
            return EnhancementResult(
                original_prompt=original_prompt,
                rewritten_prompt=original_prompt,
                normalized_style=normalized_style,
                selected_keywords=[],
                used_model=False,
            )

        candidates = self._get_candidates(normalized_style)
        if not candidates:
            return EnhancementResult(
                original_prompt=original_prompt,
                rewritten_prompt=original_prompt,
                normalized_style=normalized_style,
                selected_keywords=[],
                used_model=False,
            )

        scored = self._score_candidates(original_prompt, normalized_style, candidates)
        selected = [item["keyword"] for item in scored[: min(self._top_k, len(scored))]]
        rewritten_prompt = self._build_prompt(
            prompt=original_prompt,
            style=normalized_style,
            selected_keywords=selected,
        )
        return EnhancementResult(
            original_prompt=original_prompt,
            rewritten_prompt=rewritten_prompt,
            normalized_style=normalized_style,
            selected_keywords=selected,
            used_model=bool(self._model_ready),
            model_error=self._model_error,
        )

    def _load_bank(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {"styles": {}, "prompt_template": DEFAULT_TEMPLATE, "default_top_k": 4}
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)

    def _get_candidates(self, style: str) -> list[dict[str, Any]]:
        style_data = self._bank.get("styles", {}).get(style, {})
        keywords = style_data.get("keywords", [])
        return [item for item in keywords if isinstance(item, dict) and item.get("keyword")]

    def _build_prompt(self, *, prompt: str, style: str, selected_keywords: list[str]) -> str:
        keyword_text = "、".join(selected_keywords) if selected_keywords else "无额外风格强化词"
        return self._prompt_template.format(prompt=prompt, style=style, keywords=keyword_text).strip()

    def _score_candidates(
        self,
        prompt: str,
        style: str,
        candidates: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        model_scores = self._predict_with_model(prompt=prompt, style=style, candidates=candidates)
        if model_scores is not None:
            merged = []
            for candidate, score in zip(candidates, model_scores):
                merged.append({**candidate, "score": float(score)})
            return sorted(merged, key=lambda item: item["score"], reverse=True)

        merged = []
        for candidate in candidates:
            heuristic_score = self._heuristic_score(prompt=prompt, candidate=candidate)
            merged.append({**candidate, "score": heuristic_score})
        return sorted(merged, key=lambda item: item["score"], reverse=True)

    def _heuristic_score(self, *, prompt: str, candidate: dict[str, Any]) -> float:
        lowered = prompt.strip()
        base_score = float(candidate.get("weight", 0.0))
        category = str(candidate.get("category", "")).strip()
        hints = CATEGORY_HINTS.get(category, [])
        hint_hits = sum(1 for token in hints if token and token in lowered)
        keyword = str(candidate.get("keyword", ""))
        keyword_hits = sum(1 for char in keyword if char and char in lowered)
        return base_score + hint_hits * 0.08 + keyword_hits * 0.03

    def _predict_with_model(
        self,
        *,
        prompt: str,
        style: str,
        candidates: list[dict[str, Any]],
    ) -> list[float] | None:
        if not self._ensure_model_loaded():
            return None

        assert self._torch is not None
        assert self._tokenizer is not None
        assert self._ranker is not None
        assert self._device is not None

        from training.modeling.style_keyword_ranker import STYLE_TO_ID

        prompt_texts = [f"风格：{style}。内容：{prompt}"] * len(candidates)
        keyword_texts = [str(item["keyword"]) for item in candidates]
        style_ids = [STYLE_TO_ID.get(style, 0)] * len(candidates)

        prompt_tok = self._tokenizer(
            prompt_texts,
            padding=True,
            truncation=True,
            max_length=96,
            return_tensors="pt",
        )
        keyword_tok = self._tokenizer(
            keyword_texts,
            padding=True,
            truncation=True,
            max_length=16,
            return_tensors="pt",
        )

        batch = {
            "prompt_input_ids": prompt_tok["input_ids"].to(self._device),
            "prompt_attention_mask": prompt_tok["attention_mask"].to(self._device),
            "keyword_input_ids": keyword_tok["input_ids"].to(self._device),
            "keyword_attention_mask": keyword_tok["attention_mask"].to(self._device),
            "style_ids": self._torch.tensor(style_ids, dtype=self._torch.long, device=self._device),
        }
        with self._torch.no_grad():
            logits = self._ranker(**batch)
            scores = self._torch.sigmoid(logits).detach().cpu().tolist()
        return [float(score) for score in scores]

    def _ensure_model_loaded(self) -> bool:
        if self._model_ready is not None:
            return self._model_ready

        self._model_ready = False
        if not self._model_dir.exists():
            self._model_error = f"未找到模型目录：{self._model_dir}"
            return False

        try:
            import torch
            from transformers import AutoTokenizer

            from training.modeling.style_keyword_ranker import StyleKeywordRanker

            tokenizer_dir = self._model_dir / "tokenizer"
            tokenizer_source = tokenizer_dir if tokenizer_dir.exists() else CONFIG.STYLE_KEYWORD_BASE_MODEL

            self._torch = torch
            self._tokenizer = AutoTokenizer.from_pretrained(tokenizer_source)
            self._ranker = StyleKeywordRanker.from_pretrained(self._model_dir, map_location="cpu")
            self._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self._ranker.to(self._device)
            self._ranker.eval()
            self._model_ready = True
            return True
        except Exception as exc:  # noqa: BLE001
            self._model_error = str(exc)
            self._model_ready = False
            self._ranker = None
            return False


def normalize_style(style: str) -> str:
    return STYLE_NAME_MAP.get(style, "水墨")
