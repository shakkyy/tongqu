import { useState, useEffect } from "react";
import type { AgentTraceEntry, CultureRagInfo, StoryPage } from "../types";
import { exportStoryAsHtmlFile, resolveBookTitle, shareStory } from "../lib/shareAndExport";
import {
  BookOpen,
  Volume2,
  ChevronLeft,
  ChevronRight,
  Download,
  Share2,
  RefreshCw,
  Wand2,
  Plus,
  BookMarked,
} from "lucide-react";

interface StoryBookPanelProps {
  storyPages: StoryPage[];
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  isGenerating: boolean;
  /** 草图生成中：只显示加载，不展示上一本书的缩略图 */
  forceLoadingOnly?: boolean;
  progressText: string;
  generationStages?: Array<{
    id: string;
    title: string;
    detail: string;
  }>;
  generationStageIndex?: number;
  generationElapsedSec?: number;
  agentTrace?: AgentTraceEntry[];
  culture?: CultureRagInfo | null;
  onSpeakPage: (index: number) => void;
  /** 当前为已生成绘本时显示，手动加入书架 */
  onAddToBookshelf?: () => void;
}

export function StoryBookPanel({
  storyPages,
  activeIndex,
  setActiveIndex,
  isGenerating,
  forceLoadingOnly,
  progressText,
  generationStages = [],
  generationStageIndex = 0,
  generationElapsedSec = 0,
  agentTrace = [],
  culture,
  onSpeakPage,
  onAddToBookshelf,
}: StoryBookPanelProps) {
  const activePage = storyPages[activeIndex] ?? storyPages[0];
  const showSpinner = isGenerating || forceLoadingOnly;
  const [actionHint, setActionHint] = useState<string | null>(null);
  const [shareExportBusy, setShareExportBusy] = useState<"share" | "export" | null>(null);
  const [cultureOpen, setCultureOpen] = useState(false);
  const currentStage = generationStages[Math.min(generationStageIndex, Math.max(generationStages.length - 1, 0))];
  const traceKindLabel: Record<string, string> = {
    observe: "观察",
    decision: "决策",
    tool_call: "调用",
    tool_result: "结果",
    tool_error: "错误",
    repair: "纠偏",
    finish: "完成",
    error: "异常",
    info: "信息",
  };

  const formatElapsed = (seconds: number) => {
    const mm = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const ss = Math.max(0, seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${mm}:${ss}`;
  };

  useEffect(() => {
    if (!actionHint) return;
    const t = window.setTimeout(() => setActionHint(null), 4500);
    return () => window.clearTimeout(t);
  }, [actionHint]);

  const handleShare = async () => {
    if (showSpinner || storyPages.length === 0 || shareExportBusy) return;
    const bookTitle = resolveBookTitle(storyPages);
    setShareExportBusy("share");
    try {
      const r = await shareStory(storyPages, bookTitle, culture ?? undefined);
      if (r.message) setActionHint(r.message);
    } catch {
      setActionHint("分享失败，请重试");
    } finally {
      setShareExportBusy(null);
    }
  };

  const handleExport = () => {
    if (showSpinner || storyPages.length === 0 || shareExportBusy) return;
    const bookTitle = resolveBookTitle(storyPages);
    setShareExportBusy("export");
    try {
      exportStoryAsHtmlFile(storyPages, bookTitle, culture ?? undefined);
      setActionHint("已下载 HTML 文件，可用浏览器打开，或通过「打印」另存为 PDF");
    } catch {
      setActionHint("导出失败，请重试");
    } finally {
      setShareExportBusy(null);
    }
  };

  const handlePrev = () => {
    if (activeIndex > 0) setActiveIndex(activeIndex - 1);
  };
  const handleNext = () => {
    if (activeIndex < storyPages.length - 1) setActiveIndex(activeIndex + 1);
  };

  if (!activePage && !showSpinner) return null;

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      <div className="flex flex-col gap-1 mb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-cn-ink" />
            <h2 className="text-base font-bold text-cn-ink font-classical truncate max-w-[200px] sm:max-w-none">
              {showSpinner ? "新故事绘制中..." : `《${activePage.title}》`}
            </h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {onAddToBookshelf && !showSpinner && (
              <button
                type="button"
                onClick={onAddToBookshelf}
                className="flex items-center gap-1 border-2 border-cn-ink rounded-full bg-cn-green/90 text-white px-2 py-0.5 font-bold text-[10px] hover:bg-cn-green transition-colors"
              >
                <BookMarked className="w-3 h-3" /> 添加至书架
              </button>
            )}
            <button
              type="button"
              onClick={handleShare}
              disabled={showSpinner || storyPages.length === 0 || !!shareExportBusy}
              className="flex items-center gap-1 border-2 border-cn-ink rounded-full bg-cn-paper px-2 py-0.5 font-bold text-[10px] hover:bg-cn-azure hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              <Share2 className="w-3 h-3" /> {shareExportBusy === "share" ? "…" : "分享"}
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={showSpinner || storyPages.length === 0 || !!shareExportBusy}
              className="flex items-center gap-1 border-2 border-cn-ink rounded-full bg-cn-yellow px-2 py-0.5 font-bold text-cn-ink text-[10px] hover:bg-cn-red hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              <Download className="w-3 h-3" /> {shareExportBusy === "export" ? "…" : "导出"}
            </button>
          </div>
        </div>
        {actionHint ? (
          <p className="text-[11px] text-cn-azure font-bold leading-snug px-0.5">{actionHint}</p>
        ) : null}
      </div>

      <div
        className="flex-1 relative flex items-center justify-center bg-cn-paper/30 rounded-xl border-2 border-cn-ink/10 mb-3 overflow-hidden min-h-0"
      >
        <button
          type="button"
          onClick={handlePrev}
          disabled={activeIndex === 0 || showSpinner}
          className="absolute left-3 z-40 p-2 rounded-full border-2 border-cn-ink bg-white/95 shadow-sm disabled:opacity-0 transition-all hover:bg-cn-yellow hover:scale-110 active:scale-95"
        >
          <ChevronLeft className="w-6 h-6 text-cn-ink" />
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={activeIndex >= storyPages.length - 1 || showSpinner}
          className="absolute right-3 z-40 p-2 rounded-full border-2 border-cn-ink bg-white/95 shadow-sm disabled:opacity-0 transition-all hover:bg-cn-yellow hover:scale-110 active:scale-95"
        >
          <ChevronRight className="w-6 h-6 text-cn-ink" />
        </button>

        {!showSpinner && activePage ? (
          <div className="w-full h-full relative bg-white flex-shrink-0">
            <div className="w-full h-full relative">
              <img src={activePage.imageUrl} className="w-full h-full object-cover" alt={activePage.title} />
              <div className="absolute inset-0 bg-paper-texture opacity-20 pointer-events-none mix-blend-multiply" />

              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1">
                <div className="bg-cn-ink/80 backdrop-blur-md px-4 py-1.5 rounded-lg border border-white/20 shadow-lg">
                  <h3 className="text-sm font-bold text-white font-classical tracking-[0.25em]">{activePage.title}</h3>
                </div>
                <span className="text-[9px] font-black bg-white/90 text-cn-ink px-2 py-0.5 rounded-full border border-cn-ink shadow-sm">
                  {activeIndex + 1} / {storyPages.length}
                </span>
              </div>

              <div className="absolute bottom-4 left-1/2 z-20 w-[calc(100%-2rem)] max-w-5xl -translate-x-1/2 lg:bottom-6">
                <div className="bg-white/45 backdrop-blur-sm border-2 border-cn-ink/65 rounded-2xl p-3 lg:p-4 shadow-2xl relative overflow-hidden group/textbox">
                  <div className="absolute inset-1 border border-dashed border-cn-ink/15 rounded-xl pointer-events-none" />
                  <div className="relative z-10 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-4 bg-cn-red rounded-full" />
                        <span className="text-[10px] font-black text-cn-ink/90 uppercase tracking-widest">灵语者</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSpeakPage(activeIndex)}
                        className="flex items-center gap-1 px-2 py-1 border border-cn-ink rounded-full bg-cn-yellow text-cn-ink text-[9px] font-bold hover:bg-cn-green hover:text-white transition-colors"
                      >
                        <Volume2 className="w-3 h-3" /> 语音
                      </button>
                    </div>
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      className="text-base lg:text-lg leading-relaxed text-cn-ink font-medium outline-none max-h-[4.5em] overflow-y-auto hide-scrollbar drop-shadow-[0_1px_0_rgba(255,255,255,0.65)]"
                    >
                      {activePage.text}
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute top-4 right-4 z-40 flex flex-col gap-2 opacity-60 hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  className="p-2 bg-white/90 rounded-full border border-cn-ink shadow-sm hover:bg-cn-azure hover:text-white transition-all hover:scale-110 group/btn relative"
                >
                  <RefreshCw className="w-4 h-4 text-cn-ink" />
                  <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 bg-cn-ink text-white text-[10px] px-2 py-0.5 rounded opacity-0 group-hover/btn:opacity-100 whitespace-nowrap">
                    续写
                  </span>
                </button>
                <button
                  type="button"
                  className="p-2 bg-white/90 rounded-full border border-cn-ink shadow-sm hover:bg-cn-yellow transition-all hover:scale-110 group/btn relative"
                >
                  <Wand2 className="w-4 h-4 text-cn-red" />
                  <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 bg-cn-ink text-white text-[10px] px-2 py-0.5 rounded opacity-0 group-hover/btn:opacity-100 whitespace-nowrap">
                    替换
                  </span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full h-full max-w-2xl px-4 md:px-6 py-3 flex items-start justify-center overflow-y-auto agent-scroll">
            <div className="w-full rounded-2xl border-2 border-cn-ink bg-[#FCF8EE] bg-paper-texture overflow-hidden font-sans flex flex-col">
              <div className="px-4 py-3 border-b-2 border-cn-ink/25 bg-[#FDF9F0]/95 flex-shrink-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-full bg-[#F3E7CF] border-2 border-dashed border-[#6B4D2E] flex items-center justify-center rotate-[-2deg]">
                      <Wand2 className="w-6 h-6 text-[#6B4D2E] animate-pulse" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-cn-ink tracking-wide truncate">魔法工坊制作中</p>
                      <p className="text-xs font-semibold text-cn-ink/70 truncate">
                        {currentStage?.detail || progressText || "正在生成绘本，请稍候..."}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] font-bold text-cn-ink/60">已用时</p>
                    <p className="text-sm font-extrabold text-cn-ink tabular-nums">{formatElapsed(generationElapsedSec)}</p>
                  </div>
                </div>
              </div>

              <div className="p-3 md:p-4">
                <div className="grid items-start gap-3 md:grid-cols-[minmax(0,0.92fr)_minmax(220px,1.08fr)]">
                  <div className="pr-1">
                    {generationStages.length > 0 ? (
                      <div
                        className="space-y-1.5"
                      >
                        {generationStages.map((stage, idx) => {
                          const done = idx < generationStageIndex;
                          const active = idx === generationStageIndex;
                          return (
                            <div
                              key={stage.id}
                              className={`flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition-colors min-h-0 ${
                                active
                                  ? "border-2 border-[#A56E3F] bg-[#FFFDF6] opacity-90"
                                  : done
                                    ? "border-2 border-[#6B705C] bg-[rgba(107,112,92,0.06)]"
                                    : "border-2 border-dashed border-[#D1D5DB] bg-transparent"
                              }`}
                              style={active ? { animation: "stageBreath 2.6s ease-in-out infinite" } : undefined}
                            >
                              <div
                                className={`w-5 h-5 rounded-full border-2 border-dashed flex items-center justify-center text-[10px] font-extrabold bg-paper-texture flex-shrink-0 ${
                                  active
                                    ? "border-[#A56E3F] text-[#7C4E2B] bg-[#F9EEDB]"
                                    : done
                                      ? "border-[#6B705C] text-[#3F4638] bg-[rgba(107,112,92,0.12)]"
                                      : "border-cn-ink/35 text-cn-ink/45 bg-cn-paper/70"
                                }`}
                                style={{ transform: idx % 2 === 0 ? "rotate(-2deg)" : "rotate(2deg)" }}
                              >
                                {done ? "✓" : idx + 1}
                              </div>
                              <div className="min-w-0">
                                <p
                                  className={`text-[12.5px] font-semibold tracking-[0.01em] leading-snug ${
                                    active ? "text-[#6B4429]" : done ? "text-[#3F4638]" : "text-cn-ink/65"
                                  }`}
                                >
                                  {stage.title}
                                </p>
                                <p
                                  className={`text-[11px] font-medium leading-snug mt-0.5 line-clamp-2 ${
                                    active ? "text-[#6B4429]/80" : done ? "text-[#3F4638]/80" : "text-cn-ink/50"
                                  }`}
                                >
                                  {stage.detail}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm font-semibold text-cn-ink/75 text-center py-2">{progressText}</p>
                    )}
                  </div>

                  <div className="rounded-xl border-2 border-[#A56E3F]/70 bg-white/70 overflow-hidden flex flex-col">
                    <div className="px-3 py-2 border-b border-[#A56E3F]/25 bg-[#FFF8E8] flex-shrink-0">
                      <p className="text-[12px] font-black text-[#6B4429]">中枢 Agent 执行摘要</p>
                      <p className="text-[10px] font-semibold text-cn-ink/55">观察、决策、工具调用与纠偏会实时显示在这里</p>
                    </div>
                    <div className="max-h-[52vh] agent-scroll px-3 py-2 space-y-2">
                      {agentTrace.length > 0 ? (
                        agentTrace.map((entry) => (
                          <div key={entry.id} className="border-l-2 border-[#A56E3F] pl-2">
                            <div className="flex items-center gap-1.5">
                              <span className="rounded-full bg-[#F3E7CF] border border-[#A56E3F]/40 px-1.5 py-0.5 text-[9px] font-black text-[#6B4429]">
                                {traceKindLabel[entry.kind] ?? entry.kind}
                              </span>
                              <p className="text-[11px] font-extrabold text-cn-ink truncate">{entry.title}</p>
                            </div>
                            <p className="mt-1 text-[10.5px] leading-snug text-cn-ink/70">{entry.detail}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-[11px] leading-relaxed text-cn-ink/45">
                          等待中枢 Agent 完成输入理解。日志会随着生成过程逐条出现。
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <style>{`
              @keyframes stageBreath {
                0%, 100% { opacity: 0.8; }
                50% { opacity: 1; }
              }
            `}</style>
          </div>
        )}
      </div>

      {!showSpinner && (
        <div className="flex flex-col gap-2 flex-shrink-0">
          {culture?.used && culture.hits.length > 0 ? (
            <div className="rounded-xl border-2 border-dashed border-[#A56E3F] bg-[#FFF8E8] px-3 py-2">
              <button
                type="button"
                onClick={() => setCultureOpen((v) => !v)}
                className="w-full flex items-start justify-between gap-3 text-left"
                aria-expanded={cultureOpen}
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-black text-[#7C4E2B] tracking-wide">文化发掘</p>
                  <p className="text-[11px] font-bold text-cn-ink/80 truncate">
                    已检索 {culture.hits.length} 条语料，点击{cultureOpen ? "收起" : "查看"}：{culture.hits.map((h) => h.title).join("、")}
                  </p>
                </div>
                <span className="text-[10px] font-bold rounded-full border border-[#A56E3F] px-2 py-0.5 text-[#7C4E2B] bg-white/70 flex-shrink-0">
                  {cultureOpen ? "收起" : "查看"}
                </span>
              </button>
              {cultureOpen ? (
                <>
                  <div className="mt-2 grid gap-1 md:grid-cols-2">
                    {culture.hits.slice(0, 2).map((hit) => (
                      <div key={`${hit.title}-${hit.score ?? ""}`} className="text-[10px] leading-snug text-cn-ink/75">
                        <span className="font-bold text-cn-ink">{hit.title}</span>
                        {hit.score !== undefined ? <span className="text-cn-ink/45"> · {hit.score}</span> : null}
                        {hit.core_idea ? <span>：{hit.core_idea}</span> : null}
                      </div>
                    ))}
                  </div>
                  {culture.integrationNote ? (
                    <p className="mt-1 text-[10px] leading-snug text-cn-ink/60 line-clamp-2">{culture.integrationNote}</p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          <div className="h-20 flex items-center gap-3 overflow-x-auto pb-1 px-1 hide-scrollbar">
            {storyPages.map((page, idx) => (
              <button
                key={page.id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                className={`relative flex-shrink-0 h-14 aspect-[16/10] border-2 rounded-lg overflow-hidden transition-all ${
                  activeIndex === idx ? "border-cn-red shadow-sm scale-105 z-10" : "border-cn-ink opacity-60 hover:opacity-100"
                }`}
              >
                <img src={page.imageUrl} className="w-full h-full object-cover" alt="thumbnail" />
                <div className="absolute bottom-0 left-0 right-0 bg-cn-ink/60 backdrop-blur-sm text-white text-[8px] font-bold py-0.5 px-1">
                  P{idx + 1}
                </div>
              </button>
            ))}
            <button
              type="button"
              className="flex-shrink-0 h-14 aspect-[16/10] border-2 border-dashed border-cn-ink/40 rounded-lg flex flex-col items-center justify-center text-cn-ink/50 hover:bg-cn-paper transition-colors"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
