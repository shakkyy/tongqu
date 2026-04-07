"""
语音模块：浏览器 PCM → DashScope Omni Realtime（qwen3-asr-flash-realtime 等）→ 文本。

识别结果由前端交给中枢 `TongquAgent`，再进入 Qwen Plus 叙事 + Gemini 配图。
"""

from __future__ import annotations

import asyncio
import base64
import queue
import threading
import traceback
from typing import Any, Optional

from config import CONFIG

try:
    from dashscope.audio.qwen_omni import (
        MultiModality,
        OmniRealtimeCallback,
        OmniRealtimeConversation,
    )
    from dashscope.audio.qwen_omni.omni_realtime import TranscriptionParams
except ImportError as e:  # pragma: no cover
    OmniRealtimeConversation = None  # type: ignore[misc, assignment]
    OmniRealtimeCallback = object  # type: ignore[misc, assignment]
    MultiModality = None  # type: ignore[misc, assignment]
    TranscriptionParams = None  # type: ignore[misc, assignment]
    _IMPORT_ERROR = e
else:
    _IMPORT_ERROR = None


class _DashScopeAsrCallback(OmniRealtimeCallback):  # type: ignore[misc, valid-type]
    """在 DashScope 回调线程里把事件投递回 asyncio 主循环。"""

    def __init__(
        self,
        loop: asyncio.AbstractEventLoop,
        emit_json: Any,
        mark_ready: Any,
    ) -> None:
        self._loop = loop
        self._emit_json = emit_json
        self._mark_ready = mark_ready
        self._ready_sent = False

    def on_open(self) -> None:
        pass

    def on_close(self, code: Any, msg: Any) -> None:
        self._loop.call_soon_threadsafe(
            self._emit_json,
            {"type": "asr_closed", "code": code, "msg": str(msg) if msg else ""},
        )

    def on_event(self, message: Any) -> None:
        if not isinstance(message, dict):
            return
        try:
            etype = message.get("type")
            if etype == "session.updated":
                if not self._ready_sent:
                    self._ready_sent = True
                    self._mark_ready()
            elif etype == "session.created":
                pass
            elif etype == "conversation.item.input_audio_transcription.completed":
                text = (message.get("transcript") or "").strip()
                self._emit_json({"type": "segment", "text": text})
            elif etype == "conversation.item.input_audio_transcription.text":
                partial = message.get("stash") or message.get("text") or ""
                self._emit_json({"type": "partial", "text": str(partial)})
            elif etype == "error":
                self._emit_json(
                    {
                        "type": "error",
                        "detail": str(message.get("message") or message.get("error") or message),
                    }
                )
        except Exception:
            self._emit_json({"type": "error", "detail": "回调处理异常"})


def require_asr_sdk() -> None:
    if _IMPORT_ERROR is not None:
        raise RuntimeError(
            "实时语音需要 dashscope>=1.25.6，请执行：pip install -U 'dashscope>=1.25.6'"
        ) from _IMPORT_ERROR
    assert OmniRealtimeConversation is not None


# 兼容旧导入名
_require_asr_sdk = require_asr_sdk


class AsrRealtimeBridge:
    """在独立线程中跑 OmniRealtimeConversation；主协程通过 queue 收 PCM 字节。"""

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
        import dashscope

        try:
            require_asr_sdk()
            assert CONFIG.DASHSCOPE_API_KEY
            dashscope.api_key = CONFIG.DASHSCOPE_API_KEY

            cb = _DashScopeAsrCallback(
                self._loop,
                self._emit_json_sync,
                self._mark_ready,
            )
            assert OmniRealtimeConversation is not None
            assert TranscriptionParams is not None
            assert MultiModality is not None

            conv = OmniRealtimeConversation(
                model=CONFIG.QWEN_ASR_REALTIME_MODEL,
                callback=cb,
                url=CONFIG.DASHSCOPE_REALTIME_WSS_URL.rstrip("/"),
                api_key=CONFIG.DASHSCOPE_API_KEY,
            )
            conv.connect()
            transcription_params = TranscriptionParams(
                language="zh",
                sample_rate=16000,
                input_audio_format="pcm",
            )
            conv.update_session(
                output_modalities=[MultiModality.TEXT],
                enable_turn_detection=True,
                turn_detection_type="server_vad",
                turn_detection_threshold=0.0,
                turn_detection_silence_duration_ms=400,
                enable_input_audio_transcription=True,
                transcription_params=transcription_params,
            )

            def _fallback_ready() -> None:
                import time

                time.sleep(3.0)
                self._mark_ready()

            threading.Thread(target=_fallback_ready, daemon=True).start()

            while True:
                try:
                    chunk = self._audio_q.get(timeout=0.25)
                except queue.Empty:
                    continue
                if chunk is None:
                    break
                if chunk:
                    b64 = base64.standard_b64encode(chunk).decode("ascii")
                    conv.append_audio(b64)

            conv.end_session(timeout=30)
            conv.close()
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
