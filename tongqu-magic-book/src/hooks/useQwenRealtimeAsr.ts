import { useCallback, useMemo, useRef, useState } from "react";
import {
  downsampleBuffer,
  floatTo16BitPCM,
  httpBaseToWebSocketBase,
} from "../lib/audioPcm";

const TARGET_SAMPLE_RATE = 16000;

type MicHandle = {
  ctx: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  proc: ScriptProcessorNode;
  gain: GainNode;
};

function cleanupMic(handle: MicHandle | null) {
  if (!handle) return;
  try {
    handle.proc.disconnect();
    handle.source.disconnect();
    handle.gain.disconnect();
    handle.stream.getTracks().forEach((t) => t.stop());
    void handle.ctx.close();
  } catch {
    /* ignore */
  }
}

/**
 * 连接后端 /api/asr/ws，向百炼 Qwen 实时 ASR 流式发送 16kHz PCM。
 */
export function useQwenRealtimeAsr(apiBase: string | undefined) {
  const [isListening, setIsListening] = useState(false);
  const [serviceReady, setServiceReady] = useState(false);
  const [partial, setPartial] = useState("");
  const [confirmed, setConfirmed] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicHandle | null>(null);
  const busyRef = useRef(false);

  const transcriptForApi = useMemo(
    () => [confirmed, partial].filter((s) => s.trim()).join(" ").trim(),
    [confirmed, partial],
  );

  const displayText = transcriptForApi;

  const startMic = useCallback((ws: WebSocket) => {
    void navigator.mediaDevices
      .getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      .then((stream) => {
        if (wsRef.current !== ws) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const ctx = new AudioContext();
        const inputRate = ctx.sampleRate;
        const source = ctx.createMediaStreamSource(stream);
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        proc.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const input = e.inputBuffer.getChannelData(0);
          const down = downsampleBuffer(input, inputRate, TARGET_SAMPLE_RATE);
          const pcm = floatTo16BitPCM(down);
          ws.send(pcm.buffer);
        };
        const gain = ctx.createGain();
        gain.gain.value = 0;
        source.connect(proc);
        proc.connect(gain);
        gain.connect(ctx.destination);
        micRef.current = { ctx, stream, source, proc, gain };
        void ctx.resume();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`无法使用麦克风：${msg}`);
        setIsListening(false);
        setServiceReady(false);
        busyRef.current = false;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      });
  }, []);

  const startListening = useCallback(() => {
    if (!apiBase || busyRef.current) return;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }

    busyRef.current = true;
    setError(null);
    setPartial("");
    setConfirmed("");
    setIsListening(true);
    setServiceReady(false);

    let ws: WebSocket;
    try {
      const root = httpBaseToWebSocketBase(apiBase);
      ws = new WebSocket(`${root}/api/asr/ws`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setIsListening(false);
      busyRef.current = false;
      return;
    }
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        return;
      }
      const t = msg.type as string;
      if (t === "ready") {
        setServiceReady(true);
        startMic(ws);
        busyRef.current = false;
        return;
      }
      if (t === "partial") {
        setPartial(String(msg.text ?? ""));
        return;
      }
      if (t === "segment") {
        const text = String(msg.text ?? "").trim();
        if (text) {
          setConfirmed((c) => (c ? `${c} ${text}` : text));
          setPartial("");
        }
        return;
      }
      if (t === "error") {
        setError(String(msg.detail ?? "语音识别出错"));
        return;
      }
      if (t === "done") {
        cleanupMic(micRef.current);
        micRef.current = null;
        setPartial("");
        setIsListening(false);
        setServiceReady(false);
        busyRef.current = false;
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };

    ws.onerror = () => {
      setError("语音服务连接失败，请确认后端已启动且已配置 DASHSCOPE_API_KEY");
      busyRef.current = false;
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      cleanupMic(micRef.current);
      micRef.current = null;
      setIsListening(false);
      setServiceReady(false);
      busyRef.current = false;
    };
  }, [apiBase, startMic]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      cleanupMic(micRef.current);
      micRef.current = null;
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "end" }));
        } catch {
          /* ignore */
        }
      }
      setIsListening(false);
      setServiceReady(false);
      return;
    }
    startListening();
  }, [isListening, startListening]);

  return {
    isListening,
    serviceReady,
    partial,
    confirmed,
    transcriptForApi,
    displayText,
    error,
    toggleListening,
  };
}
