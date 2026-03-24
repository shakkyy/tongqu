import { motion } from "framer-motion";
import type { StoryStyle } from "../types";

interface StyleOption {
  id: StoryStyle;
  label: string;
  icon: string;
}

const STYLE_OPTIONS: StyleOption[] = [
  { id: "paper-cut", label: "剪纸", icon: "✂️" },
  { id: "ink-wash", label: "水墨", icon: "🖌️" },
  { id: "shadow-puppet", label: "皮影", icon: "🎭" },
];

interface StyleSelectorProps {
  value: StoryStyle;
  onChange: (style: StoryStyle) => void;
}

export function StyleSelector({ value, onChange }: StyleSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {STYLE_OPTIONS.map((option) => {
        const selected = option.id === value;
        return (
          <motion.button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            whileTap={{ scale: 0.94 }}
            animate={
              selected
                ? { scale: 1.06, boxShadow: "0 0 0 4px rgba(59,130,246,0.25), 0 10px 24px rgba(59,130,246,0.32)" }
                : { scale: 1, boxShadow: "0 8px 18px rgba(15, 23, 42, 0.09)" }
            }
            className={`rounded-2xl border-2 px-4 py-5 text-lg font-semibold transition ${
              selected
                ? "border-sky-kid bg-sky-kid/20 text-slate-800"
                : "border-transparent bg-white/80 text-slate-700"
            }`}
          >
            <div className="mb-1 text-3xl">{option.icon}</div>
            {option.label}
          </motion.button>
        );
      })}
    </div>
  );
}
