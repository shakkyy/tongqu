import { useCallback, useMemo, useRef, useState } from "react";
import { VoiceInput } from "./components/VoiceInput";
import { StyleSelector } from "./components/StyleSelector";
import { KeywordsSelector } from "./components/KeywordsSelector";
import { SketchPad, type SketchPadHandle } from "./components/SketchPad";
import { StoryBookPanel } from "./components/StoryBookPanel";
import { BookshelfModal } from "./components/BookshelfModal";
import {
  addBookshelfEntry,
  loadBookshelf,
  removeBookshelfEntry,
  clearBookshelf,
  type BookshelfEntry,
} from "./lib/bookshelfStorage";
import { buildKeywordsForApi, type KeywordSelectionPayload } from "./lib/keywordPayload";
import type { StoryPage, StoryStyle } from "./types";
import { Sparkles, Wand2, Mic, Type, PenTool } from "lucide-react";

const API_BASE = (import.meta as unknown as { env: Record<string, string | undefined> }).env
  .VITE_API_BASE_URL?.trim();


const OFFLINE_DEMO: StoryPage[] = [
  {
    id: "p1",
    title: "云上小船",
    text: "一片金色云朵像小船一样飘过山谷，小朋友们在草地上和它打招呼。",
    imageUrl: "https://images.unsplash.com/photo-1516715094483-75da7dee9758?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "p2",
    title: "彩虹桥",
    text: "雨后的彩虹变成一座软软的桥，大家手拉手走过去，笑声像风铃一样清脆。",
    imageUrl: "https://images.unsplash.com/photo-1472396961693-142e6e269027?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "p3",
    title: "晚安星星",
    text: "月亮升起来，星星眨眼睛，今天的故事轻轻合上，明天再继续冒险。",
    imageUrl: "https://images.unsplash.com/photo-1504208434309-cb69f4fe52b0?auto=format&fit=crop&w=1200&q=80",
  },
];

/** 已配置 API、尚未生成时 */
const WAITING_PAGES: StoryPage[] = [
  {
    id: "wait",
    title: "准备创作",
    text: "在左侧选择关键词或保持默认灵感，挑选画风后点击「开始变魔术」，真实绘本将从后端生成并显示在这里。",
    imageUrl: "https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=1200&q=80",
  },
];

