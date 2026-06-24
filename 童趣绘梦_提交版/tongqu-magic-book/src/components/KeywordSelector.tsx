import { useState } from 'react';

interface KeywordSelectorProps {
  type: 'theme' | 'role' | 'scene';
  options: string[];
  value: string;
  onChange: (val: string) => void;
  label: string;
  color: string;
}

export function KeywordSelector({ options, value, onChange, label, color }: KeywordSelectorProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-bold text-ink-kid font-classical text-lg">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`px-4 py-2 rounded-full border-2 font-bold transition-all hover:-translate-y-1 ${
              value === opt 
                ? `bg-${color} border-ink-kid shadow-[2px_2px_0px_#2d3748] text-ink-kid` 
                : 'bg-white border-ink-kid/20 text-slate-500 hover:border-ink-kid/50'
            }`}
          >
            {opt}
          </button>
        ))}
        <button className="px-4 py-2 rounded-full border-2 border-dashed border-ink-kid/30 text-slate-400 font-bold hover:bg-paper-kid transition-colors">
          + 自定义
        </button>
      </div>
    </div>
  );
}
