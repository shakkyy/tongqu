import { useState, useEffect, useRef } from "react";
import type {
  AgentTraceEntry,
  CultureRagInfo,
  FamilyCoCreationMeta,
  InteractionCard,
  StoryPage,
  StyleKeywordEnhancement,
} from "../types";
import { buildExportPreviewDocument, resolveBookTitle, shareStory } from "../lib/shareAndExport";
import type { ExportPreviewDocument } from "../lib/shareAndExport";
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
  CheckCircle2,
  CircleDot,
  GitBranch,
  Loader2,
  MessageCircleQuestion,
  Mic2,
  Paintbrush,
  Send,
  Sparkles,
  ScrollText,
  Theater,
  X,
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
  familyCoCreation?: FamilyCoCreationMeta;
  interactionCards?: InteractionCard[];
  styleKeywordEnhancements?: StyleKeywordEnhancement[];
  styleKeywords?: string[];
  onSpeakPage: (index: number) => void;
  onRewritePage?: (index: number, instruction: string) => Promise<boolean>;
  rewritingPageIndex?: number | null;
  /** 当前为已生成绘本时显示，手动加入书架 */
  onAddToBookshelf?: () => void;
}

type WorkflowStage = {
  id: string;
  title: string;
  detail: string;
};

type DagStatus = "done" | "active" | "pending";
type DetailModal = "culture" | "interaction" | "ranker" | null;

