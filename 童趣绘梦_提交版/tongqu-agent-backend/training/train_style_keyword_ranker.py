from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset
from transformers import AutoTokenizer

from training.modeling.style_keyword_ranker import STYLE_TO_ID, StyleKeywordRanker


@dataclass
class PairSample:
    prompt: str
    keyword: str
    style: str
    label: float


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def expand_pair_samples(rows: Iterable[dict[str, Any]]) -> list[PairSample]:
    pairs: list[PairSample] = []
    for row in rows:
        prompt = str(row["prompt"]).strip()
        style = str(row["style"]).strip()
        for keyword in row.get("positive_keywords", []):
            pairs.append(PairSample(prompt=prompt, keyword=str(keyword), style=style, label=1.0))
        for keyword in row.get("negative_keywords", []):
            pairs.append(PairSample(prompt=prompt, keyword=str(keyword), style=style, label=0.0))
    random.shuffle(pairs)
    return pairs


class PairDataset(Dataset[PairSample]):
    def __init__(self, samples: list[PairSample]) -> None:
        self.samples = samples

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> PairSample:
        return self.samples[index]


def build_collate_fn(tokenizer: Any, prompt_max_len: int, keyword_max_len: int):
    def collate(samples: list[PairSample]) -> dict[str, torch.Tensor]:
        prompts = [f"风格：{sample.style}。内容：{sample.prompt}" for sample in samples]
        keywords = [sample.keyword for sample in samples]
        style_ids = [STYLE_TO_ID[sample.style] for sample in samples]
        labels = [sample.label for sample in samples]

        prompt_tok = tokenizer(
            prompts,
            padding=True,
            truncation=True,
            max_length=prompt_max_len,
            return_tensors="pt",
        )
        keyword_tok = tokenizer(
            keywords,
            padding=True,
            truncation=True,
            max_length=keyword_max_len,
            return_tensors="pt",
        )
        return {
            "prompt_input_ids": prompt_tok["input_ids"],
            "prompt_attention_mask": prompt_tok["attention_mask"],
            "keyword_input_ids": keyword_tok["input_ids"],
            "keyword_attention_mask": keyword_tok["attention_mask"],
            "style_ids": torch.tensor(style_ids, dtype=torch.long),
            "labels": torch.tensor(labels, dtype=torch.float32),
        }

    return collate


def move_batch(batch: dict[str, torch.Tensor], device: torch.device) -> dict[str, torch.Tensor]:
    return {key: value.to(device) for key, value in batch.items()}


def evaluate(
    model: nn.Module,
    loader: DataLoader[dict[str, torch.Tensor]],
    device: torch.device,
    criterion: nn.Module,
) -> tuple[float, float]:
    model.eval()
    total_loss = 0.0
    total_correct = 0
    total_count = 0
    with torch.no_grad():
        for batch in loader:
            batch = move_batch(batch, device)
            labels = batch.pop("labels")
            logits = model(**batch)
            loss = criterion(logits, labels)
            probs = torch.sigmoid(logits)
            preds = (probs >= 0.5).float()
            total_loss += loss.item() * labels.size(0)
            total_correct += int((preds == labels).sum().item())
            total_count += labels.size(0)
    if total_count == 0:
        return 0.0, 0.0
    return total_loss / total_count, total_correct / total_count


def split_samples(samples: list[PairSample], val_ratio: float) -> tuple[list[PairSample], list[PairSample]]:
    cut = max(1, int(len(samples) * val_ratio))
    return samples[cut:], samples[:cut]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="训练中文风格关键词排序模型")
    parser.add_argument(
        "--train-file",
        type=Path,
        default=Path("training/datasets/style_keyword_train.jsonl"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("training/artifacts/style_keyword_ranker"),
    )
    parser.add_argument("--base-model", default="BAAI/bge-small-zh-v1.5")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--prompt-max-len", type=int, default=96)
    parser.add_argument("--keyword-max-len", type=int, default=16)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--freeze-encoder", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)

    rows = load_jsonl(args.train_file)
    samples = expand_pair_samples(rows)
    train_samples, val_samples = split_samples(samples, args.val_ratio)

    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    collate_fn = build_collate_fn(
        tokenizer=tokenizer,
        prompt_max_len=args.prompt_max_len,
        keyword_max_len=args.keyword_max_len,
    )

    train_loader = DataLoader(
        PairDataset(train_samples),
        batch_size=args.batch_size,
        shuffle=True,
        collate_fn=collate_fn,
    )
    val_loader = DataLoader(
        PairDataset(val_samples),
        batch_size=args.batch_size,
        shuffle=False,
        collate_fn=collate_fn,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = StyleKeywordRanker.build(base_model_name=args.base_model)
    if args.freeze_encoder:
        for param in model.encoder.parameters():
            param.requires_grad = False
    model.to(device)

    optimizer = torch.optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=args.lr)
    criterion = nn.BCEWithLogitsLoss()

    best_val_loss = float("inf")
    best_epoch = -1
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        total_count = 0
        for batch in train_loader:
            batch = move_batch(batch, device)
            labels = batch.pop("labels")
            logits = model(**batch)
            loss = criterion(logits, labels)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * labels.size(0)
            total_count += labels.size(0)

        train_loss = total_loss / max(total_count, 1)
        val_loss, val_acc = evaluate(model, val_loader, device, criterion)
        print(
            f"epoch={epoch} train_loss={train_loss:.4f} "
            f"val_loss={val_loss:.4f} val_acc={val_acc:.4f}"
        )

        if val_loss <= best_val_loss:
            best_val_loss = val_loss
            best_epoch = epoch
            model.save_pretrained(args.output_dir)
            tokenizer.save_pretrained(args.output_dir / "tokenizer")

    with (args.output_dir / "train_meta.json").open("w", encoding="utf-8") as f:
        json.dump(
            {
                "train_file": str(args.train_file),
                "base_model": args.base_model,
                "epochs": args.epochs,
                "batch_size": args.batch_size,
                "lr": args.lr,
                "best_epoch": best_epoch,
                "best_val_loss": best_val_loss,
                "num_train_pairs": len(train_samples),
                "num_val_pairs": len(val_samples),
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(f"best_epoch={best_epoch} best_val_loss={best_val_loss:.4f}")
    print(f"saved_to={args.output_dir}")


if __name__ == "__main__":
    main()
