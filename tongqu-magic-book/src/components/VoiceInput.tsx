import { motion } from "framer-motion";

interface VoiceInputProps {
  isListening: boolean;
  onToggle: () => void;
}

export function VoiceInput({ isListening, onToggle }: VoiceInputProps) {
  return (
    <div className="relative flex items-center gap-4">
      <button
        type="button"
        onClick={onToggle}
        className="relative z-10 h-20 w-20 rounded-full bg-sky-kid shadow-kid transition-transform duration-200 hover:scale-105 active:scale-95"
        aria-label={isListening ? "停止语音输入" : "开始语音输入"}
      >
        <span className="text-3xl">🎤</span>
      </button>

      {isListening && (
        <>
          <motion.span
            className="absolute left-10 h-20 w-20 rounded-full bg-sky-kid/40"
            animate={{ scale: [1, 1.7], opacity: [0.8, 0] }}
            transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.2, ease: "easeOut" }}
          />
          <motion.span
            className="absolute left-10 h-20 w-20 rounded-full bg-mint-kid/40"
            animate={{ scale: [1, 2], opacity: [0.7, 0] }}
            transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.5, ease: "easeOut", delay: 0.25 }}
          />
        </>
      )}

      <motion.div
        className="rounded-3xl bg-white/80 px-5 py-3 text-lg font-semibold text-slate-700 shadow-soft"
        animate={isListening ? { y: [0, -2, 0] } : { y: 0 }}
        transition={{ duration: 0.9, repeat: isListening ? Number.POSITIVE_INFINITY : 0 }}
      >
        {isListening ? "正在听你说..." : "点击麦克风，说出你的灵感"}
      </motion.div>
    </div>
  );
}