function WorkflowDag({
  stages,
  activeIndex,
}: {
  stages: WorkflowStage[];
  activeIndex: number;
}) {
  const stageById = Object.fromEntries(stages.map((stage) => [stage.id, stage]));
  const stageIndexById = Object.fromEntries(stages.map((stage, idx) => [stage.id, idx]));
  const hasSketch = Boolean(stageById.sketch);

  const statusOf = (id: string): DagStatus => {
    if (id === "book") {
      return activeIndex >= stages.length - 1 ? "active" : "pending";
    }
    const idx = stageIndexById[id];
    if (idx === undefined) return "pending";
    if (idx < activeIndex) return "done";
    if (idx === activeIndex) return "active";
    return "pending";
  };

  const flow = [
    "queued",
    ...(hasSketch ? ["sketch"] : []),
    "culture",
    "orchestrate",
    "draft",
    "board",
    "ranker",
    "image",
    "tts",
    "review",
    "book",
  ].filter((id) => id === "book" || Boolean(stageById[id]));

  const visualStageTitle = stageById.sketch?.title || "";
  const isFamilyVisualStage = /合照|亲子/.test(visualStageTitle);
  const labelById: Record<string, { title: string; role?: string }> = {
    queued: { title: "输入素材" },
    sketch: { title: isFamilyVisualStage ? "亲子素材理解" : "草图理解", role: "子Agent" },
    culture: { title: "文化检索", role: "子Agent" },
    orchestrate: { title: "中枢", role: "Agent" },
    draft: { title: "故事撰写", role: "子Agent" },
    board: { title: "分镜导演", role: "子Agent" },
    ranker: { title: "墨韵", role: "Ranker" },
    image: { title: "插画生成", role: "子Agent" },
    tts: { title: "朗读合成", role: "子Agent" },
    review: { title: "安全审阅", role: "子Agent" },
    book: { title: "成书汇总" },
  };

  const positionById: Record<string, { x: number; y: number; w: number; hub?: boolean }> = {
    queued: { x: 50, y: 6, w: 70 },
    sketch: { x: 25, y: 16, w: 78 },
    culture: { x: 75, y: 16, w: 78 },
    orchestrate: { x: 50, y: 28, w: 86, hub: true },
    ranker: { x: 25, y: 44, w: 78 },
    draft: { x: 75, y: 44, w: 78 },
    board: { x: 50, y: 56, w: 78 },
    image: { x: 25, y: 69, w: 78 },
    tts: { x: 75, y: 69, w: 78 },
    review: { x: 50, y: 81, w: 78 },
    book: { x: 50, y: 94, w: 78 },
  };
  const graphNodes = flow
    .map((id) => ({ id, ...positionById[id] }))
    .filter((node) => typeof node.x === "number");
  const graphNodeIds = new Set(graphNodes.map((node) => node.id));
  const edges = [
    ["queued", "orchestrate"],
    ["sketch", "orchestrate"],
    ["culture", "orchestrate"],
    ["orchestrate", "draft"],
    ["orchestrate", "ranker"],
    ["orchestrate", "board"],
    ["ranker", "image"],
    ["draft", "board"],
    ["board", "image"],
    ["board", "tts"],
    ["image", "review"],
    ["tts", "review"],
    ["review", "book"],
  ].filter(([from, to]) => graphNodeIds.has(from) && graphNodeIds.has(to));

  const edgeStatus = (from: string, to: string): DagStatus => {
    const toStatus = statusOf(to);
    if (toStatus === "active") return "active";
    if (statusOf(from) === "done" && toStatus === "done") return "done";
    return "pending";
  };

  const renderNode = (node: { id: string; x: number; y: number; w: number; hub?: boolean }) => {
    const { id, x, y, w, hub } = node;
    const label = labelById[id];
    const status = statusOf(id);
    const Icon = status === "done" ? CheckCircle2 : status === "active" ? Loader2 : CircleDot;
    const compact = id === "queued" || id === "book";
    return (
      <div
        key={id}
        style={{ left: `${x}%`, top: `${y}%`, width: `${w}px` }}
        className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
      >
        <div
          className={`relative flex flex-col items-center justify-center rounded-lg border-2 px-1.5 text-center shadow-sm transition-all ${
            status === "active"
              ? "border-[#D54B35] bg-[#FFF1D6] shadow-[0_0_18px_rgba(213,75,53,0.22)]"
              : status === "done"
                ? "border-[#2AAD6E] bg-[#EAF8EF]"
                : "border-dashed border-cn-ink/28 bg-white/80"
          } ${hub ? "h-[58px]" : compact ? "h-[36px]" : "h-[44px]"}`}
        >
          <div className="mb-0.5 flex items-center justify-center">
            <span
              className={`flex flex-shrink-0 items-center justify-center rounded-full border bg-white ${
                status === "active"
                  ? "border-[#D54B35] text-[#D54B35]"
                  : status === "done"
                    ? "border-[#2AAD6E] text-[#167C4C]"
                    : "border-cn-ink/25 text-cn-ink/40"
              } ${hub ? "h-6 w-6" : "h-4 w-4"}`}
            >
              <Icon className={`${hub ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} ${status === "active" ? "animate-spin" : ""}`} />
            </span>
          </div>
          <p className={`whitespace-nowrap font-black leading-none text-cn-ink ${hub ? "text-[12px]" : "text-[9.5px]"}`}>
            {label.title}
          </p>
          {label.role ? (
            <p className={`mt-1 whitespace-nowrap font-black leading-none ${id === "ranker" ? "text-cn-ink/55" : "text-cn-ink/45"} ${hub ? "text-[10px]" : "text-[8.5px]"}`}>
              {label.role}
            </p>
          ) : null}
          {status === "active" && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#D54B35] animate-ping" />}
        </div>
      </div>
    );
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col rounded-2xl border-2 border-[#1A2B3C] bg-[#FFFDF6] p-3 shadow-[3px_3px_0px_rgba(26,43,60,0.18)]">
      <div className="mb-2 flex flex-shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2 rounded-full border border-cn-ink/20 bg-white px-2.5 py-1 text-[10px] font-black text-cn-ink">
          <GitBranch className="h-3.5 w-3.5 text-[#D54B35]" />
          Agent 编排图
        </div>
        <p className="text-[10px] font-bold text-cn-ink/45">输入汇入中枢，底部成书</p>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-[radial-gradient(circle_at_48%_50%,rgba(255,241,214,0.9),rgba(255,253,246,0.38)_45%,rgba(255,255,255,0.72)_100%)]">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id="agent-arrow" markerHeight="5" markerWidth="5" orient="auto" refX="4.5" refY="2.5">
              <path d="M0,0 L5,2.5 L0,5 Z" fill="#D54B35" opacity="0.7" />
            </marker>
          </defs>
          {edges.map(([from, to]) => {
            const start = positionById[from];
            const end = positionById[to];
            const status = edgeStatus(from, to);
            return (
              <line
                key={`${from}-${to}`}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={status === "pending" ? "#1A2B3C" : status === "done" ? "#2AAD6E" : "#D54B35"}
                strokeDasharray={status === "pending" ? "4 4" : status === "active" ? "5 3" : "0"}
                strokeLinecap="round"
                strokeOpacity={status === "pending" ? 0.24 : 0.65}
                strokeWidth={status === "active" ? 1.1 : 0.75}
                markerEnd={status === "pending" ? undefined : "url(#agent-arrow)"}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0">
          {graphNodes.map((node) => (
            renderNode(node)
          ))}
        </div>
      </div>
    </div>
  );
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
  familyCoCreation,
  interactionCards = [],
  styleKeywordEnhancements = [],
  styleKeywords = [],
  onSpeakPage,
  onRewritePage,
  rewritingPageIndex = null,
  onAddToBookshelf,
}: StoryBookPanelProps) {
  const activePage = storyPages[activeIndex] ?? storyPages[0];
  const showSpinner = isGenerating || forceLoadingOnly;
  const [actionHint, setActionHint] = useState<string | null>(null);
  const [shareExportBusy, setShareExportBusy] = useState<"share" | "export" | "memory" | null>(null);
  const [exportPreview, setExportPreview] = useState<ExportPreviewDocument | null>(null);
  const [detailModal, setDetailModal] = useState<DetailModal>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteText, setRewriteText] = useState("");
  const [rewriteHint, setRewriteHint] = useState<string | null>(null);
  const [rewriteListening, setRewriteListening] = useState(false);
  const traceScrollRef = useRef<HTMLDivElement | null>(null);
  const exportFrameRef = useRef<HTMLIFrameElement | null>(null);
  const currentStage = generationStages[Math.min(generationStageIndex, Math.max(generationStages.length - 1, 0))];
  const isRewriteBusy = rewritingPageIndex === activeIndex;
  const cultureNames = culture?.hits.map((hit) => hit.title).filter(Boolean).join("、") || "传统文化线索";
  const rankerKeywords = Array.from(
    new Set([
      ...styleKeywords,
      ...styleKeywordEnhancements.flatMap((item) => item.selected_keywords || []),
    ].filter((keyword): keyword is string => Boolean(keyword))),
  );
  const familyNames =
    familyCoCreation?.members?.filter((member) => member.enabled).map((member) => member.displayName || member.relation).join("、") || "家长和孩子";
  const traceKindLabel: Record<string, string> = {
    observe: "观察",
    decision: "决策",
    tool_call: "子Agent",
    tool_result: "结果",
    tool_error: "错误",
    repair: "纠偏",
    finish: "完成",
    error: "异常",
    info: "信息",
  };
  const subAgentLabelByTool: Record<string, string> = {
    analyze_sketch: "草图理解子Agent",
    retrieve_culture: "文化基因检索子Agent",
    draft_story: "故事撰写子Agent",
    review_safety: "安全审查子Agent",
    generate_storyboard: "分镜导演子Agent",
    finish_creation: "成书统筹子Agent",
  };

  const getTraceToolName = (entry: AgentTraceEntry) => {
    const text = `${entry.title} ${entry.detail}`;
    return (
      text.match(/(?:调用工具|工具结果|工具返回错误)：([a-z_]+)/)?.[1] ||
      text.match(/\b(analyze_sketch|retrieve_culture|draft_story|review_safety|generate_storyboard|finish_creation)\b/)?.[1] ||
      null
    );
  };

  const displayTraceEntry = (entry: AgentTraceEntry) => {
    const toolName = getTraceToolName(entry);
    const rawText = `${entry.title} ${entry.detail}`;
    const subAgentLabel =
      toolName === "analyze_sketch" && /合照|亲子/.test(rawText)
        ? "亲子素材理解子Agent"
        : toolName
          ? subAgentLabelByTool[toolName]
          : null;
    if (rawText.includes("墨韵 Ranker")) {
      return {
        kindLabel: "Ranker",
        title: entry.title,
        detail: entry.detail,
      };
    }
    if (!subAgentLabel) {
      return {
        kindLabel: traceKindLabel[entry.kind] ?? entry.kind,
        title: entry.title,
        detail: entry.detail,
      };
    }
    if (entry.kind === "tool_call") {
      return { kindLabel: "子Agent", title: `启动：${subAgentLabel}`, detail: entry.detail };
    }
    if (entry.kind === "tool_result") {
      return { kindLabel: "子Agent", title: `完成：${subAgentLabel}`, detail: entry.detail };
    }
    if (entry.kind === "tool_error") {
      return { kindLabel: "子Agent", title: `异常：${subAgentLabel}`, detail: entry.detail };
    }
    return {
      kindLabel: traceKindLabel[entry.kind] ?? entry.kind,
      title: entry.title,
      detail: entry.detail,
    };
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

  useEffect(() => {
    const el = traceScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [agentTrace.length]);

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

  const openExportPreview = async (memoryBook: boolean) => {
    if (showSpinner || storyPages.length === 0 || shareExportBusy) return;
    const bookTitle = resolveBookTitle(storyPages);
    setShareExportBusy(memoryBook ? "memory" : "export");
    try {
      const preview = await buildExportPreviewDocument(storyPages, bookTitle, culture ?? undefined, memoryBook
        ? {
            family: familyCoCreation,
            interactionCards,
            memoryBook: true,
          }
        : undefined);
      setExportPreview(preview);
      setActionHint(null);
    } catch {
      setActionHint(memoryBook ? "纪念册预览生成失败，请重试" : "导出预览生成失败，请重试");
    } finally {
      setShareExportBusy(null);
    }
  };

  const handleExport = () => {
    void openExportPreview(false);
  };

  const handleMemoryExport = () => {
    void openExportPreview(true);
  };

  const handlePrintExportPreview = () => {
    if (!exportPreview) {
      setActionHint("预览还没准备好，请稍后再试");
      return;
    }
    const printWindow = window.open("", "_blank", "width=980,height=1200");
    if (!printWindow) {
      setActionHint("浏览器拦截了 PDF 导出窗口，请允许弹窗后再试");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(exportPreview.html);
    printWindow.document.close();
    printWindow.document.title = exportPreview.filename.replace(/\.pdf$/i, "");
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 300);
    setActionHint("已打开 PDF 导出预览，可在系统窗口选择保存为 PDF");
  };

  const handlePrev = () => {
    if (activeIndex > 0) setActiveIndex(activeIndex - 1);
  };
  const handleNext = () => {
    if (activeIndex < storyPages.length - 1) setActiveIndex(activeIndex + 1);
  };

  const openRewritePanel = () => {
    if (!activePage || !onRewritePage) return;
    setRewriteText("");
    setRewriteHint(null);
    setRewriteOpen(true);
  };

  const handleRewriteSubmit = async () => {
    if (!onRewritePage || isRewriteBusy) return;
    const instruction = rewriteText.trim();
    if (!instruction) {
      setRewriteHint("先输入想替换成什么画面或情节。");
      return;
    }
    setRewriteHint(null);
    const ok = await onRewritePage(activeIndex, instruction);
    if (ok) {
      setRewriteOpen(false);
      setRewriteText("");
    } else {
      setRewriteHint("替换没有完成，左侧会显示具体错误。");
    }
  };

  const startRewriteVoiceInput = () => {
    type SpeechRecognitionResultLike = { 0?: { transcript?: string } };
    type SpeechRecognitionEventLike = { results: ArrayLike<SpeechRecognitionResultLike> };
    type SpeechRecognitionLike = {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: ((event: SpeechRecognitionEventLike) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
    };
    type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setRewriteHint("当前浏览器不支持本地语音输入，请直接打字。");
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const text = Array.from(event.results)
        .map((item) => item[0]?.transcript || "")
        .join("")
        .trim();
      if (text) {
        setRewriteText((prev) => `${prev}${prev.trim() ? " " : ""}${text}`.slice(0, 500));
      }
    };
    recognition.onerror = () => {
      setRewriteHint("没有听清楚，可以再试一次或直接打字。");
      setRewriteListening(false);
    };
    recognition.onend = () => setRewriteListening(false);
    setRewriteListening(true);
    recognition.start();
  };

  if (!activePage && !showSpinner) return null;

  return (
    <div className="relative flex-1 flex flex-col h-full min-h-0">
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
            {(familyCoCreation || interactionCards.length > 0) && (
              <button
                type="button"
                onClick={handleMemoryExport}
                disabled={showSpinner || storyPages.length === 0 || !!shareExportBusy}
                className="flex items-center gap-1 border-2 border-cn-ink rounded-full bg-cn-red/15 px-2 py-0.5 font-bold text-cn-ink text-[10px] hover:bg-cn-red hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <BookMarked className="w-3 h-3" /> {shareExportBusy === "memory" ? "…" : "纪念册"}
              </button>
            )}
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
                    disabled={!onRewritePage || isRewriteBusy}
                    onClick={openRewritePanel}
	                  className="p-2 bg-white/90 rounded-full border border-cn-ink shadow-sm hover:bg-cn-yellow transition-all hover:scale-110 group/btn relative"
	                >
	                  {isRewriteBusy ? <Loader2 className="w-4 h-4 text-cn-red animate-spin" /> : <Wand2 className="w-4 h-4 text-cn-red" />}
	                  <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 bg-cn-ink text-white text-[10px] px-2 py-0.5 rounded opacity-0 group-hover/btn:opacity-100 whitespace-nowrap">
	                    {isRewriteBusy ? "替换中" : "替换"}
	                  </span>
	                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full h-full max-w-5xl px-4 md:px-6 py-3 flex items-stretch justify-center overflow-hidden">
            <div className="w-full max-h-full min-h-0 rounded-2xl border-2 border-cn-ink bg-[#FCF8EE] bg-paper-texture overflow-hidden font-sans flex flex-col">
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

              <div className="min-h-0 flex-1 overflow-hidden p-3 md:p-4">
                <div className="grid h-full min-h-0 items-stretch gap-3 lg:grid-cols-[minmax(320px,0.9fr)_minmax(360px,1fr)]">
                  <div className="min-h-0">
                    {generationStages.length > 0 ? (
                      <WorkflowDag stages={generationStages} activeIndex={generationStageIndex} />
                    ) : (
                      <p className="text-sm font-semibold text-cn-ink/75 text-center py-2">{progressText}</p>
                    )}
                  </div>

                  <div className="min-h-0 rounded-xl border-2 border-[#A56E3F]/70 bg-white overflow-hidden flex flex-col">
                    <div className="px-3 py-2 border-b border-[#A56E3F]/25 bg-[#FFF8E8] flex-shrink-0">
                      <p className="text-[12px] font-black text-[#6B4429]">右侧详细信息</p>
                      <p className="text-[10px] font-semibold text-cn-ink/55">当前步骤与子Agent执行摘要固定显示在这里</p>
                    </div>
                    <div className="border-b border-[#A56E3F]/20 bg-white px-3 py-2">
                      <p className="text-[10px] font-black text-cn-ink/50">当前步骤</p>
                      <p className="mt-0.5 text-[13px] font-black text-cn-ink">{currentStage?.title || "准备中"}</p>
                      <p className="mt-0.5 text-[11px] font-semibold leading-snug text-cn-ink/65">
                        {currentStage?.detail || progressText || "等待生成流程启动"}
                      </p>
                    </div>
                    <div ref={traceScrollRef} className="min-h-0 flex-1 overflow-y-auto agent-scroll bg-white px-3 py-2 space-y-2">
                      {agentTrace.length > 0 ? (
                        agentTrace.map((entry) => {
                          const display = displayTraceEntry(entry);
                          return (
                            <div key={entry.id} className="border-l-2 border-[#A56E3F] pl-2">
                              <div className="flex items-center gap-1.5">
                                <span className="rounded-full bg-[#F3E7CF] border border-[#A56E3F]/40 px-1.5 py-0.5 text-[9px] font-black text-[#6B4429]">
                                  {display.kindLabel}
                                </span>
                                <p className="text-[11px] font-extrabold text-cn-ink truncate">{display.title}</p>
                              </div>
                              <p className="mt-1 text-[10.5px] leading-snug text-cn-ink/70">{display.detail}</p>
                            </div>
                          );
                        })
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

      {rewriteOpen && activePage && !showSpinner ? (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-cn-ink/55 backdrop-blur-[2px] px-4">
          <div className="w-full max-w-lg rounded-2xl border-2 border-cn-ink bg-[#FFFDF6] p-4 shadow-[4px_4px_0px_rgba(26,43,60,0.28)]">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-cn-ink">替换第 {activeIndex + 1} 页</p>
                <p className="mt-0.5 text-[11px] font-bold leading-snug text-cn-ink/70">
                  只更新当前页的旁白、画面和语音，角色与画风会沿用整本书设定。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRewriteOpen(false)}
                disabled={isRewriteBusy}
                className="rounded-full border-2 border-cn-ink bg-white p-1 hover:bg-cn-yellow disabled:opacity-50"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="rounded-xl border border-cn-ink/25 bg-white p-2">
              <p className="line-clamp-2 text-[11px] font-bold leading-snug text-cn-ink/80">当前旁白：{activePage.text}</p>
            </div>
            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-[11px] font-black text-cn-ink">想替换成什么？</span>
              <textarea
                value={rewriteText}
                onChange={(e) => setRewriteText(e.target.value.slice(0, 500))}
                disabled={isRewriteBusy}
                rows={5}
                maxLength={500}
                placeholder="例如：把这一页改成孙悟空和小兔子在竹林里点亮灯笼。"
                className="w-full resize-none rounded-xl border-2 border-cn-ink/35 bg-white/95 p-3 text-sm leading-relaxed text-cn-ink outline-none placeholder:text-cn-ink/35 focus:border-cn-red disabled:opacity-60"
              />
            </label>
            {rewriteHint ? <p className="mt-2 text-[11px] font-bold leading-snug text-cn-red">{rewriteHint}</p> : null}
            <div className="mt-3 flex flex-wrap justify-between gap-2">
              <button
                type="button"
                onClick={startRewriteVoiceInput}
                disabled={isRewriteBusy || rewriteListening}
                className="flex items-center gap-1.5 rounded-full border-2 border-cn-ink bg-cn-paper px-3 py-1.5 text-xs font-bold hover:bg-cn-azure hover:text-white disabled:opacity-50"
              >
                {rewriteListening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic2 className="h-3.5 w-3.5" />}
                {rewriteListening ? "听你说..." : "语音输入"}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRewriteOpen(false)}
                  disabled={isRewriteBusy}
                  className="rounded-full border-2 border-cn-ink bg-white px-3 py-1.5 text-xs font-bold hover:bg-cn-paper disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void handleRewriteSubmit()}
                  disabled={isRewriteBusy || !rewriteText.trim()}
                  className="flex items-center gap-1.5 rounded-full border-2 border-cn-ink bg-cn-red px-4 py-1.5 text-xs font-bold text-white hover:bg-cn-yellow hover:text-cn-ink disabled:opacity-50"
                >
                  {isRewriteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {isRewriteBusy ? "替换中" : "更新本页"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!showSpinner && (
        <div className="flex flex-col gap-2 flex-shrink-0">
          {(culture?.used && culture.hits.length > 0) || interactionCards.length > 0 || rankerKeywords.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-3">
              {culture?.used && culture.hits.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setDetailModal("culture")}
                  className="group flex min-h-[70px] items-center gap-3 rounded-xl border-2 border-[#A56E3F] bg-[#FFF8E8] px-3 py-2 text-left shadow-[2px_2px_0px_rgba(124,78,43,0.16)] transition-all hover:-translate-y-0.5 hover:bg-[#FFF1D6]"
                >
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border-2 border-[#A56E3F] bg-white text-[#7C4E2B] shadow-sm">
                    <ScrollText className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-black text-[#6B4429]">文化基因卡</span>
                    <span className="mt-0.5 block truncate text-[11px] font-bold text-cn-ink/70">
                      {cultureNames}
                    </span>
                  </span>
                  <span className="rounded-full border border-[#A56E3F]/60 bg-white/80 px-2 py-0.5 text-[10px] font-black text-[#7C4E2B]">
                    打开
                  </span>
                </button>
              ) : null}
              {rankerKeywords.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setDetailModal("ranker")}
                  className="group flex min-h-[70px] items-center gap-3 rounded-xl border-2 border-[#D9771F]/80 bg-[#FFF2DC] px-3 py-2 text-left shadow-[2px_2px_0px_rgba(217,119,31,0.16)] transition-all hover:-translate-y-0.5 hover:bg-[#FFE7C2]"
                >
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border-2 border-[#D9771F] bg-white text-[#B95F13] shadow-sm">
                    <Sparkles className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-black text-[#8A4A12]">墨韵 Ranker</span>
                    <span className="mt-0.5 block truncate text-[11px] font-bold text-[#8A4A12]/75">
                      {rankerKeywords.slice(0, 3).join("、")}
                    </span>
                  </span>
                  <span className="rounded-full border border-[#D9771F]/45 bg-white/85 px-2 py-0.5 text-[10px] font-black text-[#B95F13]">
                    打开
                  </span>
                </button>
              ) : null}
              {interactionCards.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setDetailModal("interaction")}
                  className="group flex min-h-[70px] items-center gap-3 rounded-xl border-2 border-cn-red/80 bg-cn-red/10 px-3 py-2 text-left shadow-[2px_2px_0px_rgba(201,72,48,0.16)] transition-all hover:-translate-y-0.5 hover:bg-cn-red/15"
                >
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border-2 border-cn-red bg-white text-cn-red shadow-sm">
                    <MessageCircleQuestion className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-black text-cn-red">亲子互动卡</span>
                    <span className="mt-0.5 block truncate text-[11px] font-bold text-cn-ink/70">
                      问一问、演一演、画一画
                    </span>
                  </span>
                  <span className="rounded-full border border-cn-red/60 bg-white/80 px-2 py-0.5 text-[10px] font-black text-cn-red">
                    打开
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="h-20 flex items-center gap-3 overflow-x-auto pb-1 px-1 hide-scrollbar">
            {storyPages.map((page, idx) => (
              <button
                key={page.id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                className={`relative flex-shrink-0 h-14 aspect-[16/9] border-2 rounded-lg overflow-hidden transition-all ${
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
              className="flex-shrink-0 h-14 aspect-[16/9] border-2 border-dashed border-cn-ink/40 rounded-lg flex flex-col items-center justify-center text-cn-ink/50 hover:bg-cn-paper transition-colors"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {exportPreview ? (
        <div className="absolute inset-0 z-[95] flex items-center justify-center bg-cn-ink/65 px-4 py-5 backdrop-blur-[3px]">
          <div className="flex h-full max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border-2 border-cn-ink bg-[#FFF8E8] shadow-[8px_8px_0px_rgba(26,43,60,0.28)]">
            <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b-2 border-[#A56E3F]/25 bg-[#FFF1D6] px-5 py-4">
              <div className="min-w-0">
                <p className="text-lg font-black leading-tight text-cn-ink">{exportPreview.title}</p>
                <p className="mt-1 text-[11px] font-bold text-cn-ink/60">
                  先看一遍排版，确认没问题后导出为 PDF。
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintExportPreview}
                  className="flex items-center gap-1.5 rounded-full border-2 border-cn-ink bg-cn-yellow px-3 py-1.5 text-xs font-black text-cn-ink hover:bg-cn-red hover:text-white"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出为 PDF
                </button>
                <button
                  type="button"
                  onClick={() => setExportPreview(null)}
                  className="rounded-full border-2 border-cn-ink bg-white p-1.5 hover:bg-cn-yellow"
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-[#ECE7DD] p-3">
              <iframe
                ref={exportFrameRef}
                srcDoc={exportPreview.html}
                title={exportPreview.title}
                className="h-full w-full rounded-2xl border-2 border-cn-ink bg-white shadow-inner"
              />
            </div>
          </div>
        </div>
      ) : null}

      {detailModal ? (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-cn-ink/60 px-4 py-6 backdrop-blur-[3px]">
          <div className="relative w-full max-w-3xl overflow-hidden rounded-3xl border-2 border-cn-ink bg-[#FFF8E8] shadow-[6px_6px_0px_rgba(26,43,60,0.28)]">
            <div className="absolute left-4 top-4 h-8 w-8 rounded-br-2xl border-l-2 border-t-2 border-[#A56E3F]/55" />
            <div className="absolute right-4 top-4 h-8 w-8 rounded-bl-2xl border-r-2 border-t-2 border-[#A56E3F]/55" />
            <div className="absolute bottom-4 left-4 h-8 w-8 rounded-tr-2xl border-b-2 border-l-2 border-[#A56E3F]/55" />
            <div className="absolute bottom-4 right-4 h-8 w-8 rounded-tl-2xl border-b-2 border-r-2 border-[#A56E3F]/55" />
            <div className="relative border-b-2 border-[#A56E3F]/25 bg-[#FFF1D6] px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-cn-ink bg-white shadow-[2px_2px_0px_rgba(26,43,60,0.16)] ${
                    detailModal === "culture" ? "text-[#7C4E2B]" : detailModal === "ranker" ? "text-[#B95F13]" : "text-cn-red"
                  }`}>
                    {detailModal === "culture" ? (
                      <ScrollText className="h-6 w-6" />
                    ) : detailModal === "ranker" ? (
                      <Sparkles className="h-6 w-6" />
                    ) : (
                      <MessageCircleQuestion className="h-6 w-6" />
                    )}
                  </div>
                  <div>
                    <p className="text-lg font-black leading-tight text-cn-ink">
                      {detailModal === "culture" ? "文化基因卡" : detailModal === "ranker" ? "墨韵 Ranker" : "亲子互动卡"}
                    </p>
                    <p className="mt-1 text-[11px] font-bold text-cn-ink/60">
                      {detailModal === "culture"
                        ? "把传统文化内核转成孩子能理解的故事力量"
                        : detailModal === "ranker"
                          ? "按页面内容挑选水墨风格词，内容始终优先"
                          : `${familyNames}读完后可以继续共创`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailModal(null)}
                  className="rounded-full border-2 border-cn-ink bg-white p-1.5 hover:bg-cn-yellow"
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="relative max-h-[72vh] overflow-y-auto p-5 hide-scrollbar">
              {detailModal === "culture" && culture ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    {culture.hits.map((hit, index) => (
                      <div key={`${hit.title}-${index}`} className="rounded-2xl border-2 border-[#A56E3F]/35 bg-[#FFFDF6] p-4 shadow-[2px_2px_0px_rgba(165,110,63,0.12)]">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-base font-black text-cn-ink">{hit.title}</p>
                          <span className="rounded-full border border-[#A56E3F]/45 bg-[#FFF1D6] px-2 py-0.5 text-[10px] font-black text-[#7C4E2B]">
                            {hit.category || "文化基因"}
                          </span>
                        </div>
                        <div className="mb-3 rounded-xl border border-[#A56E3F]/25 bg-white/75 px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-[#A56E3F]" />
                            <p className="text-[11px] font-black text-[#6B4429]">传统故事简介</p>
                          </div>
                          <p className="mt-1.5 text-[12px] font-bold leading-relaxed text-cn-ink/72">
                            {hit.story_summary || `《${hit.title}》来自${hit.source || hit.category || "传统文化"}，这里展示它适合孩子理解的文化背景和故事线索。`}
                          </p>
                        </div>
                        {hit.core_idea ? (
                          <p className="text-[12px] font-bold leading-relaxed text-cn-ink/75">
                            <span className="font-black text-[#6B4429]">文化内核：</span>{hit.core_idea}
                          </p>
                        ) : null}
                        {hit.child_friendly_takeaway ? (
                          <p className="mt-2 text-[12px] font-bold leading-relaxed text-cn-ink/70">
                            <span className="font-black text-[#6B4429]">给孩子的话：</span>{hit.child_friendly_takeaway}
                          </p>
                        ) : null}
                        {hit.visual_motifs?.length ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {hit.visual_motifs.slice(0, 6).map((motif) => (
                              <span key={motif} className="rounded-full border border-[#A56E3F]/30 bg-white px-2 py-0.5 text-[10px] font-bold text-cn-ink/65">
                                {motif}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {hit.score !== undefined ? (
                          <p className="mt-3 text-[10px] font-bold text-cn-ink/45">匹配度 {hit.score}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {detailModal === "ranker" ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border-2 border-[#D9771F]/45 bg-[#FFF2DC] p-4">
                    <p className="text-sm font-black text-[#8A4A12]">每页 Top 3 画风词</p>
                    <p className="mt-2 text-sm font-bold leading-relaxed text-[#8A4A12]/75">
                      Ranker 会按每页内容挑选画风词；如果风格词和画面内容不一致，以这一页的角色、道具和场景为准。
                    </p>
                    {rankerKeywords.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {rankerKeywords.slice(0, 3).map((keyword) => (
                          <span key={keyword} className="rounded-full border border-[#D9771F]/25 bg-white/80 px-2 py-1 text-[10px] font-black text-[#8A4A12]/75">
                            {keyword}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {styleKeywordEnhancements.map((item, index) => {
                      const sceneNo = item.scene_no ?? index + 1;
                      return (
                        <div key={`${sceneNo}-${index}`} className="rounded-2xl border-2 border-[#D9771F]/25 bg-[#FFFDF6] p-4 shadow-[2px_2px_0px_rgba(217,119,31,0.08)]">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-sm font-black text-cn-ink">第 {sceneNo} 页</p>
                            <span className="rounded-full border border-[#D9771F]/25 bg-[#FFF2DC] px-2 py-0.5 text-[10px] font-black text-[#8A4A12]/70">
                              {item.style || "水墨"}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {(item.selected_keywords || []).slice(0, 3).map((keyword) => (
                              <span key={keyword} className="rounded-full border border-[#D9771F]/20 bg-[#FFF2DC]/75 px-2 py-1 text-[10px] font-black text-[#8A4A12]/75">
                                {keyword}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {detailModal === "interaction" ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border-2 border-cn-red/35 bg-white/80 p-4">
                    <p className="text-sm font-black text-cn-red">读完继续玩</p>
                    <p className="mt-2 text-sm font-bold leading-relaxed text-cn-ink/70">
                      这些卡片可以在读完一页或整本书后抽取使用，让孩子和家长一起说、一起演、一起画。
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    {interactionCards.map((card) => {
                      const Icon = card.type === "act" ? Theater : card.type === "draw" ? Paintbrush : MessageCircleQuestion;
                      return (
                        <div key={card.id} className="relative min-h-[190px] rounded-2xl border-2 border-cn-red/45 bg-[#FFFDF6] p-4 shadow-[3px_3px_0px_rgba(201,72,48,0.12)]">
                          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-cn-red bg-cn-red/10 text-cn-red">
                            <Icon className="h-5 w-5" />
                          </div>
                          <p className="text-base font-black text-cn-ink">{card.title}</p>
                          <p className="mt-3 text-[13px] font-bold leading-relaxed text-cn-ink/70">{card.prompt}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
