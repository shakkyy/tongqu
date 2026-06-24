import { useEffect, useMemo, useState } from "react";
import type { BookshelfEntry } from "../lib/bookshelfStorage";
import {
  BookOpen,
  CalendarDays,
  Clock3,
  Layers3,
  Mic,
  PenTool,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Type,
  UsersRound,
} from "lucide-react";

interface BookshelfPageProps {
  items: BookshelfEntry[];
  onOpenBook: (entry: BookshelfEntry) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onCreateNew: () => void;
}

type ModeFilter = BookshelfEntry["mode"] | "all";

const FALLBACK_COVER = "/封面.png";

const modeMeta: Record<BookshelfEntry["mode"], { label: string; Icon: typeof Mic; tone: string }> = {
  voice: { label: "语音", Icon: Mic, tone: "bg-cn-azure/10 text-cn-azure border-cn-azure/35" },
  keywords: { label: "选词", Icon: Type, tone: "bg-cn-yellow/10 text-[#8A5A00] border-cn-yellow/45" },
  sketch: { label: "草图", Icon: PenTool, tone: "bg-cn-red/10 text-cn-red border-cn-red/35" },
  family: { label: "亲子", Icon: UsersRound, tone: "bg-cn-red/10 text-cn-red border-cn-red/35" },
};

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function countByMode(items: BookshelfEntry[], mode: BookshelfEntry["mode"]): number {
  return items.filter((item) => item.mode === mode).length;
}

