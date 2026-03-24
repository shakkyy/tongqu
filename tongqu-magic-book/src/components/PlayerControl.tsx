import { motion } from "framer-motion";

interface PlayerControlProps {
  isGenerating: boolean;
  onGenerate: () => void;
  onRead: () => void;
}

export function PlayerControl({ isGenerating, onGenerate, onRead }: PlayerControlProps) {
  return (
    <div className="fixed bottom-8 right-8 z-20 flex gap-3">
      <motion.button
        type="button"
        onClick={onGenerate}
        whileTap={{ scale: 0.94 }}
        className="rounded-full bg-yellow-kid px-6 py-4 text-lg font-bold text-slate-800 shadow-kid"
      >
        {isGenerating ? "绘制中..." : "一键生成"}
      </motion.button>
      <motion.button
        type="button"
        onClick={onRead}
        whileTap={{ scale: 0.94 }}
        className="rounded-full bg-grass-kid px-6 py-4 text-lg font-bold text-slate-900 shadow-kid"
      >
        朗读 ▶
      </motion.button>
    </div>
  );
}
