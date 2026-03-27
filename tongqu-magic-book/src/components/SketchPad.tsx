import { useRef, useEffect, useState } from "react";
import { PenTool, Trash2 } from "lucide-react";

export function SketchPad() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false }); // 优化：禁用 alpha 通道以提升 Canvas 性能
    if (!ctx) return;

    // Fill white background
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const startDrawing = (e: React.MouseEvent) => {
    setIsDrawing(true);
    draw(e);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
  };

  const draw = (e: React.MouseEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width); // 修正坐标缩放
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#2C3E50";

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="flex-1 w-full h-full flex flex-col gap-4 p-8 font-classical">
      <div className="flex items-center justify-between">
        <h3 className="text-3xl font-bold text-cn-ink font-classical flex items-center gap-3">
          <PenTool className="w-8 h-8 text-cn-blue" strokeWidth={2.5} />
          草图绘梦板
        </h3>
        <div className="flex gap-3">
          <button 
            onClick={clearCanvas} 
            className="flex items-center gap-2 px-4 py-2 border-2 border-cn-ink rounded-full bg-white hover:bg-cn-red hover:text-white transition-colors font-bold shadow-sm"
          >
            <Trash2 className="w-5 h-5" />
            清空画布
          </button>
        </div>
      </div>

      <div className="flex-1 relative border-handdrawn overflow-hidden shadow-kid bg-white cursor-crosshair min-h-[400px]">
        <canvas
          ref={canvasRef}
          width={1000}
          height={600}
          className="w-full h-full object-cover"
          onMouseDown={startDrawing}
          onMouseUp={stopDrawing}
          onMouseOut={stopDrawing}
          onMouseMove={draw}
        />
        <div className="absolute inset-0 bg-paper-texture opacity-20 pointer-events-none mix-blend-multiply" />
      </div>

      <p className="text-center text-slate-500 font-bold text-lg">
        在这里画下你的灵感，左侧点击「变出绘本」将草图变成精美故事插画哦！
      </p>
    </div>
  );
}