export default function App() {
  const [theme] = useState<"default" | "spring">("default");
  const [creationMode, setCreationMode] = useState<"voice" | "keywords" | "sketch">("voice");
  const [isListening, setIsListening] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [style, setStyle] = useState<StoryStyle>("paper-cut");
  const [keywordPayload, setKeywordPayload] = useState<KeywordSelectionPayload>(() => ({
    theme: { tags: [], custom: "" },
    character: { tags: [], custom: "" },
    scene: { tags: [], custom: "" },
  }));
  const [remotePages, setRemotePages] = useState<StoryPage[] | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [sketchSnapshotUrl, setSketchSnapshotUrl] = useState<string | null>(null);
  const [sketchDescription, setSketchDescription] = useState("");
  const [lastBookSource, setLastBookSource] = useState<"voice" | "keywords" | "sketch" | null>(null);
  const sketchPadRef = useRef<SketchPadHandle>(null);
  const [bookshelfOpen, setBookshelfOpen] = useState(false);
  const [bookshelfItems, setBookshelfItems] = useState<BookshelfEntry[]>(() => loadBookshelf());

  const refreshBookshelf = () => setBookshelfItems(loadBookshelf());

  const canAddToShelf = useMemo(() => {
    if (!remotePages?.length) return false;
    return remotePages[0]?.id !== "wait";
  }, [remotePages]);

  const handleAddToBookshelf = useCallback(() => {
    if (!remotePages?.length || remotePages[0]?.id === "wait") return;
    const title = remotePages[0].title.split("·")[0]?.trim() || "未命名绘本";
    const src: BookshelfEntry["mode"] =
      lastBookSource === "sketch" ? "sketch" : lastBookSource === "keywords" ? "keywords" : "voice";
    try {
      addBookshelfEntry({
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        title,
        coverUrl: remotePages[0]?.imageUrl ?? "",
        pageCount: remotePages.length,
        mode: src,
        sketchThumb: lastBookSource === "sketch" ? sketchSnapshotUrl ?? undefined : undefined,
        pages: remotePages.map((p) => ({ ...p })),
      });
      refreshBookshelf();
    } catch (err) {
      console.warn("书架保存失败（可能超出浏览器存储上限）", err);
    }
  }, [remotePages, lastBookSource, sketchSnapshotUrl]);

  const onKeywordsChange = useCallback((p: KeywordSelectionPayload) => {
    setKeywordPayload(p);
  }, []);

  const storyPages = remotePages ?? (API_BASE ? WAITING_PAGES : OFFLINE_DEMO);

  const sketchSplitActive =
    creationMode === "sketch" &&
    (isGenerating ||
      (lastBookSource === "sketch" && remotePages !== null && remotePages.length > 0));

  const progressText = useMemo(() => {
    if (!isGenerating) return "";
    if (creationMode === "sketch") return "魔法画笔正在将草图变为插画...";
    if (style === "paper-cut") return "神笔马良正在帮你剪纸哦...";
    if (style === "ink-wash") return "小墨童正在挥毫泼墨...";
    if (style === "comic") return "漫画小精灵正在勾线涂色...";
    return "皮影爷爷正在点亮皮影灯...";
  }, [isGenerating, style, creationMode]);

  const speakPage = (pages: StoryPage[], index: number) => {
    const page = pages[index];
    if (!page) return;
    window.speechSynthesis.cancel();
    if (page.audioUrl && page.audioUrl.startsWith("data:audio")) {
      const a = new Audio(page.audioUrl);
      void a.play().catch(() => {
        const utterance = new SpeechSynthesisUtterance(page.text);
        utterance.lang = "zh-CN";
        utterance.rate = 0.95;
        window.speechSynthesis.speak(utterance);
      });
      return;
    }
    const utterance = new SpeechSynthesisUtterance(page.text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };

  const autoPlayPage = (index: number) => {
    setActiveIndex(index);
    speakPage(storyPages, index);
  };

  const resetSketchSession = () => {
    setSketchSnapshotUrl(null);
    if (lastBookSource === "sketch") {
      setRemotePages(null);
      setLastBookSource(null);
    }
    setActiveIndex(0);
  };

  const openBookFromShelf = (entry: BookshelfEntry) => {
    setRemotePages(entry.pages.map((p) => ({ ...p })));
    setActiveIndex(0);
    setLastBookSource(entry.mode);
    setSketchSnapshotUrl(entry.sketchThumb ?? null);
    setCreationMode(entry.mode);
  };

  const handleGenerate = async () => {
    setApiError(null);
    if (!API_BASE) {
      setApiError("未配置 VITE_API_BASE_URL。请在 tongqu-magic-book/.env 中设置，例如 http://127.0.0.1:8000 后重启 npm run dev。");
      return;
    }
    let sketchImageForApi: string | undefined;
    let sketchSnapForShelf: string | undefined;
    if (creationMode === "sketch") {
      const snap = sketchPadRef.current?.getDataURL() ?? null;
      setSketchSnapshotUrl(snap);
      sketchSnapForShelf = snap ?? undefined;
      if (snap) sketchImageForApi = snap;
      setRemotePages(null);
    }

    setIsGenerating(true);
    try {
      const sketchNote = sketchDescription.trim();
      const kw =
        creationMode === "sketch"
          ? `儿童手绘画本·根据孩子草图与理解结果创作积极向上的小故事${
              sketchNote ? `\n\n【孩子描述】${sketchNote}` : ""
            }`
          : creationMode === "keywords"
            ? buildKeywordsForApi(keywordPayload)
            : creationMode === "voice" && isListening
              ? "语音灵感"
              : "孙悟空+月亮";
      const base = API_BASE.replace(/\/$/, "");
      const res = await fetch(`${base}/api/storybook/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: kw,
          style,
          ...(sketchImageForApi ? { sketch_image_base64: sketchImageForApi } : {}),
          ...(creationMode === "sketch" && sketchNote ? { sketch_text: sketchNote } : {}),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        title?: string;
        scenes?: { text: string }[];
        image_urls?: string[];
        audio_urls?: string[];
      };
      if (!data.ok) {
        setApiError(data.detail || data.error || `请求失败（HTTP ${res.status}）`);
        if (creationMode === "sketch") setSketchSnapshotUrl(null);
        return;
      }
      if (data.scenes?.length && data.image_urls?.length && data.title) {
        const scenes = data.scenes;
        const imgs = data.image_urls;
        const n = Math.min(scenes.length, imgs.length);
        const pages: StoryPage[] = scenes.slice(0, n).map((s, i) => ({
          id: `p${i + 1}`,
          title: i === 0 ? data.title! : `${data.title} · 第${i + 1}页`,
          text: s.text,
          imageUrl: imgs[i] ?? "",
          audioUrl: data.audio_urls?.[i],
        }));
        setRemotePages(pages);
        setActiveIndex(0);
        const src: BookshelfEntry["mode"] =
          creationMode === "sketch" ? "sketch" : creationMode === "keywords" ? "keywords" : "voice";
        setLastBookSource(src);
        try {
          addBookshelfEntry({
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            title: data.title!,
            coverUrl: pages[0]?.imageUrl ?? "",
            pageCount: pages.length,
            mode: src,
            sketchThumb: creationMode === "sketch" ? sketchSnapForShelf : undefined,
            pages: pages.map((p) => ({ ...p })),
          });
          refreshBookshelf();
        } catch (err) {
          console.warn("书架保存失败（可能超出浏览器存储上限）", err);
        }
        queueMicrotask(() => speakPage(pages, 0));
      } else {
        setApiError("后端返回数据不完整（缺少 title / scenes / image_urls）");
        if (creationMode === "sketch") setSketchSnapshotUrl(null);
      }
    } catch (e) {
      console.error(e);
      setApiError(e instanceof Error ? e.message : "网络错误，请确认后端已启动");
      if (creationMode === "sketch") setSketchSnapshotUrl(null);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div data-theme={theme === "default" ? undefined : theme} className="h-screen bg-theme-bg bg-paper-texture font-classical text-theme-text flex flex-col overflow-hidden">
      {/* Top Navigation Bar - Ultra Compact */}
      <header className="h-12 flex items-center justify-between px-6 bg-theme-surface/95 border-b-2 border-theme-text sticky top-0 z-50 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-theme-primary p-1 rounded-lg border-2 border-theme-text">
            <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-lg font-extrabold tracking-tight text-theme-text font-classical">
            童趣绘梦 <span className="text-xs text-theme-text/40 font-classical ml-1 hidden sm:inline">AI绘本创作平台</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              refreshBookshelf();
              setBookshelfOpen(true);
            }}
            className="text-xs font-bold border-2 border-theme-text rounded-full px-3 py-1 bg-theme-bg hover:bg-theme-secondary hover:text-white transition-colors"
          >
            我的书架
          </button>
          <div className="w-8 h-8 rounded-full border-2 border-theme-text bg-theme-success overflow-hidden">
            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=kid&backgroundColor=2AAD6E`} alt="avatar" />
          </div>
        </div>
      </header>

      {/* Main Content Area - No vertical scroll */}
      <main className="flex-1 flex flex-col lg:flex-row w-full px-4 lg:px-6 py-3 gap-6 lg:gap-8 overflow-hidden min-h-0">
        
        {/* Left Sidebar: Creation Tools - Internal scroll only */}
        <aside className="lg:w-[360px] flex flex-col flex-shrink-0 bg-white border-handdrawn p-4 shadow-kid overflow-y-auto hide-scrollbar font-classical">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 border-b-2 border-dashed border-theme-text/20 pb-2">
              <Wand2 className="w-4 h-4 text-theme-primary" strokeWidth={2.5} />
              <h2 className="text-lg font-bold text-theme-text font-classical">创作魔法室</h2>
            </div>
            
            {/* Mode Tabs */}
            <div className="flex bg-theme-bg border-2 border-theme-text rounded-full p-0.5 gap-0.5">
              <button
                onClick={() => setCreationMode("voice")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full font-bold text-[11px] ${creationMode === "voice" ? "bg-theme-surface border-2 border-theme-text shadow-[1px_1px_0px_#1A2B3C]" : "text-theme-text/40 hover:text-theme-text"}`}
              >
                <Mic className="w-3 h-3" /> 语音
              </button>
              <button
                onClick={() => setCreationMode("keywords")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full font-bold text-[11px] ${creationMode === "keywords" ? "bg-theme-surface border-2 border-theme-text shadow-[1px_1px_0px_#1A2B3C]" : "text-theme-text/40 hover:text-theme-text"}`}
              >
                <Type className="w-3 h-3" /> 选词
              </button>
              <button
                onClick={() => setCreationMode("sketch")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full font-bold text-[11px] ${creationMode === "sketch" ? "bg-theme-surface border-2 border-theme-text shadow-[1px_1px_0px_#1A2B3C]" : "text-theme-text/40 hover:text-theme-text"}`}
              >
                <PenTool className="w-3 h-3" /> 草图
              </button>
            </div>
            
            {/* Step 1: Input Area */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full border-2 border-cn-ink bg-cn-yellow flex items-center justify-center font-bold text-cn-ink text-[10px]">1</div>
                <h3 className="text-sm font-bold text-cn-ink">
                  {creationMode === "voice" && "说出你的故事"}
                  {creationMode === "keywords" && "拼凑故事元素"}
                  {creationMode === "sketch" && "画出你的灵感"}
                </h3>
              </div>
              
              <div className="relative">
                <div className={creationMode === "voice" ? "" : "hidden"}>
                  <div className="flex flex-col gap-3">
                    <div className="py-1 flex justify-center">
                      <VoiceInput isListening={isListening} onToggle={() => setIsListening((v) => !v)} />
                    </div>
                    <div className="bg-cn-paper/50 border-2 border-dashed border-cn-ink/30 p-2 rounded-xl min-h-[40px] text-cn-ink/50 text-[11px]">
                      {isListening ? "正在变魔术..." : "录音内容显示区"}
                    </div>
                  </div>
                </div>
                
                <div className={creationMode === "keywords" ? "" : "hidden"}>
                  <div className="bg-cn-paper/30 border-2 border-dashed border-cn-ink/30 p-2 rounded-lg scale-[0.85] origin-top">
                    <KeywordsSelector onSelectionChange={onKeywordsChange} />
                  </div>
                </div>

                <div className={creationMode === "sketch" ? "" : "hidden"}>
                  {sketchSplitActive && sketchSnapshotUrl ? (
                    <div className="bg-cn-azure/10 border-2 border-dashed border-cn-azure p-2 rounded-lg flex flex-col items-center gap-2 min-h-[100px]">
                      <p className="text-cn-azure font-bold text-[10px] w-full text-left">我的草图</p>
                      <img
                        src={sketchSnapshotUrl}
                        alt="孩子画的草图"
                        className="w-full max-h-[112px] object-contain rounded-md border border-cn-ink/15 bg-white"
                      />
                      <button
                        type="button"
                        onClick={resetSketchSession}
                        className="w-full text-[10px] font-bold py-1.5 rounded-lg border-2 border-cn-ink bg-white hover:bg-cn-yellow transition-colors"
                      >
                        重新画一张
                      </button>
                    </div>
                  ) : (
                    <div className="bg-cn-azure/10 border-2 border-dashed border-cn-azure p-3 rounded-lg text-center flex flex-col items-center justify-center gap-1 min-h-[100px]">
                      <PenTool className="w-4 h-4 text-cn-azure animate-bounce" />
                      <p className="text-cn-azure font-bold text-[11px] mt-1">魔法画板就绪</p>
                      <p className="text-cn-ink/50 text-[9px] px-1">右侧大画布作画</p>
                    </div>
                  )}
                  <label className="flex flex-col gap-1 mt-2">
                    <span className="text-[10px] font-bold text-cn-ink/80">一句话说说你的画（可选）</span>
                    <textarea
                      value={sketchDescription}
                      onChange={(e) => setSketchDescription(e.target.value.slice(0, 300))}
                      rows={2}
                      maxLength={300}
                      placeholder="例如：小熊在天上飞"
                      disabled={isGenerating}
                      className="w-full text-[11px] rounded-lg border-2 border-cn-azure/40 bg-white p-2 text-cn-ink placeholder:text-cn-ink/40 resize-none disabled:opacity-60"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Step 2: Style Selection */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full border-2 border-cn-ink bg-cn-red flex items-center justify-center font-bold text-white text-[10px]">2</div>
                <h3 className="text-sm font-bold text-cn-ink">挑选插画画风</h3>
              </div>
              <div className="scale-90 origin-left">
                <StyleSelector value={style} onChange={setStyle} />
              </div>
            </div>

            {/* Generate Action */}
            <div className="pt-1 flex flex-col gap-2">
              {apiError && (
                <p className="text-[11px] text-red-600 font-bold leading-snug border border-red-200 bg-red-50 rounded-lg px-2 py-1.5">
                  {apiError}
                </p>
              )}
              {!API_BASE && (
                <p className="text-[10px] text-cn-ink/60">
                  提示：配置 VITE_API_BASE_URL 并启动 tongqu-agent-backend 后可调用真实 API。
                </p>
              )}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                className={`w-full flex items-center justify-center gap-2 border-handdrawn px-4 py-2.5 text-base font-bold transition-all ${
                  isGenerating ? "bg-cn-paper opacity-80 text-cn-ink" : "bg-cn-red text-white shadow-[1px_2px_0px_#1A2B3C] hover:translate-y-[-1px]"
                }`}
              >
                <Sparkles className={`w-4 h-4 ${isGenerating ? "animate-spin" : ""}`} strokeWidth={2.5} />
                <span className="font-classical tracking-widest text-lg">开始变魔术</span>
              </button>
            </div>
          </div>
        </aside>

        {/* 右侧：草图模式始终挂载画板（hidden 保留画布），分栏时同区展示绘本 */}
        <section className="flex-1 flex flex-col bg-white border-handdrawn p-4 shadow-kid relative overflow-hidden min-h-0 min-w-0">
          {creationMode === "sketch" && (
            <div
              className={
                sketchSplitActive
                  ? "hidden"
                  : "flex-1 flex flex-col h-full min-h-0 min-w-0"
              }
              aria-hidden={sketchSplitActive}
            >
              <SketchPad ref={sketchPadRef} isGenerating={isGenerating} progressText={progressText} />
            </div>
          )}
          {(creationMode !== "sketch" || sketchSplitActive) && (
            <StoryBookPanel
              storyPages={storyPages}
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              isGenerating={isGenerating}
              forceLoadingOnly={creationMode === "sketch" && isGenerating}
              progressText={progressText}
              onSpeakPage={(i) => autoPlayPage(i)}
              onAddToBookshelf={canAddToShelf ? handleAddToBookshelf : undefined}
            />
          )}
        </section>
      </main>

      <BookshelfModal
        open={bookshelfOpen}
        onClose={() => setBookshelfOpen(false)}
        items={bookshelfItems}
        onRemove={(id) => {
          removeBookshelfEntry(id);
          refreshBookshelf();
        }}
        onClearAll={() => {
          clearBookshelf();
          refreshBookshelf();
        }}
        onOpenBook={openBookFromShelf}
      />
    </div>
  );
}
