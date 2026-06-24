import { useMemo, useState } from "react";
import {
  BookOpen,
  Database,
  Feather,
  Filter,
  GitBranch,
  Layers3,
  LibraryBig,
  Search,
  Sparkles,
  ScrollText,
  Tags,
  X,
} from "lucide-react";
import { CULTURE_STORIES, type CultureStoryRecord } from "../data/cultureStories";
import { CULTURE_STORY_TOTAL_WAN } from "../lib/cultureStoryStats";

type CollectionKey = "all" | string;

const collectionMeta: Record<string, { label: string; tone: string; accent: string }> = {
  "ancient-poems": { label: "诗词文脉", tone: "bg-[#7C4E2B]/10 text-[#6B4429] border-[#A56E3F]/35", accent: "#A56E3F" },
  "folktales": { label: "民间故事", tone: "bg-cn-red/10 text-cn-red border-cn-red/35", accent: "#C94830" },
  "idiom-stories": { label: "成语典故", tone: "bg-cn-yellow/15 text-[#8A5A00] border-cn-yellow/45", accent: "#D99A1E" },
  "myths-legends": { label: "神话传说", tone: "bg-cn-azure/10 text-cn-azure border-cn-azure/35", accent: "#2B6BB5" },
  "shanhaijing": { label: "山海经", tone: "bg-cn-green/10 text-[#167C4C] border-cn-green/35", accent: "#2AAD6E" },
  "xiyouji": { label: "西游记", tone: "bg-[#7A4BD8]/10 text-[#5A35A6] border-[#7A4BD8]/30", accent: "#7A4BD8" },
  "three-kingdoms": { label: "三国演义", tone: "bg-[#B85C38]/10 text-[#8A3F22] border-[#B85C38]/35", accent: "#B85C38" },
  "water-margin": { label: "水浒传", tone: "bg-[#2D7D8F]/10 text-[#1E6472] border-[#2D7D8F]/35", accent: "#2D7D8F" },
  "dream-of-red-mansion": { label: "红楼梦", tone: "bg-[#C05A7B]/10 text-[#933D59] border-[#C05A7B]/35", accent: "#C05A7B" },
};

const difficultyLabel: Record<string, string> = {
  easy: "启蒙",
  medium: "进阶",
  hard: "深读",
};

const DISPLAY_STORIES = CULTURE_STORIES.filter((story) => !story.path.endsWith("/index.md"));

const featuredStory =
  DISPLAY_STORIES.find((story) => story.title === "曹冲称象") ||
  DISPLAY_STORIES.find((story) => story.title === "孔融让梨") ||
  DISPLAY_STORIES.find((story) => story.title === "司马光砸缸") ||
  DISPLAY_STORIES[0];

function labelForCollection(key: string): string {
  return collectionMeta[key]?.label || key;
}

