from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import torch
from torch import nn
from transformers import AutoModel


STYLE_TO_ID = {
    "剪纸": 0,
    "水墨": 1,
    "皮影": 2,
    "漫画": 3,
}

ID_TO_STYLE = {value: key for key, value in STYLE_TO_ID.items()}


def masked_mean_pool(hidden_state: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
    mask = attention_mask.unsqueeze(-1).to(hidden_state.dtype)
    masked = hidden_state * mask
    denom = mask.sum(dim=1).clamp(min=1.0)
    return masked.sum(dim=1) / denom


@dataclass
class StyleKeywordRankerConfig:
    base_model_name: str = "BAAI/bge-small-zh-v1.5"
    num_styles: int = 4
    style_embedding_dim: int = 32
    attention_heads: int = 4
    dropout: float = 0.1


class StyleKeywordRanker(nn.Module):
    """共享 encoder + cross attention + 打分头。"""

    def __init__(
        self,
        encoder: nn.Module,
        config: StyleKeywordRankerConfig,
    ) -> None:
        super().__init__()
        self.encoder = encoder
        self.config = config
        hidden_size = int(getattr(self.encoder.config, "hidden_size"))

        self.style_embedding = nn.Embedding(config.num_styles, config.style_embedding_dim)
        self.cross_attention = nn.MultiheadAttention(
            embed_dim=hidden_size,
            num_heads=config.attention_heads,
            dropout=config.dropout,
            batch_first=True,
        )
        self.dropout = nn.Dropout(config.dropout)
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size * 5 + config.style_embedding_dim, hidden_size),
            nn.GELU(),
            nn.Dropout(config.dropout),
            nn.Linear(hidden_size, 1),
        )

    @classmethod
    def build(
        cls,
        base_model_name: str = "BAAI/bge-small-zh-v1.5",
        **kwargs: Any,
    ) -> "StyleKeywordRanker":
        config = StyleKeywordRankerConfig(base_model_name=base_model_name, **kwargs)
        encoder = AutoModel.from_pretrained(base_model_name)
        return cls(encoder=encoder, config=config)

    def forward(
        self,
        *,
        prompt_input_ids: torch.Tensor,
        prompt_attention_mask: torch.Tensor,
        keyword_input_ids: torch.Tensor,
        keyword_attention_mask: torch.Tensor,
        style_ids: torch.Tensor,
    ) -> torch.Tensor:
        prompt_outputs = self.encoder(
            input_ids=prompt_input_ids,
            attention_mask=prompt_attention_mask,
            return_dict=True,
        )
        keyword_outputs = self.encoder(
            input_ids=keyword_input_ids,
            attention_mask=keyword_attention_mask,
            return_dict=True,
        )

        prompt_hidden = prompt_outputs.last_hidden_state
        keyword_hidden = keyword_outputs.last_hidden_state

        attended_keyword, _ = self.cross_attention(
            query=keyword_hidden,
            key=prompt_hidden,
            value=prompt_hidden,
            key_padding_mask=~prompt_attention_mask.bool(),
        )

        prompt_pooled = masked_mean_pool(prompt_hidden, prompt_attention_mask)
        keyword_pooled = masked_mean_pool(keyword_hidden, keyword_attention_mask)
        attended_keyword_pooled = masked_mean_pool(attended_keyword, keyword_attention_mask)
        style_vec = self.style_embedding(style_ids)

        merged = torch.cat(
            [
                prompt_pooled,
                keyword_pooled,
                attended_keyword_pooled,
                prompt_pooled * keyword_pooled,
                torch.abs(prompt_pooled - keyword_pooled),
                style_vec,
            ],
            dim=-1,
        )
        logits = self.classifier(self.dropout(merged)).squeeze(-1)
        return logits

    def save_pretrained(self, output_dir: str | Path) -> None:
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        encoder_dir = out / "encoder"
        self.encoder.save_pretrained(encoder_dir)
        with (out / "ranker_config.json").open("w", encoding="utf-8") as f:
            json.dump(asdict(self.config), f, ensure_ascii=False, indent=2)
        torch.save(self.state_dict(), out / "ranker_state.pt")

    @classmethod
    def from_pretrained(
        cls,
        model_dir: str | Path,
        *,
        map_location: str | torch.device = "cpu",
    ) -> "StyleKeywordRanker":
        model_path = Path(model_dir)
        with (model_path / "ranker_config.json").open("r", encoding="utf-8") as f:
            raw_config = json.load(f)
        config = StyleKeywordRankerConfig(**raw_config)
        encoder_source = model_path / "encoder"
        encoder = AutoModel.from_pretrained(encoder_source)
        model = cls(encoder=encoder, config=config)
        state_dict = torch.load(model_path / "ranker_state.pt", map_location=map_location)
        model.load_state_dict(state_dict)
        return model
