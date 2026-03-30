import { useState, useEffect } from "react";
import type { StoryPage } from "../types";
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
  onSpeakPage,
  onAddToBookshelf,
}: StoryBookPanelProps) {
  const activePage = storyPages[activeIndex] ?? storyPages[0];
  const showSpinner = isGenerating || forceLoadingOnly;
  const [actionHint, setActionHint] = useState<string | null>(null);
  const [shareExportBusy, setShareExportBusy] = useState<"share" | "export" | null>(null);

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
      const r = await shareStory(storyPages, bookTitle);
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
      exportStoryAsHtmlFile(storyPages, bookTitle);
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

      <div className="flex-1 relative flex items-center justify-center bg-cn-paper/30 rounded-xl border-2 border-cn-ink/10 mb-3 overflow-hidden min-h-0">
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

              <div className="absolute bottom-4 left-4 right-4 lg:left-8 lg:right-8 z-20">
                <div className="bg-white/90 backdrop-blur-xl border-2 border-cn-ink rounded-2xl p-4 lg:p-5 shadow-2xl relative overflow-hidden group/textbox">
                  <div className="absolute inset-1 border border-dashed border-cn-ink/10 rounded-xl pointer-events-none" />
                  <div className="relative z-10 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-4 bg-cn-red rounded-full" />
                        <span className="text-[10px] font-black text-cn-ink uppercase tracking-widest">灵语者</span>
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
                      className="text-base lg:text-lg leading-relaxed text-cn-ink font-medium outline-none max-h-[4.5em] overflow-y-auto hide-scrollbar"
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
          <div className="flex flex-col items-center justify-center gap-4 p-6">
            <div className="w-16 h-16 rounded-full bg-cn-yellow/20 flex items-center justify-center border-2 border-dashed border-cn-yellow animate-spin">
              <Wand2 className="w-8 h-8 text-cn-yellow animate-pulse" />
            </div>
            <p className="text-xl font-classical font-bold text-cn-ink tracking-widest text-center">{progressText}</p>
          </div>
        )}
      </div>

      <div className="h-20 flex items-center gap-3 overflow-x-auto pb-1 px-1 hide-scrollbar flex-shrink-0">
        {!showSpinner &&
          storyPages.map((page, idx) => (
            <button
              key={page.id}
              type="button"
              onClick={() => setActiveIndex(idx)}
              className={`relative flex-shrink-0 h-14 aspect-[4/3] border-2 rounded-lg overflow-hidden transition-all ${
                activeIndex === idx ? "border-cn-red shadow-sm scale-105 z-10" : "border-cn-ink opacity-60 hover:opacity-100"
              }`}
            >
              <img src={page.imageUrl} className="w-full h-full object-cover" alt="thumbnail" />
              <div className="absolute bottom-0 left-0 right-0 bg-cn-ink/60 backdrop-blur-sm text-white text-[8px] font-bold py-0.5 px-1">
                P{idx + 1}
              </div>
            </button>
          ))}
        {!showSpinner && (
          <button
            type="button"
            className="flex-shrink-0 h-14 aspect-[4/3] border-2 border-dashed border-cn-ink/40 rounded-lg flex flex-col items-center justify-center text-cn-ink/50 hover:bg-cn-paper transition-colors"
          >
            <Plus className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