function topTerms(records: CultureStoryRecord[], pick: (record: CultureStoryRecord) => string[], limit = 12) {
  const counts = new Map<string, number>();
  records.forEach((record) => {
    pick(record).forEach((term) => {
      const key = term.trim();
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function uniqueCount(records: CultureStoryRecord[], pick: (record: CultureStoryRecord) => string[]) {
  return new Set(records.flatMap(pick).filter(Boolean)).size;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function stripEmoji(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").replace(/\s{2,}/g, " ").trim();
}

function storyPointPosition(index: number, total: number) {
  const angle = index * 2.399963229728653;
  const radius = 7 + Math.sqrt((index + 0.5) / Math.max(total, 1)) * 46;
  return {
    x: 60 + Math.cos(angle) * radius,
    y: 39 + Math.sin(angle) * radius * 0.62,
  };
}

function edgeBetweenCircles(
  from: { x: number; y: number; r: number },
  to: { x: number; y: number; r: number },
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  return {
    x1: from.x + ux * from.r,
    y1: from.y + uy * from.r,
    x2: to.x - ux * to.r,
    y2: to.y - uy * to.r,
  };
}

function StoryBody({ content }: { content: string }) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) {
    return <p className="text-sm font-bold leading-relaxed text-cn-ink/65">这条故事还没有录入正文。</p>;
  }

  return (
    <div className="space-y-3">
      {lines.map((rawLine, index) => {
        const line = stripEmoji(rawLine.trim());
        const key = `${index}-${line.slice(0, 16)}`;
        if (!line) return null;
        if (line === "---") {
          return <div key={key} className="h-px bg-cn-ink/10" />;
        }
        if (line.startsWith("# ")) {
          return (
            <h3 key={key} className="pt-1 text-2xl font-black leading-tight text-cn-ink">
              {line.replace(/^#\s+/, "")}
            </h3>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <h4 key={key} className="pt-2 text-lg font-black leading-tight text-cn-red">
              {line.replace(/^##\s+/, "")}
            </h4>
          );
        }
        if (line.includes("配图提示")) {
          return (
            <p key={key} className="rounded-xl border border-cn-yellow/45 bg-cn-yellow/10 px-3 py-2 text-xs font-bold leading-relaxed text-cn-ink/68">
              {line.replace(/\*\*/g, "")}
            </p>
          );
        }
        if (/^\d+\./.test(line)) {
          return (
            <p key={key} className="pl-3 text-sm font-bold leading-relaxed text-cn-ink/70">
              {line}
            </p>
          );
        }
        return (
          <p key={key} className="text-sm font-bold leading-relaxed text-cn-ink/72">
            {line.replace(/\*\*/g, "")}
          </p>
        );
      })}
    </div>
  );
}

function StoryGraph({
  stats,
  stories,
  selected,
  focusedId,
  onSelect,
  onFocusStory,
}: {
  stats: Array<{ key: string; count: number }>;
  stories: CultureStoryRecord[];
  selected: CollectionKey;
  focusedId: string;
  onSelect: (key: CollectionKey) => void;
  onFocusStory: (path: string) => void;
}) {
  const max = Math.max(...stats.map((item) => item.count), 1);
  const nodes = stats.map((item, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(stats.length, 1);
    const position = {
      x: 60 + Math.cos(angle) * 43,
      y: 39 + Math.sin(angle) * 27,
    };
    return {
      ...item,
      x: position.x,
      y: position.y,
      r: 3.8 + (item.count / max) * 4.6,
      color: collectionMeta[item.key]?.accent || "#C94830",
    };
  });
  const selectedMeta = selected === "all" ? null : collectionMeta[selected];
  const selectedStories = selected === "all" ? [] : stories;
  const storyNodes = selectedStories.map((story, index) => {
    const position = storyPointPosition(index, selectedStories.length);
    return {
      story,
      index,
      x: position.x,
      y: position.y,
      r: story.difficulty === "hard" ? 1.05 : 0.86,
      color: collectionMeta[story.collection]?.accent || "#C94830",
    };
  });
  const valueEdges = (() => {
    const groups = new Map<string, typeof storyNodes>();
    storyNodes.forEach((node) => {
      const terms = node.story.values.length ? node.story.values : node.story.themes;
      terms.slice(0, 3).forEach((term) => {
        const key = term.trim();
        if (!key) return;
        groups.set(key, [...(groups.get(key) || []), node]);
      });
    });

    const edges: Array<{ key: string; from: (typeof storyNodes)[number]; to: (typeof storyNodes)[number]; term: string }> = [];
    const seen = new Set<string>();
    Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .forEach(([term, group]) => {
        if (group.length < 2) return;
        const sorted = group.slice().sort((a, b) => a.index - b.index);
        sorted.slice(0, 28).forEach((node, index) => {
          const next = sorted[index + 1];
          if (!next) return;
          const pairKey = [node.story.path, next.story.path].sort().join("::");
          if (seen.has(pairKey)) return;
          seen.add(pairKey);
          edges.push({ key: `${term}-${pairKey}`, from: node, to: next, term });
        });
      });
    return edges.slice(0, 220);
  })();

  return (
    <div className="relative h-[460px] overflow-hidden rounded-2xl border-2 border-cn-ink bg-[#FFFDF6] shadow-[3px_3px_0px_rgba(26,43,60,0.16)]">
      <svg viewBox="0 0 120 78" className="h-full w-full" role="img" aria-label="故事数据库图谱">
        <defs>
          <pattern id="story-grid" width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M 8 0 L 0 0 0 8" fill="none" stroke="#1A2B3C" strokeOpacity="0.055" strokeWidth="0.4" />
          </pattern>
        </defs>
        <rect width="120" height="78" fill="url(#story-grid)" />
        {selected === "all" ? (
          <>
            <circle cx="60" cy="39" r="10.5" fill="#FFF1D6" stroke="#1A2B3C" strokeWidth="0.65" />
            <circle cx="60" cy="39" r="17" fill="none" stroke="#A56E3F" strokeDasharray="1.6 2.4" strokeOpacity="0.42" />
            <circle cx="60" cy="39" r="25" fill="none" stroke="#1A2B3C" strokeDasharray="0.8 2.8" strokeOpacity="0.18" />
            <text x="60" y="37" textAnchor="middle" className="fill-cn-ink text-[3.6px] font-black">
              童趣文脉库
            </text>
            <text x="60" y="42" textAnchor="middle" className="fill-cn-ink/60 text-[2.6px] font-bold">
              {DISPLAY_STORIES.length} 条
            </text>
            {nodes.map((node) => {
              const edge = edgeBetweenCircles({ x: 60, y: 39, r: 10.5 }, { x: node.x, y: node.y, r: node.r });
              return (
                <line
                  key={`${node.key}-edge`}
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke={node.color}
                  strokeWidth="0.5"
                  strokeOpacity="0.42"
                />
              );
            })}
            {nodes.map((node) => (
              <g
                key={node.key}
                role="button"
                tabIndex={0}
                className="cursor-pointer outline-none"
                style={{ outline: "none" }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(node.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect(node.key);
                }}
              >
                <circle cx={node.x} cy={node.y} r={node.r} fill="#FFFDF6" stroke={node.color} strokeWidth="0.9" />
                <circle cx={node.x} cy={node.y} r={Math.max(2.1, node.r * 0.48)} fill={node.color} opacity="0.78" />
                <text x={node.x} y={node.y + node.r + 4.2} textAnchor="middle" className="fill-cn-ink text-[2.6px] font-black">
                  {labelForCollection(node.key)}
                </text>
                <text x={node.x} y={node.y + node.r + 7.3} textAnchor="middle" className="fill-cn-ink/55 text-[2.1px] font-bold">
                  {node.count}
                </text>
              </g>
            ))}
          </>
        ) : (
          <>
            {valueEdges.map((valueEdge) => {
              const edge = edgeBetweenCircles(valueEdge.from, valueEdge.to);
              const active = valueEdge.from.story.path === focusedId || valueEdge.to.story.path === focusedId;
              return (
                <line
                  key={valueEdge.key}
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke={selectedMeta?.accent || "#C94830"}
                  strokeWidth={active ? 0.36 : 0.24}
                  strokeOpacity={active ? 0.5 : 0.18}
                >
                  <title>{valueEdge.term}</title>
                </line>
              );
            })}
            <circle cx="60" cy="39" r="6.5" fill="#FFF1D6" stroke="#A56E3F" strokeWidth="0.8" />
            <text x="60" y="38.2" textAnchor="middle" className="fill-cn-ink text-[2.9px] font-black">
              {selectedMeta?.label || selected}
            </text>
            <text x="60" y="42.2" textAnchor="middle" className="fill-cn-ink/55 text-[2.2px] font-bold">
              {selectedStories.length} 点
            </text>
            {storyNodes.map((node) => {
              const active = node.story.path === focusedId;
              return (
                <g
                  key={node.story.path}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer outline-none"
                  style={{ outline: "none" }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onFocusStory(node.story.path)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") onFocusStory(node.story.path);
                  }}
                >
                  <title>{node.story.title}</title>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.r}
                    fill={active ? "#FFF1D6" : node.color}
                    stroke={active ? "#1A2B3C" : "#FFFDF6"}
                    strokeWidth={active ? 0.5 : 0.22}
                    opacity={active ? 1 : 0.66}
                  />
                </g>
              );
            })}
          </>
        )}
      </svg>
      {selected !== "all" ? (
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3 rounded-xl border border-cn-ink/10 bg-white/88 px-3 py-2 backdrop-blur-sm">
          <p className="text-[10px] font-black text-cn-ink/55">
            每个圆点代表一条故事，共同价值标签会连成线，点击圆点查看右侧详情。
          </p>
          <button
            type="button"
            onClick={() => onSelect("all")}
            className="rounded-full border border-cn-ink/20 bg-cn-paper px-2 py-1 text-[10px] font-black text-cn-ink/65 hover:border-cn-ink"
          >
            回到全库
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function StoryDatabasePage({ onBackToCreate }: { onBackToCreate: () => void }) {
  const [query, setQuery] = useState("");
  const [selectedCollection, setSelectedCollection] = useState<CollectionKey>("all");
  const [focusedId, setFocusedId] = useState(featuredStory?.path || "");
  const [readingStory, setReadingStory] = useState<CultureStoryRecord | null>(null);

  const collectionStats = useMemo(() => {
    const counts = new Map<string, number>();
    DISPLAY_STORIES.forEach((story) => counts.set(story.collection, (counts.get(story.collection) || 0) + 1));
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  }, []);

  const filteredStories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DISPLAY_STORIES.filter((story) => {
      if (selectedCollection !== "all" && story.collection !== selectedCollection) return false;
      if (!q) return true;
      const haystack = [
        story.title,
        story.source,
        story.poem,
        story.poet,
        story.dynasty,
        story.coreIdea,
        story.childTakeaway,
        story.summary,
        story.tags.join(" "),
        story.themes.join(" "),
        story.values.join(" "),
        story.visualMotifs.join(" "),
        story.content,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [query, selectedCollection]);

  const focusedStory = useMemo(() => {
    return filteredStories.find((story) => story.path === focusedId) || filteredStories[0] || DISPLAY_STORIES[0];
  }, [filteredStories, focusedId]);

  const topValues = useMemo(() => topTerms(DISPLAY_STORIES, (story) => story.values, 10), []);
  const topMotifs = useMemo(() => topTerms(filteredStories, (story) => story.visualMotifs, 10), [filteredStories]);
  const topThemes = useMemo(() => topTerms(filteredStories, (story) => story.themes, 8), [filteredStories]);
  const selectedMeta = selectedCollection === "all" ? null : collectionMeta[selectedCollection];

  const metricItems = [
    { label: "入库故事", value: DISPLAY_STORIES.length, suffix: "条", icon: Database, highlight: false },
    { label: "总字数", value: CULTURE_STORY_TOTAL_WAN, suffix: "万字", icon: ScrollText, highlight: false },
    { label: "文脉分支", value: collectionStats.length, suffix: "类", icon: GitBranch, highlight: false },
    { label: "价值标签", value: uniqueCount(DISPLAY_STORIES, (story) => story.values), suffix: "个", icon: Tags, highlight: false },
    { label: "视觉意象", value: uniqueCount(DISPLAY_STORIES, (story) => story.visualMotifs), suffix: "个", icon: Sparkles, highlight: false },
  ];

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto bg-[#F7F0DF] font-classical text-cn-ink hide-scrollbar">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-4 py-4 lg:px-6">
        <section className="relative overflow-hidden rounded-2xl border-2 border-cn-ink bg-[#FFFDF6] px-5 py-5 shadow-[4px_4px_0px_rgba(26,43,60,0.18)]">
          <div className="absolute left-0 top-0 h-full w-1.5 bg-cn-red" />
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-cn-ink bg-cn-red text-white shadow-[2px_2px_0px_#1A2B3C]">
                  <LibraryBig className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-black leading-tight tracking-wide text-cn-ink">文脉故事库</h2>
                  <p className="mt-1 text-xs font-bold text-cn-ink/55">
                    中国传统故事、诗词、神话与典故的可改写素材图谱
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onBackToCreate}
              className="w-fit rounded-full border-2 border-cn-ink bg-white px-4 py-2 text-xs font-black text-cn-ink hover:bg-cn-yellow"
            >
              返回创作台
            </button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {metricItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className={`rounded-xl border-2 px-3 py-3 ${
                    item.highlight
                      ? "border-cn-red bg-cn-red text-white shadow-[2px_2px_0px_rgba(26,43,60,0.18)]"
                      : "border-cn-ink/15 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-[10px] font-black ${item.highlight ? "text-white/75" : "text-cn-ink/45"}`}>{item.label}</p>
                    <Icon className={`h-4 w-4 ${item.highlight ? "text-white" : "text-cn-red"}`} />
                  </div>
                  <p className={`mt-2 text-3xl font-black leading-none ${item.highlight ? "text-white" : "text-cn-ink"}`}>
                    {typeof item.value === "number" ? compactNumber(item.value) : item.value}
                    <span className={`ml-1 text-xs ${item.highlight ? "text-white/70" : "text-cn-ink/45"}`}>{item.suffix}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(620px,1fr)_420px]">
          <section className="min-w-0">
            <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-cn-ink bg-cn-yellow">
                  <GitBranch className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-cn-ink">故事图谱</h3>
                  <p className="text-[11px] font-bold text-cn-ink/50">
                    {selectedCollection === "all" ? "全库结构" : `${labelForCollection(selectedCollection)} · ${filteredStories.length} 条`}
                  </p>
                </div>
              </div>
              <label className="flex min-w-0 items-center gap-2 rounded-full border-2 border-cn-ink bg-white px-3 py-2 lg:w-[360px]">
                <Search className="h-4 w-4 flex-shrink-0 text-cn-ink/45" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索故事、价值观、角色或意象"
                  className="min-w-0 flex-1 bg-transparent text-xs font-bold text-cn-ink outline-none placeholder:text-cn-ink/35"
                />
              </label>
            </div>
            <StoryGraph
              stats={collectionStats}
              stories={filteredStories}
              selected={selectedCollection}
              focusedId={focusedStory?.path || ""}
              onSelect={setSelectedCollection}
              onFocusStory={setFocusedId}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedCollection("all")}
                className={`rounded-full border-2 px-3 py-1.5 text-[10px] font-black ${
                  selectedCollection === "all" ? "border-cn-ink bg-cn-ink text-white" : "border-cn-ink/25 bg-white text-cn-ink/65 hover:border-cn-ink"
                }`}
              >
                全部 {DISPLAY_STORIES.length}
              </button>
              {collectionStats.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSelectedCollection(item.key)}
                  className={`rounded-full border-2 px-3 py-1.5 text-[10px] font-black ${
                    selectedCollection === item.key
                      ? "border-cn-ink bg-cn-red text-white"
                      : `${collectionMeta[item.key]?.tone || "border-cn-ink/25 bg-white text-cn-ink/65"} hover:border-cn-ink`
                  }`}
                >
                  {labelForCollection(item.key)} {item.count}
                </button>
              ))}
            </div>
          </section>

          <aside className="min-w-0 rounded-2xl border-2 border-cn-ink bg-white p-4 shadow-[3px_3px_0px_rgba(26,43,60,0.14)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black text-cn-red">当前聚焦</p>
                <h3 className="mt-1 text-xl font-black leading-tight text-cn-ink">{focusedStory?.title || "暂无故事"}</h3>
              </div>
              <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${collectionMeta[focusedStory?.collection || ""]?.tone || "border-cn-ink/20 bg-cn-paper text-cn-ink/60"}`}>
                {labelForCollection(focusedStory?.collection || "")}
              </span>
            </div>
            <p className="mt-3 text-sm font-bold leading-relaxed text-cn-ink/72">
              {focusedStory?.coreIdea || focusedStory?.summary || "这条故事正在等待补充文化内核。"}
            </p>
            {focusedStory?.childTakeaway ? (
              <p className="mt-3 rounded-xl border border-cn-yellow/35 bg-cn-yellow/10 px-3 py-2 text-xs font-bold leading-relaxed text-cn-ink/72">
                {focusedStory.childTakeaway}
              </p>
            ) : null}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-cn-ink/12 bg-cn-paper/45 px-2 py-2">
                <p className="text-[9px] font-black text-cn-ink/45">字数</p>
                <p className="mt-1 text-sm font-black">{focusedStory?.wordCount || "-"}</p>
              </div>
              <div className="rounded-lg border border-cn-ink/12 bg-cn-paper/45 px-2 py-2">
                <p className="text-[9px] font-black text-cn-ink/45">年龄</p>
                <p className="mt-1 text-sm font-black">{focusedStory?.ageRange || "-"}</p>
              </div>
              <div className="rounded-lg border border-cn-ink/12 bg-cn-paper/45 px-2 py-2">
                <p className="text-[9px] font-black text-cn-ink/45">难度</p>
                <p className="mt-1 text-sm font-black">{difficultyLabel[focusedStory?.difficulty || ""] || focusedStory?.difficulty || "-"}</p>
              </div>
            </div>
            <div className="mt-4">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-black text-cn-ink/55">
                <Sparkles className="h-3.5 w-3.5 text-cn-red" />
                视觉意象
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(focusedStory?.visualMotifs || []).slice(0, 8).map((motif) => (
                  <span key={motif} className="rounded-full border border-cn-ink/15 bg-cn-paper/60 px-2 py-1 text-[10px] font-bold text-cn-ink/65">
                    {motif}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-black text-cn-ink/55">
                <Feather className="h-3.5 w-3.5 text-cn-red" />
                可改写种子
              </p>
              <div className="space-y-1.5">
                {(focusedStory?.usableStorySeeds || []).slice(0, 3).map((seed) => (
                  <p key={seed} className="rounded-lg border border-cn-red/18 bg-cn-red/5 px-2 py-1.5 text-[11px] font-bold leading-snug text-cn-ink/68">
                    {seed}
                  </p>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (focusedStory) setReadingStory(focusedStory);
              }}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-cn-ink bg-cn-red px-4 py-2.5 text-sm font-black text-white shadow-[2px_2px_0px_rgba(26,43,60,0.18)] hover:translate-y-[-1px]"
            >
              <ScrollText className="h-4 w-4" />
              查看故事全文
            </button>
          </aside>
        </div>

        <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="rounded-2xl border-2 border-cn-ink bg-[#FFFDF6] p-4 shadow-[3px_3px_0px_rgba(26,43,60,0.12)]">
            <div className="mb-3 flex items-center gap-2">
              <Layers3 className="h-4 w-4 text-cn-red" />
              <p className="text-sm font-black text-cn-ink">文化热词</p>
            </div>
            <div className="space-y-3">
              <div>
                <p className="mb-2 text-[10px] font-black text-cn-ink/45">全库价值</p>
                <div className="flex flex-wrap gap-1.5">
                  {topValues.map((item) => (
                    <span key={item.term} className="rounded-full border border-cn-red/25 bg-cn-red/10 px-2 py-1 text-[10px] font-black text-cn-red/80">
                      {item.term} · {item.count}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[10px] font-black text-cn-ink/45">当前意象</p>
                <div className="flex flex-wrap gap-1.5">
                  {topMotifs.map((item) => (
                    <span key={item.term} className="rounded-full border border-[#A56E3F]/25 bg-[#FFF1D6] px-2 py-1 text-[10px] font-black text-[#7C4E2B]">
                      {item.term} · {item.count}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[10px] font-black text-cn-ink/45">当前主题</p>
                <div className="flex flex-wrap gap-1.5">
                  {topThemes.map((item) => (
                    <span key={item.term} className="rounded-full border border-cn-azure/25 bg-cn-azure/10 px-2 py-1 text-[10px] font-black text-cn-azure">
                      {item.term} · {item.count}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-0 rounded-2xl border-2 border-cn-ink bg-white p-4 shadow-[3px_3px_0px_rgba(26,43,60,0.12)]">
            <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-cn-red" />
                <p className="text-sm font-black text-cn-ink">故事条目</p>
                <span className="rounded-full border border-cn-ink/15 bg-cn-paper px-2 py-0.5 text-[10px] font-black text-cn-ink/55">
                  {filteredStories.length}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-black text-cn-ink/45">
                <Filter className="h-3.5 w-3.5" />
                {selectedMeta?.label || "全库"}
              </div>
            </div>
            <div className="grid max-h-[520px] gap-2 overflow-y-auto pr-1 hide-scrollbar md:grid-cols-2 2xl:grid-cols-3">
              {filteredStories.slice(0, 90).map((story) => {
                const active = focusedStory?.path === story.path;
                return (
                  <button
                    key={story.path}
                    type="button"
                    onClick={() => setFocusedId(story.path)}
                    className={`min-h-[150px] rounded-xl border-2 p-3 text-left transition-all ${
                      active
                        ? "border-cn-red bg-cn-red/10 shadow-[2px_2px_0px_rgba(201,72,48,0.18)]"
                        : "border-cn-ink/12 bg-[#FFFDF6] hover:border-cn-ink/45"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-1 text-sm font-black text-cn-ink">{story.title}</p>
                      <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black ${collectionMeta[story.collection]?.tone || "border-cn-ink/15 bg-white text-cn-ink/50"}`}>
                        {labelForCollection(story.collection)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[11px] font-bold leading-relaxed text-cn-ink/65">
                      {story.coreIdea || story.summary || "暂无文化内核摘要。"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {[...story.values, ...story.themes].slice(0, 4).map((tag) => (
                        <span key={tag} className="rounded-full border border-cn-ink/10 bg-white px-1.5 py-0.5 text-[9px] font-bold text-cn-ink/48">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p className="mt-3 text-[9px] font-black text-cn-ink/35">
                      {story.source || story.poet || story.cultureType || story.path}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
      {readingStory ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-cn-ink/45 px-4 py-5 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="story-content-title"
            className="flex h-full max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-[24px] border-4 border-cn-ink bg-[#FFFDF6] shadow-[8px_10px_0px_rgba(26,43,60,0.22)]"
          >
            <div className="flex items-start justify-between gap-4 border-b-2 border-cn-red/25 bg-cn-red/10 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-black text-cn-red">故事正文</p>
                <h3 id="story-content-title" className="mt-1 text-2xl font-black leading-tight text-cn-ink">
                  {readingStory.title}
                </h3>
                <p className="mt-1 text-xs font-bold text-cn-ink/52">
                  {labelForCollection(readingStory.collection)} · {readingStory.source || readingStory.path}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReadingStory(null)}
                className="rounded-full border-2 border-cn-ink bg-white p-2 text-cn-ink hover:bg-cn-yellow"
                aria-label="关闭故事正文"
              >
                <X className="h-5 w-5" strokeWidth={2.6} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-white/75 px-5 py-5">
              <StoryBody content={readingStory.content || readingStory.summary || readingStory.coreIdea} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
