import { useRef, useEffect, useState, forwardRef, useImperativeHandle, useCallback } from "react";
import { PenTool, Trash2, Wand2, Undo2, Eraser, PaintBucket, Pencil } from "lucide-react";
import { floodFillImageData } from "../lib/canvasFloodFill";

export type SketchPadHandle = {
  getDataURL: () => string | null;
};

type SketchTool = "pen" | "eraser" | "fill";

interface SketchPadProps {
  isGenerating?: boolean;
  progressText?: string;
}

const COLORS = [
  { hex: "#1a1a2e", name: "墨" },
  { hex: "#374151", name: "铁灰" },
  { hex: "#78716c", name: "石" },
  { hex: "#e63946", name: "朱" },
  { hex: "#ff6b6b", name: "珊瑚" },
  { hex: "#f72585", name: "玫" },
  { hex: "#c2185b", name: "胭脂" },
  { hex: "#fb8500", name: "橙" },
  { hex: "#f4a261", name: "杏" },
  { hex: "#ffbe0b", name: "金" },
  { hex: "#a16207", name: "赭" },
  { hex: "#5d4037", name: "咖" },
  { hex: "#2a9d8f", name: "青" },
  { hex: "#0d9488", name: "碧" },
  { hex: "#06d6a0", name: "翠" },
  { hex: "#65a30d", name: "草" },
  { hex: "#457b9d", name: "蓝" },
  { hex: "#0284c7", name: "湖" },
  { hex: "#4cc9f0", name: "天" },
  { hex: "#8338ec", name: "紫" },
  { hex: "#7b2cbf", name: "堇" },
  { hex: "#b5e48c", name: "芽" },
];

const BRUSHES: { label: string; width: number }[] = [
  { label: "细", width: 3 },
  { label: "中", width: 8 },
  { label: "粗", width: 16 },
];

const W = 1000;
const H = 600;
const MAX_HISTORY = 35;