export function BookshelfPage({
  items,
  onOpenBook,
  onRemove,
  onClearAll,
  onCreateNew,
}: BookshelfPageProps) {
  const [query, setQuery] = useState("");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (modeFilter !== "all" && item.mode !== modeFilter) return false;
      if (!q) return true;
      const haystack = [
        item.title,
        item.pages.map((page) => page.text).join(" "),
        item.culture?.hits.map((hit) => hit.title).join(" ") ?? "",
        item.bookMeta?.familyCoCreation?.members?.map((m) => `${m.displayName} ${m.relation} ${m.storyRole}`).join(" ") ?? "",
        item.bookMeta?.familyCoCreation?.childIdea ?? "",
        item.bookMeta?.familyCoCreation?.parentGoal ?? "",
        item.bookMeta?.familyCoCreation?.travelWish ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, modeFilter, query]);

  const selected = useMemo(() => {
    return filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? items[0] ?? null;
  }, [filtered, items, selectedId]);

  useEffect(() => {
    if (!selected) {
      setSelectedId(null);
      return;
    }
    if (selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const totalPages = items.reduce((sum, item) => sum + item.pageCount, 0);
  const latest = items[0];
  const selectedFamily = selected?.bookMeta?.familyCoCreation;
  const selectedFamilyPhoto = selected?.familyPhotoThumb || selectedFamily?.familyPhotoThumb;

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto bg-[#F7F0DF] font-classical text-cn-ink hide-scrollbar">
      <div className="mx-auto w-full max-w-[1480px]">
        <div className="flex flex-shrink-0 flex-col gap-3 px-4 py-4 lg:px-6">
          <section className="relative overflow-hidden rounded-2xl border-2 border-cn-ink bg-[#FFFDF6] px-5 py-5 shadow-[4px_4px_0px_rgba(26,43,60,0.18)]">
            <div className="absolute left-0 top-0 h-full w-1.5 bg-cn-red" />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-cn-ink bg-cn-red text-white shadow-[2px_2px_0px_#1A2B3C]">
                <BookOpen className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-2xl font-black leading-tight text-cn-ink">成长纪念书架</h2>
                <p className="text-[11px] font-bold text-cn-ink/50">
                  {items.length > 0 ? `${items.length} 本绘本 · ${totalPages} 页内容` : "暂无绘本"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onCreateNew}
              className="flex items-center gap-1.5 rounded-full border-2 border-cn-ink bg-cn-red px-4 py-2 text-xs font-black text-white shadow-[1px_2px_0px_#1A2B3C] hover:translate-y-[-1px]"
            >
              <Plus className="h-4 w-4" />
              新建绘本
            </button>
            <button
              type="button"
              disabled={items.length === 0}
              onClick={() => {
                if (window.confirm("确定清空全部书架历史？此操作不可恢复。")) onClearAll();
              }}
              className="flex items-center gap-1.5 rounded-full border-2 border-cn-ink bg-white px-3 py-2 text-xs font-black text-cn-ink hover:bg-cn-yellow disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Settings2 className="h-4 w-4" />
              清空
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <div className="rounded-xl border-2 border-cn-ink/15 bg-white px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black text-cn-ink/45">绘本总数</p>
              <BookOpen className="h-4 w-4 text-cn-red" />
            </div>
            <p className="mt-1 text-xl font-black leading-none text-cn-ink">{items.length}</p>
          </div>
          <div className="rounded-xl border-2 border-cn-ink/15 bg-white px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black text-cn-ink/45">累计页数</p>
              <Layers3 className="h-4 w-4 text-cn-red" />
            </div>
            <p className="mt-1 text-xl font-black leading-none text-cn-ink">{totalPages}</p>
          </div>
          <div className="rounded-xl border-2 border-cn-ink/15 bg-white px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black text-cn-ink/45">亲子共创</p>
              <UsersRound className="h-4 w-4 text-cn-red" />
            </div>
            <p className="mt-1 text-xl font-black leading-none text-cn-ink">{countByMode(items, "family")}</p>
          </div>
          <div className="rounded-xl border-2 border-cn-ink/15 bg-white px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black text-cn-ink/45">最近生成</p>
              <Clock3 className="h-4 w-4 text-cn-red" />
            </div>
            <p className="mt-1 truncate text-sm font-black leading-tight text-cn-ink">
              {latest ? latest.title : "暂无"}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border-2 border-cn-ink bg-white px-3 py-2">
            <Search className="h-4 w-4 flex-shrink-0 text-cn-ink/45" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、旁白或文化条目"
              className="min-w-0 flex-1 bg-transparent text-xs font-bold text-cn-ink outline-none placeholder:text-cn-ink/35"
            />
          </label>
          <div className="flex flex-wrap gap-1 rounded-full border-2 border-cn-ink bg-cn-paper p-1">
            {(["all", "voice", "keywords", "sketch", "family"] as ModeFilter[]).map((mode) => {
              const active = modeFilter === mode;
              const meta = mode === "all" ? null : modeMeta[mode];
              const Icon = meta?.Icon ?? Sparkles;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setModeFilter(mode)}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-black transition-colors ${
                    active ? "bg-white text-cn-ink shadow-[1px_1px_0px_#1A2B3C]" : "text-cn-ink/50 hover:text-cn-ink"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {mode === "all" ? "全部" : meta?.label}
                </button>
              );
            })}
          </div>
        </div>
          </section>
        </div>

        <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(420px,1fr)_360px] lg:items-start lg:px-6">
        <div className="pr-1">
          {filtered.length === 0 ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-cn-ink/25 bg-white/70 text-center">
              <BookOpen className="h-10 w-10 text-cn-ink/30" />
              <p className="mt-3 text-sm font-black text-cn-ink/60">
                {items.length === 0 ? "书架是空的" : "没有匹配的绘本"}
              </p>
              <button
                type="button"
                onClick={onCreateNew}
                className="mt-4 rounded-full border-2 border-cn-ink bg-cn-red px-4 py-2 text-xs font-black text-white"
              >
                新建绘本
              </button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((item) => {
                const meta = modeMeta[item.mode];
                const Icon = meta.Icon;
                const active = selected?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`group overflow-hidden rounded-xl border-2 bg-white text-left transition-all ${
                      active
                        ? "border-cn-red shadow-[3px_3px_0px_rgba(26,43,60,0.25)]"
                        : "border-cn-ink/20 hover:border-cn-ink/55 hover:shadow-[2px_2px_0px_rgba(26,43,60,0.14)]"
                    }`}
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-cn-paper">
                      <img
                        src={item.coverUrl || FALLBACK_COVER}
                        alt={item.title}
                        onError={(ev) => {
                          const img = ev.currentTarget;
                          if (img.src.endsWith(encodeURI(FALLBACK_COVER)) || img.src.endsWith(FALLBACK_COVER)) return;
                          img.src = FALLBACK_COVER;
                        }}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                      <span className={`absolute left-2 top-2 flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black backdrop-blur ${meta.tone}`}>
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </span>
                      <span className="absolute bottom-2 right-2 rounded-full border border-cn-ink/20 bg-white/90 px-2 py-1 text-[9px] font-black text-cn-ink">
                        {item.pageCount} 页
                      </span>
                      {item.familyPhotoThumb || item.bookMeta?.familyCoCreation?.familyPhotoThumb ? (
                        <span className="absolute bottom-2 left-2 rounded-full border border-cn-red/35 bg-white/90 px-2 py-1 text-[9px] font-black text-cn-red">
                          合照纪念
                        </span>
                      ) : null}
                    </div>
                    <div className="p-3">
                      <p className="truncate text-sm font-black text-cn-ink">{item.title}</p>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-bold text-cn-ink/50">
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {formatDate(item.createdAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock3 className="h-3 w-3" />
                          {formatTime(item.createdAt)}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <aside className="hidden rounded-xl border-2 border-cn-ink bg-white shadow-[3px_3px_0px_rgba(26,43,60,0.16)] lg:block">
          {selected ? (
            <>
              <div className="relative aspect-[16/10] flex-shrink-0 overflow-hidden bg-cn-paper">
                <img
                  src={selected.coverUrl || FALLBACK_COVER}
                  alt={selected.title}
                  onError={(ev) => {
                    const img = ev.currentTarget;
                    if (img.src.endsWith(encodeURI(FALLBACK_COVER)) || img.src.endsWith(FALLBACK_COVER)) return;
                    img.src = FALLBACK_COVER;
                  }}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-lg font-black leading-tight text-cn-ink">{selected.title}</h3>
                    <p className="mt-1 text-[11px] font-bold text-cn-ink/50">
                      {formatDate(selected.createdAt)} {formatTime(selected.createdAt)}
                    </p>
                  </div>
                  <span className={`flex flex-shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black ${modeMeta[selected.mode].tone}`}>
                    {(() => {
                      const Icon = modeMeta[selected.mode].Icon;
                      return <Icon className="h-3.5 w-3.5" />;
                    })()}
                    {modeMeta[selected.mode].label}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-cn-ink/15 bg-cn-paper/40 px-3 py-2">
                    <p className="text-[10px] font-black text-cn-ink/45">页数</p>
                    <p className="mt-1 text-lg font-black text-cn-ink">{selected.pageCount}</p>
                  </div>
                  <div className="rounded-lg border border-cn-ink/15 bg-cn-paper/40 px-3 py-2">
                    <p className="text-[10px] font-black text-cn-ink/45">文化条目</p>
                    <p className="mt-1 text-lg font-black text-cn-ink">{selected.culture?.hits.length ?? 0}</p>
                  </div>
                </div>

                {selected.culture?.hits.length ? (
                  <div className="mt-4">
                    <p className="mb-2 flex items-center gap-1 text-[11px] font-black text-cn-ink/55">
                      <Layers3 className="h-3.5 w-3.5" />
                      文化发掘
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selected.culture.hits.slice(0, 5).map((hit, idx) => (
                        <span key={`${hit.title}-${idx}`} className="rounded-full border border-cn-ink/15 bg-cn-yellow/15 px-2 py-1 text-[10px] font-bold text-cn-ink/70">
                          {hit.title}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedFamily || selectedFamilyPhoto ? (
                  <div className="mt-4 rounded-lg border-2 border-cn-red/35 bg-cn-red/10 p-3">
                    <p className="mb-2 flex items-center gap-1 text-[11px] font-black text-cn-red">
                      <UsersRound className="h-3.5 w-3.5" />
                      家庭纪念
                    </p>
                    {selectedFamilyPhoto ? (
                      <img
                        src={selectedFamilyPhoto}
                        alt="家庭合照缩略图"
                        className="mb-2 aspect-[16/10] w-full rounded-lg border border-cn-ink/15 object-cover"
                      />
                    ) : null}
                    {selectedFamily?.travelWish ? (
                      <p className="text-[11px] font-bold leading-snug text-cn-ink/75">
                        穿越愿望：{selectedFamily.travelWish}
                      </p>
                    ) : null}
                    {selectedFamily?.childIdea ? (
                      <p className="mt-1 text-[11px] font-bold leading-snug text-cn-ink/65">
                        孩子点子：{selectedFamily.childIdea}
                      </p>
                    ) : null}
                    {selectedFamily?.parentGoal ? (
                      <p className="mt-1 text-[11px] font-bold leading-snug text-cn-ink/65">
                        家长期待：{selectedFamily.parentGoal}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4">
                  <p className="mb-2 text-[11px] font-black text-cn-ink/55">页面预览</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {selected.pages.map((page, idx) => (
                      <img
                        key={page.id || idx}
                        src={page.imageUrl || FALLBACK_COVER}
                        alt={`P${idx + 1}`}
                        className="aspect-[16/10] rounded-md border border-cn-ink/15 object-cover"
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-cn-ink/10 bg-cn-paper/35 p-3">
                  <p className="text-[12px] font-semibold leading-relaxed text-cn-ink/70">
                    {selected.pages[0]?.text || "暂无旁白"}
                  </p>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenBook(selected)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border-2 border-cn-ink bg-cn-red px-3 py-2 text-xs font-black text-white shadow-[1px_2px_0px_#1A2B3C]"
                  >
                    <BookOpen className="h-4 w-4" />
                    打开阅读
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(selected.id)}
                    className="flex items-center justify-center rounded-xl border-2 border-cn-ink bg-white px-3 py-2 text-xs font-black text-cn-ink hover:bg-cn-red hover:text-white"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm font-bold text-cn-ink/45">
              未选择绘本
            </div>
          )}
        </aside>
      </div>
      </div>
    </div>
  );
}
