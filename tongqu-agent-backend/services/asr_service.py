"""
语音模块：浏览器 PCM（16kHz s16le）→ OpenAI 兼容 DashScope ASR（qwen3-asr-flash）→ 文本。

说明：
- 前端与路由仍复用 `/api/asr/ws` 协议（ready / segment / done）。
- 识别策略改为“录音结束后一次性转写”，不再依赖 Omni Realtime SDK。
"""

from __future__ import annotations

import asyncio
import base64
import io
import queue
import threading
import traceback
import wave
from typing import Any, Optional

from config import CONFIG

try:
    from openai import OpenAI
except ImportError as e:  # pragma: no cover
    OpenAI = None  # type: ignore[misc, assignment]
    _IMPORT_ERROR = e
else:
    _IMPORT_ERROR = None


def require_asr_sdk() -> None:
    if _IMPORT_ERROR is not None:
        raise RuntimeError("语音识别需要 openai SDK，请执行：pip install openai") from _IMPORT_ERROR
    if not CONFIG.DASHSCOPE_API_KEY:
        raise RuntimeError("未配置 DASHSCOPE_API_KEY")


# 兼容旧导入名
_require_asr_sdk = require_asr_sdk


def _pcm16le_to_wav_bytes(pcm: bytes, sample_rate: int = 16000) -> bytes:
    """将前端上传的 PCM s16le 单声道字节流封装为 WAV。"""
    bio = io.BytesIO()
    with wave.open(bio, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return bio.getvalue()


def _extract_completion_text(resp: Any) -> str:
    if not getattr(resp, "choices", None):
        return ""
    msg = resp.choices[0].message
    content = getattr(msg, "content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                t = item.get("text")
                if t:
                    parts.append(str(t))
        return "".join(parts).strip()
    return ""


class AsrRealtimeBridge:
    """在独立线程收集 PCM，并在结束后调用 qwen3-asr-flash 转写。"""

    def __init__(self, websocket: Any) -> None:
        self._websocket = websocket
        self._loop = asyncio.get_running_loop()
        self._audio_q: queue.Queue[Optional[bytes]] = queue.Queue(maxsize=512)
        self._ready: asyncio.Future[None] = self._loop.create_future()
        self._done: asyncio.Future[None] = self._loop.create_future()
        self._thread: Optional[threading.Thread] = None

    def _emit_json_sync(self, payload: dict[str, Any]) -> None:
        async def _send() -> None:
            try:
                await self._websocket.send_json(payload)
            except Exception:
                pass

        asyncio.run_coroutine_threadsafe(_send(), self._loop)

    def _mark_ready(self) -> None:
        def _cb() -> None:
            if not self._ready.done():
                self._ready.set_result(None)

        self._loop.call_soon_threadsafe(_cb)

    def _mark_error_to_ready(self, msg: str) -> None:
        def _cb() -> None:
            if not self._ready.done():
                self._ready.set_exception(RuntimeError(msg))

        self._loop.call_soon_threadsafe(_cb)

    def _mark_done(self) -> None:
        def _cb() -> None:
            if not self._done.done():
                self._done.set_result(None)

        self._loop.call_soon_threadsafe(_cb)

    def _worker(self) -> None:
        try:
            require_asr_sdk()
            self._mark_ready()
            chunks: list[bytes] = []

            while True:
                try:
                    chunk = self._audio_q.get(timeout=0.25)
                except queue.Empty:
                    continue
                if chunk is None:
                    break
                if chunk:
                    chunks.append(chunk)

            audio_bytes = b"".join(chunks)
            if not audio_bytes:
                self._emit_json_sync({"type": "segment", "text": ""})
                return

            wav_bytes = _pcm16le_to_wav_bytes(audio_bytes, sample_rate=16000)
            wav_b64 = base64.b64encode(wav_bytes).decode("ascii")
            compat_url = (
                CONFIG.DASHSCOPE_COMPAT_BASE_URL
                or "https://dashscope.aliyuncs.com/compatible-mode/v1"
            )
            model = CONFIG.QWEN_ASR_MODEL
            assert OpenAI is not None
            client = OpenAI(api_key=CONFIG.DASHSCOPE_API_KEY, base_url=compat_url)
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_audio",
                                "input_audio": {
                                    "data": f"data:audio/wav;base64,{wav_b64}",
                                },
                            }
                        ],
                    }
                ],
                stream=False,
                extra_body={
                    "asr_options": {
                        "enable_itn": False,
                    }
                },
            )
            text = _extract_completion_text(resp)
            self._emit_json_sync({"type": "segment", "text": text})
        except Exception as e:
            self._emit_json_sync(
                {
                    "type": "error",
                    "detail": str(e),
                    "trace": traceback.format_exc()[-2000:],
                }
            )
            self._mark_error_to_ready(str(e))
        finally:
            self._emit_json_sync({"type": "done"})
            self._mark_done()

    def start_worker(self) -> None:
        self._thread = threading.Thread(target=self._worker, daemon=True)
        self._thread.start()

    async def wait_ready(self, timeout: float = 30.0) -> None:
        await asyncio.wait_for(self._ready, timeout=timeout)

    def push_audio(self, data: bytes) -> None:
        try:
            self._audio_q.put_nowait(data)
        except queue.Full:
            pass

    def end_audio_stream(self) -> None:
        try:
            self._audio_q.put_nowait(None)
        except Exception:
            pass

    async def wait_done(self, timeout: float = 90.0) -> None:
        await asyncio.wait_for(self._done, timeout=timeout)
