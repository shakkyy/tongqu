import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQwenRealtimeAsr } from "./hooks/useQwenRealtimeAsr";
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
import type { AgentTraceEntry, BookMeta, CultureHit, CultureRagInfo, StoryPage, StoryStyle } from "./types";
import { Sparkles, Wand2, Mic, Type, PenTool } from "lucide-react";

const API_BASE = (import.meta as unknown as { env: Record<string, string | undefined> }).env
  .VITE_API_BASE_URL?.trim();

const MOCK_GENERATION =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mock") === "1";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const OFFLINE_DEMO: StoryPage[] = [
  {
    id: "p1",
    title: "云上小船",
    text: "一片金色云朵像小船一样飘过山谷，小朋友们在草地上和它打招呼。",
    imageUrl: "/封面.png",
  },
  {
    id: "p2",
    title: "彩虹桥",
    text: "雨后的彩虹变成一座软软的桥，大家手拉手走过去，笑声像风铃一样清脆。",
    imageUrl: "/封面.png",
  },
  {
    id: "p3",
    title: "晚安星星",
    text: "月亮升起来，星星眨眼睛，今天的故事轻轻合上，明天再继续冒险。",
    imageUrl: "/封面.png",
  },
];

/** 已配置 API、尚未生成时 */
const WAITING_PAGES: StoryPage[] = [
  {
    id: "wait",
    title: "准备创作",
    text: "在左侧选择关键词或保持默认灵感，挑选画风后点击「开始变魔术」，真实绘本将从后端生成并显示在这里。",
    imageUrl:
      "/封面.png",
  },
];

type GenerationStage = {
  id: string;
  title: string;
  detail: string;
};

type StreamProgressStage = {
  id?: string;
  title?: string;
  detail?: string;
  meta?: {
    agent_trace?: {
      kind?: string;
      title?: string;
      detail?: string;
    };
    [key: string]: unknown;
  };
};

type StorybookStreamMessage =
  | { type: "progress"; stage?: StreamProgressStage }
  | { type: "result"; data?: StorybookCreateResponse }
  | { type: "error"; error?: string; detail?: string }
  | { type: "done" };

type StorybookCreateResponse = {
  ok?: boolean;
  error?: string;
  detail?: string;
  title?: string;
  story_text?: string;
  scenes?: { scene_no?: number; text?: string; image_prompt?: string }[];
  image_urls?: string[];
  audio_urls?: string[];
  visual_consistency?: Record<string, unknown>;
  culture_rag_used?: boolean;
  culture_hits?: CultureHit[];
  culture_context?: string;
  culture_integration_note?: string;
  image_prompt_enhancements?: unknown[];
};

type RewritePageResponse = {
  ok?: boolean;
  error?: string;
  detail?: string;
  title?: string;
  story_text?: string;
  scene?: {
    scene_no?: number;
    text?: string;
    image_prompt?: string;
  };
  image_url?: string;
  audio_url?: string;
  visual_consistency?: Record<string, unknown>;
};

function makeBookshelfFingerprint(title: string, pages: StoryPage[]): string {
  const normalizedTitle = (title || "").trim();
  const body = pages
    .map((p) => (p.text || "").replace(/\s+/g, " ").trim())
    .join("|")
    .slice(0, 4000);
  return `${normalizedTitle}::${pages.length}::${body}`;
}