function cloneImageData(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const SketchPad = forwardRef<SketchPadHandle, SketchPadProps>(function SketchPad(
  { isGenerating = false, progressText = "" },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<ImageData[]>([]);
  const redoRef = useRef<ImageData[]>([]);
  const [nav, setNav] = useState({ canUndo: false, canRedo: false });
  const isDrawingRef = useRef(false);
  const [tool, setTool] = useState<SketchTool>("pen");
  const [color, setColor] = useState(COLORS[0].hex);
  const [brushIdx, setBrushIdx] = useState(1);

  const getCtx = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  };

  const snapshot = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return null;
    return cloneImageData(ctx.getImageData(0, 0, W, H));
  }, []);

  const putSnapshot = useCallback((data: ImageData) => {
    const ctx = getCtx();
    if (!ctx) return;
    ctx.putImageData(data, 0, 0);
  }, []);

  const syncNav = useCallback(() => {
    setNav({
      canUndo: historyRef.current.length > 1,
      canRedo: redoRef.current.length > 0,
    });
  }, []);

  const commitState = useCallback(() => {
    const s = snapshot();
    if (!s) return;
    historyRef.current.push(s);
    redoRef.current = [];
    while (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.splice(1, 1);
    }
    syncNav();
  }, [snapshot, syncNav]);

  const undo = useCallback(() => {
    if (historyRef.current.length <= 1) return;
    const cur = snapshot();
    if (cur) redoRef.current.push(cur);
    historyRef.current.pop();
    const prev = historyRef.current[historyRef.current.length - 1];
    if (prev) putSnapshot(prev);
    syncNav();
  }, [snapshot, putSnapshot, syncNav]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push(next);
    putSnapshot(next);
    syncNav();
  }, [putSnapshot, syncNav]);

  const clearCanvas = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    historyRef.current = [];
    redoRef.current = [];
    const s = snapshot();
    if (s) historyRef.current.push(s);
    syncNav();
  }, [snapshot, syncNav]);

  useImperativeHandle(ref, () => ({
    getDataURL: () => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      try {
        return canvas.toDataURL("image/png");
      } catch {
        return null;
      }
    },
  }));

  useEffect(() => {
    const ctx = getCtx();
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    const s = snapshot();
    if (s) {
      historyRef.current = [s];
      redoRef.current = [];
      setNav({ canUndo: false, canRedo: false });
    }
  }, [snapshot]);

  /** 画布为 object-contain 时，实际绘制区小于元素框，需按内容区换算坐标 */
  const getCanvasCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / W, rect.height / H);
    const displayW = W * scale;
    const displayH = H * scale;
    const offsetX = rect.left + (rect.width - displayW) / 2;
    const offsetY = rect.top + (rect.height - displayH) / 2;
    let x = ((clientX - offsetX) * W) / displayW;
    let y = ((clientY - offsetY) * H) / displayH;
    x = Math.max(0, Math.min(W - 0.001, x));
    y = Math.max(0, Math.min(H - 0.001, y));
    return { x, y };
  }, []);

  const applyFill = (x: number, y: number) => {
    const ctx = getCtx();
    if (!ctx) return;
    const [fr, fg, fb] = hexToRgb(color);
    const img = ctx.getImageData(0, 0, W, H);
    floodFillImageData(img, W, H, x, y, fr, fg, fb, 32);
    ctx.putImageData(img, 0, 0);
    commitState();
  };

  const startDrawingFromClient = (clientX: number, clientY: number) => {
    if (isGenerating) return;
    if (tool === "fill") {
      const { x, y } = getCanvasCoords(clientX, clientY);
      applyFill(x, y);
      return;
    }
    isDrawingRef.current = true;
    const ctx = getCtx();
    if (!ctx) return;
    const { x, y } = getCanvasCoords(clientX, clientY);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const lw = BRUSHES[brushIdx].width;
    if (tool === "eraser") {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(lw, 12);
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
    }
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    startDrawingFromClient(e.clientX, e.clientY);
  };

  const stopDrawing = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const ctx = getCtx();
    if (!ctx) return;
    ctx.beginPath();
    commitState();
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || tool === "fill") return;
    const ctx = getCtx();
    if (!ctx) return;
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const brush = BRUSHES[brushIdx];

  return (
    <div className="flex-1 w-full h-full flex flex-col gap-2 p-3 lg:p-4 font-classical min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <h3 className="text-lg lg:text-xl font-bold text-cn-ink font-classical flex items-center gap-2">
          <PenTool className="w-5 h-5 text-cn-blue shrink-0" strokeWidth={2.5} />
          草图绘梦板
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={undo}
            disabled={isGenerating || !nav.canUndo}
            title="撤回上一笔"
            className="flex items-center gap-1 px-2 py-1 border-2 border-cn-ink rounded-lg bg-white hover:bg-cn-yellow text-xs font-bold disabled:opacity-40"
          >
            <Undo2 className="w-3.5 h-3.5" />
            撤回
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={isGenerating || !nav.canRedo}
            title="重做"
            className="flex items-center gap-1 px-2 py-1 border-2 border-cn-ink rounded-lg bg-white hover:bg-cn-azure hover:text-white text-xs font-bold disabled:opacity-40"
          >
            重做
          </button>
          <button
            type="button"
            onClick={clearCanvas}
            disabled={isGenerating}
            className="flex items-center gap-1 px-2 py-1 border-2 border-cn-ink rounded-lg bg-white hover:bg-cn-red hover:text-white text-xs font-bold"
          >
            <Trash2 className="w-3.5 h-3.5" />
            清空
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 flex-shrink-0 border border-cn-ink/20 rounded-xl p-2 bg-cn-paper/40">
        <span className="text-[10px] font-bold text-cn-ink/70 w-full sm:w-auto">工具</span>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setTool("pen")}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border-2 text-[10px] font-bold ${
              tool === "pen" ? "border-cn-red bg-cn-red text-white" : "border-cn-ink bg-white"
            }`}
          >
            <Pencil className="w-3 h-3" />
            画笔
          </button>
          <button
            type="button"
            onClick={() => setTool("eraser")}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border-2 text-[10px] font-bold ${
              tool === "eraser" ? "border-cn-red bg-cn-red text-white" : "border-cn-ink bg-white"
            }`}
          >
            <Eraser className="w-3 h-3" />
            橡皮
          </button>
          <button
            type="button"
            onClick={() => setTool("fill")}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border-2 text-[10px] font-bold ${
              tool === "fill" ? "border-cn-red bg-cn-red text-white" : "border-cn-ink bg-white"
            }`}
          >
            <PaintBucket className="w-3 h-3" />
            上色
          </button>
        </div>
        <span className="text-[10px] font-bold text-cn-ink/70 sm:ml-2">粗细</span>
        <div className="flex gap-1">
          {BRUSHES.map((b, i) => (
            <button
              key={b.label}
              type="button"
              disabled={tool === "fill"}
              onClick={() => setBrushIdx(i)}
              className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${
                brushIdx === i ? "border-cn-ink bg-cn-yellow" : "border-cn-ink/40 bg-white"
              } disabled:opacity-40`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        <span className="text-[10px] font-bold text-cn-ink/70">颜色</span>
        <div className="flex flex-wrap gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              title={c.name}
              disabled={tool === "eraser"}
              onClick={() => setColor(c.hex)}
              className={`w-7 h-7 rounded-full border-2 shadow-sm transition-transform hover:scale-110 ${
                color === c.hex ? "border-cn-ink ring-2 ring-cn-red scale-110" : "border-white"
              } disabled:opacity-50`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
      </div>

      <div
        className={`flex-1 relative border-handdrawn overflow-hidden shadow-kid bg-white min-h-[240px] rounded-lg ${
          tool === "fill" ? "cursor-cell" : "cursor-crosshair"
        }`}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="w-full h-full object-contain touch-none"
          onMouseDown={startDrawing}
          onMouseUp={stopDrawing}
          onMouseOut={stopDrawing}
          onMouseMove={draw}
          onTouchStart={(e) => {
            e.preventDefault();
            const t = e.changedTouches[0];
            if (t) startDrawingFromClient(t.clientX, t.clientY);
          }}
          onTouchMove={(e) => {
            e.preventDefault();
            const t = e.changedTouches[0];
            if (!t || !isDrawingRef.current || tool === "fill") return;
            const ctx = getCtx();
            if (!ctx) return;
            const { x, y } = getCanvasCoords(t.clientX, t.clientY);
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, y);
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            stopDrawing();
          }}
          onTouchCancel={(e) => {
            e.preventDefault();
            stopDrawing();
          }}
        />
        <div className="absolute inset-0 bg-paper-texture opacity-20 pointer-events-none mix-blend-multiply" />
        {isGenerating && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-white/90 backdrop-blur-sm border-2 border-cn-yellow/50">
            <div className="w-16 h-16 rounded-full bg-cn-yellow/30 flex items-center justify-center border-2 border-dashed border-cn-yellow animate-spin">
              <Wand2 className="w-8 h-8 text-cn-yellow animate-pulse" />
            </div>
            <p className="text-base lg:text-lg font-classical font-bold text-cn-ink tracking-wide text-center px-6 max-w-md">
              {progressText || "魔法进行中…"}
            </p>
            <p className="text-xs text-cn-ink/60 text-center px-8 max-w-md">
              真实接口需依次生成故事、多页配图与语音，可能需要 1～3 分钟，请稍候。
            </p>
          </div>
        )}
      </div>

      <p className="text-center text-slate-500 font-bold text-[10px] leading-relaxed px-1 flex-shrink-0">
        画好后在左侧点「开始变魔术」：后端会先用阿里云千问 VL 读图成文字，再写故事；配图由 Gemini 生成。
        「上色」为油漆桶；画笔/橡皮以一笔为单位撤回。
      </p>
    </div>
  );
});
