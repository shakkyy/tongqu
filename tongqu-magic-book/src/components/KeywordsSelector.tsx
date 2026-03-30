import { useEffect, useState } from "react";
import type { CategoryId, KeywordSelectionPayload } from "../lib/keywordPayload";

type Category = {
  id: CategoryId;
  label: string;
  tags: string[];
};

const CATEGORIES: Category[] = [
  { id: "theme", label: "主题", tags: ["古典神话", "民间传说", "侠义风云", "成语故事"] },
  { id: "character", label: "角色", tags: ["灵狐", "小龙女", "孙大圣", "机关甲士"] },
  { id: "scene", label: "场景", tags: ["幽静竹林", "九霄云外", "深海龙宫", "大漠孤烟"] },
];

interface KeywordsSelectorProps {
  onSelectionChange?: (payload: KeywordSelectionPayload) => void;
}

export function KeywordsSelector({ onSelectionChange }: KeywordsSelectorProps) {
  const [payload, setPayload] = useState<KeywordSelectionPayload>(() => ({
    theme: { tags: [], custom: "" },
    character: { tags: [], custom: "" },
    scene: { tags: [], custom: "" },
  }));
  /** 为 true 或已有自定义文字时显示输入框 */
  const [customOpen, setCustomOpen] = useState<Record<CategoryId, boolean>>({
    theme: false,
    character: false,
    scene: false,
  });

  useEffect(() => {
    onSelectionChange?.(payload);
  }, [payload, onSelectionChange]);

  const toggleTag = (catId: CategoryId, tag: string) => {
    setPayload((prev) => {
      const cur = prev[catId];
      const tags = cur.tags.includes(tag) ? cur.tags.filter((t) => t !== tag) : [...cur.tags, tag];
      return { ...prev, [catId]: { ...cur, tags } };
    });
  };

  const setCustom = (catId: CategoryId, custom: string) => {
    setPayload((prev) => ({
      ...prev,
      [catId]: { ...prev[catId], custom },
    }));
  };

  const showCustomInput = (catId: CategoryId) => {
    const c = payload[catId].custom.trim();
    return customOpen[catId] || c.length > 0;
  };

  const placeholder: Record<CategoryId, string> = {
    theme: "或自己写主题，如：友谊与分享、春天的校园……",
    character: "或自己写角色，如：会飞的小刺猬、机器人弟弟……",
    scene: "或自己写场景，如：雨后的彩虹桥、月球上的图书馆……",
  };

  return (
    <div className="flex flex-col gap-3">
      {CATEGORIES.map((cat) => {
        const block = payload[cat.id];
        return (
          <div key={cat.id} className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-cn-ink/50 border-l-2 border-cn-ink pl-2">{cat.label}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {cat.tags.map((tag) => {
                const isSelected = block.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(cat.id, tag)}
                    className={`px-2.5 py-1 rounded-full border-2 border-cn-ink font-bold text-xs transition-all ${
                      isSelected
                        ? cat.id === "theme"
                          ? "bg-theme-primary text-white shadow-[1.5px_1.5px_0px_#1A2B3C]"
                          : cat.id === "character"
                            ? "bg-theme-secondary text-white shadow-[1.5px_1.5px_0px_#1A2B3C]"
                            : "bg-theme-success text-white shadow-[1.5px_1.5px_0px_#1A2B3C]"
                        : "bg-white text-cn-ink/70 hover:bg-cn-paper"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
              {!showCustomInput(cat.id) ? (
                <button
                  type="button"
                  onClick={() => setCustomOpen((prev) => ({ ...prev, [cat.id]: true }))}
                  className="px-2.5 py-1 rounded-full border-2 border-dashed border-cn-ink/35 bg-cn-paper/50 font-bold text-xs text-cn-ink/55 hover:border-cn-ink/55 hover:bg-cn-paper hover:text-cn-ink transition-colors"
                >
                  自定义
                </button>
              ) : null}
            </div>
            {showCustomInput(cat.id) ? (
              <input
                type="text"
                value={block.custom}
                onChange={(e) => setCustom(cat.id, e.target.value)}
                onBlur={() => {
                  if (!block.custom.trim()) {
                    setCustomOpen((prev) => ({ ...prev, [cat.id]: false }));
                  }
                }}
                placeholder={placeholder[cat.id]}
                autoFocus={customOpen[cat.id]}
                className="w-full rounded-lg border-2 border-cn-ink/25 bg-white px-2.5 py-1.5 text-[11px] text-cn-ink placeholder:text-cn-ink/35 focus:border-cn-azure focus:outline-none"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