export default function App() {
  const [theme] = useState<"default" | "spring">("default");
  const [creationMode, setCreationMode] = useState<"voice" | "keywords" | "sketch">("voice");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStageIndex, setGenerationStageIndex] = useState(0);
  const [generationElapsedSec, setGenerationElapsedSec] = useState(0);
  const [stageDetailOverrides, setStageDetailOverrides] = useState<Record<string, string>>({});
  const [agentTrace, setAgentTrace] = useState<AgentTraceEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [style, setStyle] = useState<StoryStyle>("paper-cut");
  const [keywordPayload, setKeywordPayload] = useState<KeywordSelectionPayload>(() => ({
    theme: { tags: [], custom: "" },
    character: { tags: [], custom: "" },
    scene: { tags: [], custom: "" },
  }));
  const [remotePages, setRemotePages] = useState<StoryPage[] | null>(null);
  const [bookMeta, setBookMeta] = useState<BookMeta | null>(null);
  const [cultureInfo, setCultureInfo] = useState<CultureRagInfo | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [rewritingPageIndex, setRewritingPageIndex] = useState<number | null>(null);
  const [sketchSnapshotUrl, setSketchSnapshotUrl] = useState<string | null>(null);
  const [sketchDescription, setSketchDescription] = useState("");
  const [lastBookSource, setLastBookSource] = useState<"voice" | "keywords" | "sketch" | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const sketchPadRef = useRef<SketchPadHandle>(null);
  const [bookshelfOpen, setBookshelfOpen] = useState(false);
  const [bookshelfItems, setBookshelfItems] = useState<BookshelfEntry[]>([]);
  const [bookshelfNotice, setBookshelfNotice] = useState<string | null>(null);

  const {
    isListening: voiceListening,
    isFinalizing: voiceFinalizing,
    serviceReady: voiceServiceReady,
    transcriptForApi: voiceTranscript,
    displayText: voiceDisplayText,
    error: voiceError,
    toggleListening: toggleVoiceListening,
  } = useQwenRealtimeAsr(API_BASE);

  /** 识别结束后的可编辑文案；生成绘本以本字段为准，便于纠正错字 */
  const [voiceEditedText, setVoiceEditedText] = useState("");
  const [voiceEditDirty, setVoiceEditDirty] = useState(false);
  const prevVoiceListening = useRef(false);

  const handleVoiceToggle = useCallback(() => {
    if (voiceListening) {
      const captured = (voiceDisplayText || voiceTranscript || "").trim();
      if (captured && !voiceEditDirty) {
        setVoiceEditedText(captured);
      }
    }
    toggleVoiceListening();
  }, [toggleVoiceListening, voiceDisplayText, voiceEditDirty, voiceListening, voiceTranscript]);

  useEffect(() => {
    if (voiceListening && !prevVoiceListening.current) {
      setVoiceEditDirty(false);
      setVoiceEditedText("");
    }
    prevVoiceListening.current = voiceListening;
  }, [voiceListening]);

  useEffect(() => {
    if (!voiceListening && !voiceFinalizing && !voiceEditDirty) {
      setVoiceEditedText(voiceTranscript);
    }
  }, [voiceTranscript, voiceListening, voiceFinalizing, voiceEditDirty]);

  useEffect(() => {
    if (creationMode !== "voice" && voiceListening) {
      handleVoiceToggle();
    }
  }, [creationMode, handleVoiceToggle, voiceListening]);

  const refreshBookshelf = useCallback(async () => {
    const items = await loadBookshelf();
    setBookshelfItems(items);
  }, []);

  useEffect(() => {
    void refreshBookshelf();
  }, [refreshBookshelf]);

  useEffect(() => {
    if (!bookshelfNotice) return;
    const t = window.setTimeout(() => setBookshelfNotice(null), 1800);
    return () => window.clearTimeout(t);
  }, [bookshelfNotice]);

  const canAddToShelf = useMemo(() => {
    if (!remotePages?.length) return false;
    return remotePages[0]?.id !== "wait";
  }, [remotePages]);

  const handleAddToBookshelf = useCallback(async () => {
    if (!remotePages?.length || remotePages[0]?.id === "wait") return;
    const title = remotePages[0].title.split("·")[0]?.trim() || "未命名绘本";
    const currentFp = makeBookshelfFingerprint(title, remotePages);
    const src: BookshelfEntry["mode"] =
      lastBookSource === "sketch" ? "sketch" : lastBookSource === "keywords" ? "keywords" : "voice";
    try {
      const existing = await loadBookshelf();
      const exists = existing.some(
        (e) => makeBookshelfFingerprint(e.title, e.pages) === currentFp
      );
      if (exists) {
        setBookshelfNotice("这本绘本已在书架中");
        return;
      }
      await addBookshelfEntry({
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        title,
        coverUrl: remotePages[0]?.imageUrl ?? "",
        pageCount: remotePages.length,
        mode: src,
        sketchThumb: lastBookSource === "sketch" ? sketchSnapshotUrl ?? undefined : undefined,
        culture: cultureInfo ?? undefined,
        bookMeta: bookMeta ?? undefined,
        pages: remotePages.map((p) => ({ ...p })),
      });
      await refreshBookshelf();
      setBookshelfNotice("已添加到书架");
    } catch (err) {
      console.warn("书架保存失败（可能超出浏览器存储上限）", err);
      setBookshelfNotice("添加失败：书架空间不足");
    }
  }, [remotePages, lastBookSource, sketchSnapshotUrl, cultureInfo, bookMeta, refreshBookshelf]);

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

  const generationStages = useMemo<GenerationStage[]>(() => {
    if (creationMode === "sketch") {
      return [
        { id: "queued", title: "任务已接收", detail: "童趣中枢正在准备创作材料" },
        { id: "sketch", title: "解析草图灵感", detail: "正在理解孩子画里的主角和场景" },
        { id: "orchestrate", title: "中枢 Agent 编排", detail: "规划故事、分镜与配图流程" },
        { id: "culture", title: "检索文化语料", detail: "查找传统文化主题和儿童化改写线索" },
        { id: "draft", title: "撰写故事与分镜", detail: "生成故事正文并拆分为 8~10 个连续页面" },
        { id: "board", title: "整理分镜脚本", detail: "检查每页旁白、画面提示词与角色一致性" },
        { id: "ranker", title: "墨韵 Ranker", detail: "按画风评估每页视觉关键词，未启用时登记跳过" },
        { id: "image", title: "绘制插画场景", detail: "按分镜逐页生成中国风配图" },
        { id: "tts", title: "合成朗读音频", detail: "为每页旁白生成温和朗读" },
        { id: "review", title: "安全审阅与润色", detail: "进行儿童安全复核与价值观对齐" },
      ];
    }
    return [
      { id: "queued", title: "任务已接收", detail: "童趣中枢正在准备创作材料" },
      { id: "orchestrate", title: "中枢 Agent 编排", detail: "规划故事、分镜与配图流程" },
      { id: "culture", title: "检索文化语料", detail: "查找传统文化主题和儿童化改写线索" },
      { id: "draft", title: "撰写故事与分镜", detail: "生成故事正文并拆分为 8~10 个连续页面" },
      { id: "board", title: "整理分镜脚本", detail: "检查每页旁白、画面提示词与角色一致性" },
      { id: "ranker", title: "墨韵 Ranker", detail: "按画风评估每页视觉关键词，未启用时登记跳过" },
      { id: "image", title: "绘制插画场景", detail: "按分镜逐页生成中国风配图" },
      { id: "tts", title: "合成朗读音频", detail: "为每页旁白生成温和朗读" },
      { id: "review", title: "安全审阅与润色", detail: "进行儿童安全复核与价值观对齐" },
    ];
  }, [creationMode]);

  const stageIndexById = useMemo(() => {
    return generationStages.reduce<Record<string, number>>((acc, stage, idx) => {
      acc[stage.id] = idx;
      return acc;
    }, {});
  }, [generationStages]);

  const panelStages = useMemo(() => {
    return generationStages.map((s) => ({
      ...s,
      detail: stageDetailOverrides[s.id] ?? s.detail,
    }));
  }, [generationStages, stageDetailOverrides]);

  useEffect(() => {
    if (!isGenerating) {
      setGenerationStageIndex(0);
      setGenerationElapsedSec(0);
      return;
    }
    setGenerationStageIndex(0);
    setGenerationElapsedSec(0);
    const elapsedTimer = window.setInterval(() => {
      setGenerationElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => {
      window.clearInterval(elapsedTimer);
    };
  }, [isGenerating]);

  const speakPage = (pages: StoryPage[], index: number) => {
    const page = pages[index];
    if (!page) return;
    window.speechSynthesis.cancel();
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (page.audioUrl && page.audioUrl.startsWith("data:audio")) {
      const a = new Audio(page.audioUrl);
      currentAudioRef.current = a;
      a.preload = "auto";
      a.load();
      void a.play().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setApiError(`CosyVoice 音频播放失败：${message}`);
        console.error("CosyVoice audio play failed", err, {
          audioPrefix: page.audioUrl?.slice(0, 80),
          audioLength: page.audioUrl?.length,
        });
      });
      return;
    }
    setApiError("本页没有收到 CosyVoice 音频，未使用浏览器机械朗读兜底。");
  };

  const autoPlayPage = (index: number) => {
    setActiveIndex(index);
    speakPage(storyPages, index);
  };

  const resetSketchSession = () => {
    setSketchSnapshotUrl(null);
    if (lastBookSource === "sketch") {
      setRemotePages(null);
      setBookMeta(null);
      setCultureInfo(null);
      setLastBookSource(null);
    }
    setActiveIndex(0);
  };

  const openBookFromShelf = (entry: BookshelfEntry) => {
    setRemotePages(entry.pages.map((p) => ({ ...p })));
    setBookMeta(entry.bookMeta ?? {
      title: entry.title,
      style: style,
    });
    setCultureInfo(entry.culture ?? null);
    setActiveIndex(0);
    setLastBookSource(entry.mode);
    setSketchSnapshotUrl(entry.sketchThumb ?? null);
    setCreationMode(entry.mode);
  };

  const runMockGeneration = async () => {
    setIsGenerating(true);
    setGenerationStageIndex(0);
    setStageDetailOverrides({});
    setAgentTrace([]);
    setRemotePages(null);
    setCultureInfo(null);
    setBookMeta(null);
    const traceByStage: Record<string, { kind: string; title: string; detail: string }> = {
      queued: { kind: "observe", title: "理解输入", detail: "收到模拟素材，准备进入文化检索与故事编排。" },
      sketch: { kind: "tool_call", title: "启动：草图理解子Agent", detail: "模拟读取孩子草图中的角色和场景。" },
      culture: { kind: "tool_result", title: "完成：文化基因检索子Agent", detail: "提取核心价值：勇敢、互助、守信；只作为文化内核参考。" },
      orchestrate: { kind: "decision", title: "安全预处理完成", detail: "输入素材可继续创作。" },
      draft: { kind: "tool_call", title: "启动：故事撰写子Agent", detail: "一次生成标题、正文、角色设定与分页分镜。" },
      board: { kind: "tool_result", title: "完成：分镜导演子Agent", detail: "整理每页旁白与画面提示词。" },
      ranker: { kind: "tool_call", title: "墨韵 Ranker", detail: "模拟评估画风关键词；未启用时也记录为可观察步骤。" },
      image: { kind: "tool_call", title: "启动：插画生成子Agent", detail: "模拟并发生成多页中国风配图。" },
      tts: { kind: "tool_call", title: "启动：朗读合成子Agent", detail: "模拟为每页旁白合成温和朗读。" },
      review: { kind: "finish", title: "汇总成书", detail: "所有页面已合并为一本可编辑绘本。" },
    };
    try {
      for (let i = 0; i < generationStages.length; i += 1) {
        const stage = generationStages[i];
        setGenerationStageIndex(i);
        setStageDetailOverrides((prev) => ({ ...prev, [stage.id]: stage.detail }));
        const trace = traceByStage[stage.id];
        if (trace) {
          setAgentTrace((prev) => [
            ...prev.slice(-24),
            {
              id: `mock-${stage.id}-${i}`,
              ...trace,
            },
          ]);
        }
        await wait(520);
      }
      const title = "竹林小灯";
      const pages: StoryPage[] = [
        {
          id: "mock-p1",
          title,
          sceneNo: 1,
          text: "孙悟空带着小伙伴走进竹林，风吹过竹叶，像是在轻轻唱歌。",
          imagePrompt: "A playful monkey in a quiet bamboo forest, no text, no letters, no watermark, no logo",
          imageUrl: "/封面.png",
        },
        {
          id: "mock-p2",
          title: `${title} · 第2页`,
          sceneNo: 2,
          text: "小兔子发现一盏小灯笼，孙悟空把它挂到竹枝上，暖光照亮大家的脸。",
          imagePrompt: "A playful monkey and a rabbit hanging a small lantern on bamboo, no text, no letters, no watermark, no logo",
          imageUrl: "/封面.png",
        },
        {
          id: "mock-p3",
          title: `${title} · 第3页`,
          sceneNo: 3,
          text: "他们沿着灯光找到回家的小路，也学会了遇到困难要一起想办法。",
          imagePrompt: "Children book scene of friends following warm lantern light through bamboo forest, no text, no letters, no watermark, no logo",
          imageUrl: "/封面.png",
        },
      ];
      setRemotePages(pages);
      setBookMeta({
        title,
        style,
        storyText: pages.map((p) => p.text).join("\n"),
        visualConsistency: {
          characters: [
            {
              role: "主角",
              name: "孙悟空",
              appearance_anchor_en: "A playful monkey with golden fur, wearing a red cape and a golden headband, small and agile.",
            },
          ],
          key_props: [
            {
              name_zh: "小灯笼",
              anchor_en: "A small round paper lantern with warm yellow glow and a red tassel.",
            },
          ],
          setting_anchor_en: "A quiet bamboo forest with tall green bamboo stalks.",
        },
      });
      setCultureInfo({
        used: true,
        hits: [
          {
            title: "西游记",
            category: "经典人物",
            score: 0.86,
            core_idea: "勇敢、机智、守护伙伴",
            child_friendly_takeaway: "遇到困难时和朋友一起想办法。",
            visual_motifs: ["金箍", "竹林", "灯笼"],
          },
        ],
        integrationNote: "仅吸收文化内核和视觉意象，不复刻原故事情节。",
      });
      setLastBookSource(creationMode === "sketch" ? "sketch" : creationMode === "keywords" ? "keywords" : "voice");
      setActiveIndex(0);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = async () => {
    setApiError(null);
    if (!API_BASE && !MOCK_GENERATION) {
      setApiError("未配置 VITE_API_BASE_URL。请在 tongqu-magic-book/.env 中设置，例如 http://127.0.0.1:8000 后重启 npm run dev。");
      return;
    }
    let sketchImageForApi: string | undefined;
    if (creationMode === "sketch") {
      const snap = sketchPadRef.current?.getDataURL() ?? null;
      setSketchSnapshotUrl(snap);
      if (!snap) {
        setApiError("未能读取画板图像（画板可能尚未就绪）。请确认已切换到「草图」且右侧画板可见，稍后再试。");
        return;
      }
      sketchImageForApi = snap;
      setRemotePages(null);
      setCultureInfo(null);
    }

    if (creationMode === "voice") {
      const t = voiceEditedText.trim();
      if (!t && !MOCK_GENERATION) {
        setApiError(
          "请先完成语音识别（或直接在下方文本框输入灵感），再点「开始变魔术」。",
        );
        return;
      }
    }

    if (MOCK_GENERATION) {
      await runMockGeneration();
      return;
    }

    setIsGenerating(true);
    setGenerationStageIndex(0);
    setStageDetailOverrides({});
    setAgentTrace([]);
    try {
      const sketchNote = sketchDescription.trim();
      const kw =
        creationMode === "sketch"
          ? `儿童手绘画本·根据孩子草图与理解结果创作积极向上的小故事${
              sketchNote ? `\n\n【孩子描述】${sketchNote}` : ""
            }`
          : creationMode === "keywords"
            ? buildKeywordsForApi(keywordPayload)
            : voiceEditedText.trim();
      const base = (API_BASE ?? "").replace(/\/$/, "");
      const res = await fetch(`${base}/api/storybook/create/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: kw,
          style,
          creation_source: creationMode,
          ...(sketchImageForApi ? { sketch_image_base64: sketchImageForApi } : {}),
          ...(creationMode === "sketch" && sketchNote ? { sketch_text: sketchNote } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        setApiError(`请求失败（HTTP ${res.status}）`);
        if (creationMode === "sketch") setSketchSnapshotUrl(null);
        return;
      }
      let finalData: StorybookCreateResponse | null = null;
      let streamError: string | null = null;
      let buffered = "";
      const decoder = new TextDecoder("utf-8");
      const reader = res.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          let message: StorybookStreamMessage | null = null;
          try {
            message = JSON.parse(line) as StorybookStreamMessage;
          } catch {
            continue;
          }
          if (message.type === "progress") {
            const stageId = message.stage?.id;
            const stageDetail = message.stage?.detail?.trim();
            const trace = message.stage?.meta?.agent_trace;
            if (trace?.title || trace?.detail) {
              setAgentTrace((prev) => [
                ...prev.slice(-24),
                {
                  id: `${Date.now()}-${prev.length}`,
                  kind: trace.kind || "info",
                  title: trace.title || message.stage?.title || "Agent 更新",
                  detail: trace.detail || stageDetail || "",
                },
              ]);
            }
            if (stageId && stageIndexById[stageId] !== undefined) {
              const idx = stageIndexById[stageId];
              setGenerationStageIndex((prev) => Math.max(prev, idx));
              if (stageDetail) {
                setStageDetailOverrides((prev) => ({ ...prev, [stageId]: stageDetail }));
              }
            }
          } else if (message.type === "result") {
            finalData = message.data ?? null;
          } else if (message.type === "error") {
            streamError = message.detail || message.error || "服务端流式生成失败";
          }
        }
      }
      const tail = buffered.trim();
      if (tail) {
        try {
          const message = JSON.parse(tail) as StorybookStreamMessage;
          if (message.type === "result") {
            finalData = message.data ?? finalData;
          } else if (message.type === "error") {
            streamError = message.detail || message.error || "服务端流式生成失败";
          }
        } catch {
          // ignore malformed tail chunk
        }
      }
      const data = finalData;
      if (!data) {
        setApiError(streamError ?? "未收到后端结果，请重试");
        if (creationMode === "sketch") setSketchSnapshotUrl(null);
        return;
      }
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
          text: s.text || "",
          imageUrl: imgs[i] ?? "",
          sceneNo: scenes[i]?.scene_no ?? i + 1,
          imagePrompt: scenes[i]?.image_prompt,
          audioUrl: data.audio_urls?.[i],
        }));
        setRemotePages(pages);
        setBookMeta({
          title: data.title!,
          storyText: data.story_text,
          style,
          visualConsistency: data.visual_consistency,
        });
        setCultureInfo({
          used: Boolean(data.culture_rag_used),
          hits: data.culture_hits ?? [],
          context: data.culture_context,
          integrationNote: data.culture_integration_note,
        });
        setActiveIndex(0);
        const src: BookshelfEntry["mode"] =
          creationMode === "sketch" ? "sketch" : creationMode === "keywords" ? "keywords" : "voice";
        setLastBookSource(src);
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

  const handleRewritePage = async (pageIndex: number, instruction: string): Promise<boolean> => {
    setApiError(null);
    if (!API_BASE && !MOCK_GENERATION) {
      setApiError("未配置 VITE_API_BASE_URL，无法替换本页。");
      return false;
    }
    if (!remotePages?.length) {
      setApiError("还没有可替换的真实绘本页面。");
      return false;
    }
    const current = remotePages[pageIndex];
    if (!current) {
      setApiError("当前页不存在，无法替换。");
      return false;
    }
    const trimmed = instruction.trim();
    if (!trimmed) {
      setApiError("请输入要替换成什么内容。");
      return false;
    }
    setRewritingPageIndex(pageIndex);
    if (MOCK_GENERATION) {
      try {
        await wait(700);
        const nextText = `这一页改成：${trimmed} 孩子和家长可以继续一起调整，让故事更像自己的冒险。`;
        setRemotePages((prev) => {
          if (!prev) return prev;
          return prev.map((page, idx) =>
            idx === pageIndex
              ? {
                  ...page,
                  text: nextText,
                  imagePrompt: `${trimmed}, Chinese children's picture book style, no text, no letters, no watermark, no logo`,
                }
              : page,
          );
        });
        setBookMeta((prev) => ({
          title: prev?.title || remotePages[0]?.title.split("·")[0]?.trim() || "童趣绘本",
          style: prev?.style || style,
          storyText: remotePages.map((page, idx) => (idx === pageIndex ? nextText : page.text)).join("\n"),
          visualConsistency: prev?.visualConsistency,
        }));
        return true;
      } finally {
        setRewritingPageIndex(null);
      }
    }
    try {
      const title = bookMeta?.title || remotePages[0]?.title.split("·")[0]?.trim() || "童趣绘本";
      const base = (API_BASE ?? "").replace(/\/$/, "");
      const res = await fetch(`${base}/api/storybook/rewrite-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          style: bookMeta?.style || style,
          page_index: pageIndex,
          instruction: trimmed,
          story_text: bookMeta?.storyText,
          visual_consistency: bookMeta?.visualConsistency,
          pages: remotePages.map((page, idx) => ({
            scene_no: page.sceneNo ?? idx + 1,
            text: page.text,
            image_prompt: page.imagePrompt,
          })),
        }),
      });
      const data = (await res.json().catch(() => null)) as RewritePageResponse | null;
      if (!res.ok || !data?.ok) {
        setApiError(data?.detail || data?.error || `替换失败（HTTP ${res.status}）`);
        return false;
      }
      const scene = data.scene;
      if (!scene?.text || !data.image_url) {
        setApiError("替换接口返回数据不完整（缺少旁白或图片）。");
        return false;
      }
      setRemotePages((prev) => {
        if (!prev) return prev;
        return prev.map((page, idx) =>
          idx === pageIndex
            ? {
                ...page,
                text: scene.text!,
                imageUrl: data.image_url!,
                audioUrl: data.audio_url,
                sceneNo: scene.scene_no ?? page.sceneNo ?? idx + 1,
                imagePrompt: scene.image_prompt ?? page.imagePrompt,
              }
            : page,
        );
      });
      setBookMeta((prev) => ({
        title,
        style: prev?.style || style,
        storyText: data.story_text || prev?.storyText,
        visualConsistency: data.visual_consistency || prev?.visualConsistency,
      }));
      setActiveIndex(pageIndex);
      return true;
    } catch (e) {
      console.error(e);
      setApiError(e instanceof Error ? e.message : "替换本页失败，请确认后端已启动");
      return false;
    } finally {
      setRewritingPageIndex(null);
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
              void refreshBookshelf();
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
                      <VoiceInput
                        isListening={voiceListening}
                        onToggle={handleVoiceToggle}
                        disabled={isGenerating}
                      />
                    </div>
                    <div className="bg-cn-paper/50 border-2 border-dashed border-cn-ink/30 p-2 rounded-xl text-[11px] space-y-2">
                      {!API_BASE && (
                        <p className="text-cn-ink/50">配置 VITE_API_BASE_URL 后可使用云端语音识别。</p>
                      )}
                      {API_BASE && voiceListening && !voiceServiceReady && (
                        <p className="text-cn-azure font-bold">正在连接语音识别服务…</p>
                      )}
                      {API_BASE && voiceListening && voiceServiceReady && (
                        <div className="min-h-[44px] text-cn-ink/70">
                          {voiceDisplayText ? (
                            <p className="text-cn-ink font-medium leading-snug">{voiceDisplayText}</p>
                          ) : (
                            <p className="text-cn-ink/45">请说话，实时识别会显示在这里</p>
                          )}
                        </div>
                      )}
                      {API_BASE && voiceFinalizing && (
                        <p className="text-cn-azure font-bold">正在整理识别结果，请稍候…</p>
                      )}
                      {API_BASE && !voiceListening && !voiceFinalizing && (
                        <div className="flex flex-col gap-1.5">
                          {voiceError && (
                            <p className="text-red-600 font-bold leading-snug">{voiceError}</p>
                          )}
                          <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold text-cn-ink/80">故事灵感（可修改识别结果）</span>
                            <textarea
                              value={voiceEditedText}
                              onChange={(e) => {
                                setVoiceEditDirty(true);
                                setVoiceEditedText(e.target.value.slice(0, 2000));
                              }}
                              rows={4}
                              maxLength={2000}
                              disabled={isGenerating}
                              placeholder="点麦克风说话，结束后文字出现在此；输入结束后点击「开始变魔术」按钮开始创作。"
                              className="w-full text-[11px] rounded-lg border-2 border-cn-ink/25 bg-white p-2 text-cn-ink placeholder:text-cn-ink/40 resize-none leading-relaxed disabled:opacity-60"
                            />
                          </label>
                        </div>
                      )}
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
              <div className="w-full flex justify-center">
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
              generationStages={panelStages}
              generationStageIndex={generationStageIndex}
              generationElapsedSec={generationElapsedSec}
              agentTrace={agentTrace}
              culture={cultureInfo}
              onSpeakPage={(i) => autoPlayPage(i)}
              onRewritePage={remotePages ? handleRewritePage : undefined}
              rewritingPageIndex={rewritingPageIndex}
              onAddToBookshelf={canAddToShelf ? () => void handleAddToBookshelf() : undefined}
            />
          )}
        </section>
      </main>

      <BookshelfModal
        open={bookshelfOpen}
        onClose={() => setBookshelfOpen(false)}
        items={bookshelfItems}
        onRemove={(id) => {
          void removeBookshelfEntry(id).then(() => refreshBookshelf());
        }}
        onClearAll={() => {
          void clearBookshelf().then(() => refreshBookshelf());
        }}
        onOpenBook={openBookFromShelf}
      />
      {bookshelfNotice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[120] pointer-events-none">
          <div className="text-[12px] text-emerald-700 font-bold leading-snug border border-emerald-200 bg-emerald-50 rounded-full px-4 py-2 shadow-soft">
            {bookshelfNotice}
          </div>
        </div>
      )}
    </div>
  );
}
