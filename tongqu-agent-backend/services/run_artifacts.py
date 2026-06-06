from __future__ import annotations

import base64
import hashlib
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from config import CONFIG


_DATA_URL_RE = re.compile(r"^data:([^;]+);base64,(.*)$", re.DOTALL)
_SECRET_KEY_PARTS = ("api_key", "apikey", "secret", "token", "authorization", "password")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def timestamp_id() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]


def _extension_for_mime(mime: str) -> str:
    return {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/webp": ".webp",
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/wav": ".wav",
        "audio/aac": ".aac",
    }.get(mime.lower(), ".bin")


class RunArtifactRecorder:
    """Collects one storybook run's inputs, prompt chain, responses and outputs."""

    def __init__(self, *, creation_source: str, style: str) -> None:
        safe_source = re.sub(r"[^a-zA-Z0-9_-]+", "_", creation_source or "unknown")
        safe_style = re.sub(r"[^a-zA-Z0-9_-]+", "_", style or "style")
        self.run_id = f"{timestamp_id()}_{safe_source}_{safe_style}_{uuid4().hex[:8]}"
        self.run_dir = Path(CONFIG.RUN_ARTIFACT_DIR) / self.run_id
        self.assets_dir = self.run_dir / "assets"
        self.run_file = self.run_dir / "run.json"
        self._lock = threading.Lock()
        self._events: list[dict[str, Any]] = []
        self._asset_counter = 0
        self._data: dict[str, Any] = {
            "run_id": self.run_id,
            "started_at": utc_now_iso(),
            "finished_at": None,
            "creation_source": creation_source,
            "style": style,
            "events": self._events,
        }
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        self.flush()

    @classmethod
    def maybe_create(cls, *, creation_source: str, style: str) -> "RunArtifactRecorder | None":
        if not CONFIG.RUN_ARTIFACTS_ENABLED:
            return None
        return cls(creation_source=creation_source, style=style)

    def record(self, stage: str, payload: Any) -> None:
        with self._lock:
            event = {
                "idx": len(self._events) + 1,
                "time": utc_now_iso(),
                "stage": stage,
                "payload": self._sanitize(payload, path=stage),
            }
            self._events.append(event)
            self.flush()

    def finish(self, result: Any | None = None) -> None:
        with self._lock:
            if result is not None:
                event = {
                    "idx": len(self._events) + 1,
                    "time": utc_now_iso(),
                    "stage": "final_result",
                    "payload": self._sanitize(result, path="final_result"),
                }
                self._events.append(event)
            self._data["finished_at"] = utc_now_iso()
            self.flush()

    def flush(self) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        with self.run_file.open("w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)
            f.write("\n")

    def _save_data_url(self, data_url: str, *, path: str) -> dict[str, Any]:
        match = _DATA_URL_RE.match(data_url)
        if not match:
            return {
                "kind": "long_data_url",
                "length": len(data_url),
                "sha256": hashlib.sha256(data_url.encode("utf-8")).hexdigest(),
            }
        mime = match.group(1)
        b64 = match.group(2).strip()
        try:
            raw = base64.b64decode(b64, validate=False)
        except Exception:
            return {
                "kind": "invalid_data_url",
                "mime": mime,
                "length": len(data_url),
                "sha256": hashlib.sha256(data_url.encode("utf-8")).hexdigest(),
            }
        self._asset_counter += 1
        safe_path = re.sub(r"[^a-zA-Z0-9_-]+", "_", path)[-80:] or "asset"
        filename = f"{self._asset_counter:04d}_{safe_path}{_extension_for_mime(mime)}"
        out = self.assets_dir / filename
        out.write_bytes(raw)
        return {
            "kind": "data_url_asset",
            "mime": mime,
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "relative_path": str(out.relative_to(self.run_dir)),
        }

    def _sanitize(self, value: Any, *, path: str) -> Any:
        if isinstance(value, dict):
            out: dict[str, Any] = {}
            for key, item in value.items():
                key_s = str(key)
                lower = key_s.lower()
                if any(part in lower for part in _SECRET_KEY_PARTS):
                    out[key_s] = "***masked***" if item else item
                    continue
                out[key_s] = self._sanitize(item, path=f"{path}_{key_s}")
            return out
        if isinstance(value, list):
            return [self._sanitize(item, path=f"{path}_{idx}") for idx, item in enumerate(value)]
        if isinstance(value, tuple):
            return [self._sanitize(item, path=f"{path}_{idx}") for idx, item in enumerate(value)]
        if isinstance(value, str):
            if value.startswith("data:") and ";base64," in value[:80]:
                return self._save_data_url(value, path=path)
            return value
        if isinstance(value, (int, float, bool)) or value is None:
            return value
        return repr(value)
