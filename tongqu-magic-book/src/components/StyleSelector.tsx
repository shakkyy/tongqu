import type { StoryStyle } from "../types";
import { Scissors, Palette, Theater, Smile } from "lucide-react";

interface StyleOption {
  id: StoryStyle;
  label: string;
  icon: any;
}

// 每种画风对应传统中国色：剪纸=朱砂红、水墨=花青蓝、皮影=藤黄
const STYLE_OPTIONS: StyleOption[] = [
  { id: "paper-cut", label: "剪纸风", icon: Scissors },
  { id: "ink-wash", label: "水墨画", icon: Palette },
  { id: "shadow-puppet", label: "皮影戏", icon: Theater },
  { id: "comic", label: "漫画风", icon: Smile },
];

interface StyleSelectorProps {
  value: StoryStyle;
  onChange: (style: StoryStyle) => void;
}

export function StyleSelector({ value, onChange }: StyleSelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-2 w-full max-w-[260px] mx-auto justify-items-stretch">
      {STYLE_OPTIONS.map((option) => {
        const selected = option.id === value;
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`relative flex flex-col items-center justify-center gap-1.5 border-2 border-cn-ink rounded-xl py-2 px-1 transition-all hover:-translate-y-0.5 ${
              selected
                ? option.id === "paper-cut"
                  ? "bg-theme-primary text-white shadow-[2px_3px_0px_#1A2B3C] z-10"
                  : option.id === "ink-wash"
                    ? "bg-theme-secondary text-white shadow-[2px_3px_0px_#1A2B3C] z-10"
                    : option.id === "shadow-puppet"
                      ? "bg-theme-accent text-theme-text shadow-[2px_3px_0px_#1A2B3C] z-10"
                      : "bg-cn-azure text-white shadow-[2px_3px_0px_#1A2B3C] z-10"
                : "bg-cn-paper text-cn-ink/70 shadow-sm"
            }`}
          >
            <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 ${selected ? "border-white/40 bg-white/20" : "border-cn-ink bg-white"}`}>
              <Icon className={`w-4 h-4 ${selected ? "text-current" : "text-cn-ink"}`} />
            </div>
            <span className={`font-classical font-bold ${selected ? "text-base" : "text-sm"}`}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
