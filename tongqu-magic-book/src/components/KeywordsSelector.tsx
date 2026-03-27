import { useState } from "react";

type Category = {
  id: "theme" | "character" | "scene";
  label: string;
  tags: string[];
};

const CATEGORIES: Category[] = [
  { id: "theme", label: "主题", tags: ["古典神话", "民间传说", "侠义风云", "成语故事"] },
  { id: "character", label: "角色", tags: ["灵狐", "小龙女", "孙大圣", "机关甲士"] },
  { id: "scene", label: "场景", tags: ["幽静竹林", "九霄云外", "深海龙宫", "大漠孤烟"] },
];

export function KeywordsSelector() {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {CATEGORIES.map((cat) => (
        <div key={cat.id} className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-cn-ink/50 border-l-2 border-cn-ink pl-2">{cat.label}</span>
          <div className="flex flex-wrap gap-1.5">
            {cat.tags.map((tag) => {
              const isSelected = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
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
          </div>
        </div>
      ))}
    </div>
  );
}
