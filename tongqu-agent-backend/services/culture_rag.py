"""
Markdown frontmatter based culture RAG.

The retriever intentionally indexes only metadata/RAG fields from YAML
frontmatter. Story bodies remain human reading material and are not injected
into LLM prompts, which reduces the chance of direct retelling.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import cached_property
from math import sqrt
from pathlib import Path
from typing import Any

from config import CONFIG


FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*", re.DOTALL)

SEARCH_FIELDS = (
    "title",
    "source",
    "category",
    "tags",
    "themes",
    "rag_keywords",
    "core_idea",
    "child_friendly_takeaway",
    "values",
    "visual_motifs",
)

FIELD_WEIGHTS = {
    "title": 1.8,
    "rag_keywords": 2.4,
    "visual_motifs": 2.2,
    "tags": 1.6,
    "themes": 1.25,
    "core_idea": 0.75,
    "child_friendly_takeaway": 0.7,
    "values": 0.45,
    "source": 0.2,
    "category": 0.15,
}


@dataclass
class CultureHit:
    id: str = ""
    title: str = ""
    source: str = ""
    category: str = ""
    score: float = 0.0
    core_idea: str = ""
    child_friendly_takeaway: str = ""
    values: list[str] = field(default_factory=list)
    visual_motifs: list[str] = field(default_factory=list)
    usable_story_seeds: list[str] = field(default_factory=list)
    avoid_direct_copy: list[str] = field(default_factory=list)
    safety_notes: str = ""
    integration_prompt: str = ""

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "source": self.source,
            "category": self.category,
            "score": round(self.score, 4),
            "core_idea": self.core_idea,
            "child_friendly_takeaway": self.child_friendly_takeaway,
            "values": self.values,
            "visual_motifs": self.visual_motifs,
            "usable_story_seeds": self.usable_story_seeds,
            "avoid_direct_copy": self.avoid_direct_copy,
            "safety_notes": self.safety_notes,
            "integration_prompt": self.integration_prompt,
        }

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "category": self.category,
            "score": round(self.score, 4),
            "core_idea": self.core_idea,
            "child_friendly_takeaway": self.child_friendly_takeaway,
            "visual_motifs": self.visual_motifs,
        }


@dataclass
class CultureDocument:
    path: Path
    meta: dict[str, Any]
    search_text: str
    terms: list[str]
    weighted_terms: list[tuple[str, float]]
    embedding_text: str
    embedding: list[float] | None = None


class BgeEmbeddingBackend:
    def __init__(self, model_name: str, *, local_files_only: bool = True) -> None:
        self.model_name = model_name
        self.local_files_only = local_files_only

    @cached_property
    def _model_bundle(self) -> tuple[Any, Any, Any]:
        import torch
        from transformers import AutoModel, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(
            self.model_name,
            local_files_only=self.local_files_only,
        )
        model = AutoModel.from_pretrained(
            self.model_name,
            local_files_only=self.local_files_only,
        )
        model.eval()
        return tokenizer, model, torch

    def encode(self, texts: list[str]) -> list[list[float]]:
        tokenizer, model, torch = self._model_bundle
        if not texts:
            return []
        with torch.no_grad():
            encoded = tokenizer(
                texts,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            )
            output = model(**encoded)
            vectors = output.last_hidden_state[:, 0]
            vectors = torch.nn.functional.normalize(vectors, p=2, dim=1)
        return [[float(x) for x in row] for row in vectors.cpu().tolist()]


def _parse_scalar(raw: str) -> Any:
    value = raw.strip()
    if not value:
        return ""
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [part.strip().strip("\"'") for part in inner.split(",") if part.strip()]
    if value.startswith(("'", '"')) and value.endswith(("'", '"')):
        return value[1:-1]
    return value


def parse_frontmatter(text: str) -> dict[str, Any]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}
    meta: dict[str, Any] = {}
    current_key: str | None = None
    for raw_line in match.group(1).splitlines():
        line = raw_line.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        stripped = line.strip()
        if stripped.startswith("- ") and current_key:
            meta.setdefault(current_key, [])
            if isinstance(meta[current_key], list):
                meta[current_key].append(_parse_scalar(stripped[2:]))
            continue
        if ":" not in line:
            continue
        key, raw_value = line.split(":", 1)
        current_key = key.strip()
        value = raw_value.strip()
        meta[current_key] = [] if value == "" else _parse_scalar(value)
    return meta


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    text = str(value).strip()
    return [text] if text else []


def _as_text(value: Any) -> str:
    if isinstance(value, list):
        return " ".join(str(v) for v in value if str(v).strip())
    return str(value or "").strip()


def _chars(text: str) -> set[str]:
    return {c for c in text if "\u4e00" <= c <= "\u9fff"}


def _cosine(a: list[float] | None, b: list[float] | None) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    denom = sqrt(sum(x * x for x in a)) * sqrt(sum(y * y for y in b))
    if denom <= 0:
        return 0.0
    return max(0.0, sum(x * y for x, y in zip(a, b)) / denom)


class CultureRagService:
    def __init__(
        self,
        corpus_root: str | Path | None = None,
        *,
        min_score: float | None = None,
        embedding_enabled: bool | None = None,
        embedding_backend: BgeEmbeddingBackend | None = None,
    ) -> None:
        self.corpus_root = Path(corpus_root or CONFIG.CULTURE_RAG_CORPUS_PATH)
        self.min_score = CONFIG.CULTURE_RAG_MIN_SCORE if min_score is None else min_score
        self.embedding_enabled = (
            CONFIG.CULTURE_RAG_EMBEDDING_ENABLED
            if embedding_enabled is None
            else embedding_enabled
        )
        self.keyword_weight = CONFIG.CULTURE_RAG_KEYWORD_WEIGHT
        self.embedding_weight = CONFIG.CULTURE_RAG_EMBEDDING_WEIGHT
        self.max_return = CONFIG.CULTURE_RAG_MAX_RETURN
        self.relative_score_drop = CONFIG.CULTURE_RAG_RELATIVE_SCORE_DROP
        self._embedding_backend = embedding_backend
        self._embedding_unavailable_reason: str | None = None
        self._docs: list[CultureDocument] | None = None

    def _get_embedding_backend(self) -> BgeEmbeddingBackend:
        if self._embedding_backend is None:
            self._embedding_backend = BgeEmbeddingBackend(
                CONFIG.CULTURE_RAG_EMBEDDING_MODEL,
                local_files_only=CONFIG.CULTURE_RAG_EMBEDDING_LOCAL_ONLY,
            )
        return self._embedding_backend

    def _load_docs(self) -> list[CultureDocument]:
        if self._docs is not None:
            return self._docs
        docs: list[CultureDocument] = []
        if not self.corpus_root.exists():
            self._docs = []
            return []
        for path in sorted(self.corpus_root.rglob("*.md")):
            try:
                meta = parse_frontmatter(path.read_text(encoding="utf-8"))
            except UnicodeDecodeError:
                continue
            if not meta:
                continue
            parts: list[str] = []
            terms: list[str] = []
            weighted_terms: list[tuple[str, float]] = []
            for field_name in SEARCH_FIELDS:
                value = meta.get(field_name)
                parts.append(_as_text(value))
                values = _as_list(value)
                terms.extend(values)
                weight = FIELD_WEIGHTS.get(field_name, 0.5)
                weighted_terms.extend((item, weight) for item in values)
            embedding_text = "\n".join(
                f"{field_name}: {_as_text(meta.get(field_name))}"
                for field_name in SEARCH_FIELDS
                if _as_text(meta.get(field_name))
            )
            docs.append(
                CultureDocument(
                    path=path,
                    meta=meta,
                    search_text=" ".join(p for p in parts if p).lower(),
                    terms=[t for t in terms if t],
                    weighted_terms=[(t, w) for t, w in weighted_terms if t],
                    embedding_text=embedding_text,
                )
            )
        self._docs = docs
        return docs

    def _ensure_doc_embeddings(self, docs: list[CultureDocument]) -> list[CultureDocument]:
        if not self.embedding_enabled or self._embedding_unavailable_reason:
            return docs
        pending = [doc for doc in docs if doc.embedding is None]
        if not pending:
            return docs
        try:
            vectors = self._get_embedding_backend().encode([doc.embedding_text for doc in pending])
        except Exception as exc:  # noqa: BLE001
            self._embedding_unavailable_reason = str(exc)[:240]
            print(
                "[culture_rag] embedding disabled; "
                f"model={CONFIG.CULTURE_RAG_EMBEDDING_MODEL!r}; reason={self._embedding_unavailable_reason}",
                flush=True,
            )
            return docs
        for doc, vector in zip(pending, vectors):
            doc.embedding = vector
        return docs

    def _keyword_score(self, q: str, doc: CultureDocument) -> tuple[float, int]:
        exact_hits = 0
        weighted = 0.0
        for term, field_weight in doc.weighted_terms:
            t = term.lower()
            if not t:
                continue
            if len(t) < 2:
                continue
            if t in q or q in t:
                exact_hits += 1
                length_bonus = 1.0 if len(t) <= 2 else 1.25
                weighted += field_weight * length_bonus
        query_chars = _chars(q)
        doc_chars = _chars(doc.search_text)
        overlap = len(query_chars & doc_chars) / max(len(query_chars), 1)
        if exact_hits == 0 and overlap < 0.55:
            return 0.0, 0
        score = min(1.0, weighted / 8.0 + overlap * 0.25)
        return score, exact_hits

    def retrieve(self, query: str, top_k: int = 3) -> list[CultureHit]:
        q = (query or "").strip().lower()
        if not q:
            return []
        docs = self._ensure_doc_embeddings(self._load_docs())
        query_embedding: list[float] | None = None
        if self.embedding_enabled and not self._embedding_unavailable_reason:
            try:
                query_embedding = self._get_embedding_backend().encode([q])[0]
            except Exception as exc:  # noqa: BLE001
                self._embedding_unavailable_reason = str(exc)[:240]
                print(
                    "[culture_rag] query embedding disabled; "
                    f"model={CONFIG.CULTURE_RAG_EMBEDDING_MODEL!r}; reason={self._embedding_unavailable_reason}",
                    flush=True,
                )
        scored: list[CultureHit] = []
        for doc in docs:
            keyword_score, exact_hits = self._keyword_score(q, doc)
            embedding_score = _cosine(query_embedding, doc.embedding)
            if keyword_score <= 0 and embedding_score < 0.45:
                continue
            score = (
                self.keyword_weight * keyword_score
                + self.embedding_weight * embedding_score
                if query_embedding is not None
                else keyword_score
            )
            if exact_hits == 0 and keyword_score < 0.25:
                score *= 0.82
            if score < self.min_score:
                continue
            meta = doc.meta
            scored.append(
                CultureHit(
                    id=str(meta.get("id") or doc.path.stem),
                    title=str(meta.get("title") or doc.path.stem),
                    source=str(meta.get("source") or ""),
                    category=str(meta.get("category") or ""),
                    score=score,
                    core_idea=str(meta.get("core_idea") or ""),
                    child_friendly_takeaway=str(meta.get("child_friendly_takeaway") or ""),
                    values=_as_list(meta.get("values")),
                    visual_motifs=_as_list(meta.get("visual_motifs")),
                    usable_story_seeds=_as_list(meta.get("usable_story_seeds")),
                    avoid_direct_copy=_as_list(meta.get("avoid_direct_copy")),
                    safety_notes=str(meta.get("safety_notes") or ""),
                    integration_prompt=str(meta.get("integration_prompt") or ""),
                )
            )
        scored.sort(key=lambda h: h.score, reverse=True)
        if not scored:
            return []
        best = scored[0].score
        limit = max(1, min(top_k, self.max_return))
        return [
            hit
            for hit in scored
            if hit.score >= best - self.relative_score_drop
        ][:limit]

    def build_culture_context(self, hits: list[CultureHit]) -> str:
        if not hits:
            return ""
        blocks: list[str] = []
        for idx, hit in enumerate(hits, start=1):
            blocks.append(
                "\n".join(
                    [
                        f"{idx}. 命中文化主题：{hit.title}（{hit.category}，score={hit.score:.2f}）",
                        f"- 核心思想：{hit.core_idea or '无'}",
                        f"- 儿童友好寓意：{hit.child_friendly_takeaway or '无'}",
                        f"- 可用视觉意象：{'、'.join(hit.visual_motifs) if hit.visual_motifs else '无'}",
                        f"- 可改写方向：{'；'.join(hit.usable_story_seeds) if hit.usable_story_seeds else (hit.integration_prompt or '围绕用户输入轻量融入。')}",
                        f"- 禁止照搬内容：{'；'.join(hit.avoid_direct_copy) if hit.avoid_direct_copy else '不要复述原故事情节、人物关系或原文表达。'}",
                        f"- 安全改写提示：{hit.safety_notes or '保留温暖、积极、儿童友好的表达。'}",
                    ]
                )
            )
        return "\n\n".join(blocks)

    def integration_note(self, hits: list[CultureHit]) -> str:
        if not hits:
            return "本次输入未命中高相关文化条目，故事未强行注入传统文化素材。"
        titles = "、".join(hit.title for hit in hits)
        ideas = "；".join(
            item
            for hit in hits
            for item in [hit.core_idea or hit.child_friendly_takeaway]
            if item
        )
        return (
            f"本次参考了「{titles}」的核心思想与视觉意象"
            f"{'：' + ideas if ideas else ''}。创作时仅作为灵感约束，围绕用户输入重新设计角色、情节与分镜，避免直接复述原始故事。"
        )
