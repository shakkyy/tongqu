import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQwenRealtimeAsr } from "./hooks/useQwenRealtimeAsr";
import { VoiceInput } from "./components/VoiceInput";
import { StyleSelector } from "./components/StyleSelector";
import { KeywordsSelector } from "./components/KeywordsSelector";
import { SketchPad, type SketchPadHandle } from "./components/SketchPad";
import { StoryBookPanel } from "./components/StoryBookPanel";
import { BookshelfPage } from "./components/BookshelfPage";
import { FamilyProfilePage } from "./components/FamilyProfilePage";
import {
  addBookshelfEntry,
  loadBookshelf,
  removeBookshelfEntry,
  clearBookshelf,
  type BookshelfEntry,
} from "./lib/bookshelfStorage";
import {
  createFamilyMemberProfile,
  loadFamilyProfiles,
  saveFamilyProfiles,
} from "./lib/familyProfileStorage";
import { makeFamilyProfileReferenceDataUrl, makeImageThumbnailDataUrl, readFileAsDataUrl } from "./lib/imageUtils";
import { buildKeywordsForApi, type KeywordSelectionPayload } from "./lib/keywordPayload";
import {
  CLASSROOM_DEMO_FAMILY_PROFILES,
  CLASSROOM_DEMO_INPUT,
  CLASSROOM_DEMO_KEYWORD_PAYLOAD,
  CLASSROOM_DEMO_PHOTO_URL,
  CLASSROOM_DEMO_QUERY_ENABLED,
  CLASSROOM_DEMO_SKETCH_DESCRIPTION,
  CLASSROOM_DEMO_VOICE_TEXT,
  createClassroomDemoBookshelfEntries,
  getClassroomDemoFixture,
} from "./demo/classroomDemo";
import type {
  AgentTraceEntry,
  BookMeta,
  CultureHit,
  CultureRagInfo,
  FamilyCoCreationMeta,
  FamilyMemberProfile,
  InteractionCard,
  StyleKeywordEnhancement,
  StoryPage,
  StoryStyle,
} from "./types";
import { Sparkles, Wand2, Mic, Type, PenTool, UsersRound, Upload, X, Square } from "lucide-react";

const API_BASE = (import.meta as unknown as { env: Record<string, string | undefined> }).env
  .VITE_API_BASE_URL?.trim();

const MOCK_GENERATION =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mock") === "1";

const MAX_FAMILY_PHOTO_BYTES = 7 * 1024 * 1024;

function makeAbortError() {
  return new DOMException("Generation aborted", "AbortError");
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && err.name === "AbortError";
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }
    let abortHandler: (() => void) | null = null;
    const cleanup = () => {
      if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    abortHandler = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(makeAbortError());
    };
    signal?.addEventListener("abort", abortHandler, { once: true });
  });

type CreationMode = "voice" | "keywords" | "sketch" | "family";

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
    text: "准备好你的故事灵感和喜欢的画风后，点一下魔法按钮，新的绘本会一页页出现在这里。",
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
  | { type: "error"; error?: string; detail?: string; code?: string; safety_blocked?: boolean }
  | { type: "done" };

type StorybookCreateResponse = {
  ok?: boolean;
  code?: string;
  safety_blocked?: boolean;
  should_stop?: boolean;
  error?: string;
  detail?: string;
  input_hits?: string[];
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
  style_keywords?: string[];
  image_prompt_enhancements?: StyleKeywordEnhancement[];
};

type RewritePageResponse = {
  ok?: boolean;
  code?: string;
  safety_blocked?: boolean;
  should_stop?: boolean;
  error?: string;
  detail?: string;
  input_hits?: string[];
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

type SafetyAwareError = {
  code?: string;
  safety_blocked?: boolean;
  should_stop?: boolean;
  detail?: string;
  error?: string;
};

const KID_SAFETY_BLOCK_MESSAGE =
  "这个灵感不对哦！童趣绘梦不能画打人、流血、被吃掉或吓人的故事。换成小伙伴把误会讲开、一起想办法、互相帮助的灵感，再试一次吧。";

function isSafetyBlocked(payload?: SafetyAwareError | null): boolean {
  const text = `${payload?.detail ?? ""} ${payload?.error ?? ""}`;
  return Boolean(
    payload?.code === "safety_blocked" ||
      payload?.safety_blocked ||
      payload?.should_stop ||
      text.includes("safety_blocked") ||
      text.includes("安全预审未通过") ||
      text.includes("不适合儿童绘本") ||
      text.includes("儿童不宜"),
  );
}

function kidFacingApiError(payload: SafetyAwareError | null | undefined, fallback: string): string {
  if (isSafetyBlocked(payload)) return KID_SAFETY_BLOCK_MESSAGE;
  return payload?.detail || payload?.error || fallback;
}

function makeBookshelfFingerprint(title: string, pages: StoryPage[]): string {
  const normalizedTitle = (title || "").trim();
  const body = pages
    .map((p) => (p.text || "").replace(/\s+/g, " ").trim())
    .join("|")
    .slice(0, 4000);
  return `${normalizedTitle}::${pages.length}::${body}`;
}

function buildFamilyCoCreationMeta(
  profiles: FamilyMemberProfile[],
  travelWish: string,
  childIdea: string,
  parentGoal: string,
  privacyConfirmed: boolean,
  savePhotoToShelf: boolean,
  familyPhotoThumb?: string | null,
): FamilyCoCreationMeta {
  return {
    travelWish: travelWish.trim(),
    childIdea: childIdea.trim(),
    parentGoal: parentGoal.trim(),
    privacyConfirmed,
    savePhotoToShelf,
    familyPhotoThumb: savePhotoToShelf ? familyPhotoThumb || undefined : undefined,
    createdAt: Date.now(),
    members: profiles.filter((m) => m.enabled).map((m) => ({ ...m })),
  };
}

function buildInteractionCards(
  pages: StoryPage[],
  family?: FamilyCoCreationMeta,
  culture?: CultureRagInfo | null,
): InteractionCard[] {
  if (!pages.length) return [];
  const firstScene = pages[0]?.text || "故事刚刚开始";
  const lastScene = pages[pages.length - 1]?.text || "故事圆满结束";
  const childName = family?.members?.find((m) => /孩子|宝贝|小/.test(m.relation))?.displayName || "孩子";
  const parentName = family?.members?.find((m) => /家长|爸爸|妈妈|父|母/.test(m.relation))?.displayName || "家长";
  const cultureWord = culture?.hits?.[0]?.title || "故事里的传统文化";
  return [
    {
      id: "ask",
      type: "ask",
      title: "问一问",
      prompt: `${parentName}问${childName}：如果你在“${firstScene.slice(0, 28)}”这一刻，会先观察什么？为什么？`,
    },
    {
      id: "act",
      type: "act",
      title: "演一演",
      prompt: `一起分角色演最后一页：${lastScene.slice(0, 36)}。孩子负责想办法，家长负责回应和鼓励。`,
    },
    {
      id: "draw",
      type: "draw",
      title: "画一画",
      prompt: `把${cultureWord}里最喜欢的一个纹样、道具或场景画下来，给下一集当新的线索。`,
    },
  ];
}

function buildFamilyProfilesText(profiles: FamilyMemberProfile[]): string {
  const active = profiles.filter((m) => m.enabled);
  if (!active.length) return "未选择家庭角色；若上传合照，则以本次合照为主，若无合照，则按亲子共创文字生成安全、非写实绘本角色。";
  return active
    .map(
      (m, idx) =>
        `${idx + 1}. ${m.displayName}（${m.relation}）：在故事中是「${m.storyRole}」。性格/行动方式：${m.characterDescription} 视觉参考：${m.visualNotes}`,
    )
    .join("\n");
}

export default function App() {
  const [theme] = useState<"default" | "spring">("default");
  const [creationMode, setCreationMode] = useState<CreationMode>("voice");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStageIndex, setGenerationStageIndex] = useState(0);
  const [generationElapsedSec, setGenerationElapsedSec] = useState(0);
  const [stageDetailOverrides, setStageDetailOverrides] = useState<Record<string, string>>({});
  const [agentTrace, setAgentTrace] = useState<AgentTraceEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [style, setStyle] = useState<StoryStyle>("paper-cut");
  const [keywordPayload, setKeywordPayload] = useState<KeywordSelectionPayload>(() => ({
    ...(CLASSROOM_DEMO_QUERY_ENABLED
      ? CLASSROOM_DEMO_KEYWORD_PAYLOAD
      : {
          theme: { tags: [], custom: "" },
          character: { tags: [], custom: "" },
          scene: { tags: [], custom: "" },
        }),
  }));
  const [remotePages, setRemotePages] = useState<StoryPage[] | null>(null);
  const [bookMeta, setBookMeta] = useState<BookMeta | null>(null);
  const [cultureInfo, setCultureInfo] = useState<CultureRagInfo | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiDialog, setApiDialog] = useState<string | null>(null);
  const [rewritingPageIndex, setRewritingPageIndex] = useState<number | null>(null);
  const [sketchSnapshotUrl, setSketchSnapshotUrl] = useState<string | null>(null);
  const [sketchDescription, setSketchDescription] = useState("");
  const [familyPhotoUrl, setFamilyPhotoUrl] = useState<string | null>(null);
  const [familyPhotoThumb, setFamilyPhotoThumb] = useState<string | null>(null);
  const [familyPhotoName, setFamilyPhotoName] = useState("");
  const [familyTravelWish, setFamilyTravelWish] = useState("");
  const [familyChildIdea, setFamilyChildIdea] = useState("");
  const [familyParentGoal, setFamilyParentGoal] = useState("");
  const [familyComposerOpen, setFamilyComposerOpen] = useState(false);
  const [familyPhotoConfirmed, setFamilyPhotoConfirmed] = useState(false);
  const [familySavePhotoToShelf, setFamilySavePhotoToShelf] = useState(true);
  const [familyProfiles, setFamilyProfiles] = useState<FamilyMemberProfile[]>(() => loadFamilyProfiles());
  const [familyProfileNotice, setFamilyProfileNotice] = useState<string | null>(null);
  const [lastBookSource, setLastBookSource] = useState<CreationMode | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const sketchPadRef = useRef<SketchPadHandle>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const stopNoticeShownRef = useRef(false);
  const [appView, setAppView] = useState<"create" | "bookshelf" | "familyProfiles">("create");
  const [bookshelfItems, setBookshelfItems] = useState<BookshelfEntry[]>([]);
  const [demoActive, setDemoActive] = useState(CLASSROOM_DEMO_QUERY_ENABLED);
  const [demoBookshelfItems, setDemoBookshelfItems] = useState<BookshelfEntry[]>(() =>
    createClassroomDemoBookshelfEntries(),
  );
  const [bookshelfNotice, setBookshelfNotice] = useState<string | null>(null);
  const [pendingDemoSketchDraw, setPendingDemoSketchDraw] = useState(false);
  const demoActivatedRef = useRef(false);

  const clearApiError = () => {
    setApiError(null);
    setApiDialog(null);
  };

  const showApiFailure = (payload: SafetyAwareError | null | undefined, fallback: string) => {
    const message = kidFacingApiError(payload, fallback);
    setApiError(message);
    if (isSafetyBlocked(payload)) {
      setApiDialog(message);
    }
  };

  const activateClassroomDemo = useCallback(() => {
    setDemoActive(true);
    setAppView("create");
    setCreationMode("voice");
    setStyle("ink-wash");
    setRemotePages(null);
    setBookMeta(null);
    setCultureInfo(null);
    setLastBookSource(null);
    setActiveIndex(0);
    setApiError(null);
    setApiDialog(null);
    setAgentTrace([]);
    setStageDetailOverrides({});
    setFamilyPhotoUrl(CLASSROOM_DEMO_PHOTO_URL);
    setFamilyPhotoThumb(CLASSROOM_DEMO_PHOTO_URL);
    setFamilyPhotoName("亲子合照.png");
    setFamilyPhotoConfirmed(true);
    setFamilySavePhotoToShelf(true);
    setFamilyChildIdea(CLASSROOM_DEMO_INPUT.childIdea);
    setFamilyParentGoal(CLASSROOM_DEMO_INPUT.parentGoal);
    setFamilyTravelWish(CLASSROOM_DEMO_INPUT.travelWish);
    setFamilyComposerOpen(false);
    setSketchDescription(CLASSROOM_DEMO_SKETCH_DESCRIPTION);
    setSketchSnapshotUrl(null);
    setPendingDemoSketchDraw(false);
    setVoiceEditedText(CLASSROOM_DEMO_VOICE_TEXT);
    setVoiceEditDirty(true);
    setKeywordPayload(CLASSROOM_DEMO_KEYWORD_PAYLOAD);
    setFamilyProfiles(CLASSROOM_DEMO_FAMILY_PROFILES.map((member) => ({ ...member })));
    setDemoBookshelfItems(createClassroomDemoBookshelfEntries());
    setBookshelfNotice("创作素材已准备好");
  }, []);

  useEffect(() => {
    if (!CLASSROOM_DEMO_QUERY_ENABLED || demoActivatedRef.current) return;
    demoActivatedRef.current = true;
    activateClassroomDemo();
  }, [activateClassroomDemo]);

  const markGenerationStopped = () => {
    if (stopNoticeShownRef.current) return;
    stopNoticeShownRef.current = true;
    setApiError("已停止本次变魔术。");
    setAgentTrace((prev) => [
      ...prev.slice(-24),
      {
        id: `stop-${Date.now()}`,
        kind: "error",
        title: "已停止变魔术",
        detail: "当前生成请求已中断，后端不会继续为这次任务返回绘本。",
      },
    ]);
  };

  const handleStopGeneration = () => {
    const controller = generationAbortRef.current;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    generationAbortRef.current = null;
    setApiDialog(null);
    setIsGenerating(false);
    markGenerationStopped();
  };

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
  const [voiceEditedText, setVoiceEditedText] = useState(CLASSROOM_DEMO_QUERY_ENABLED ? CLASSROOM_DEMO_VOICE_TEXT : "");
  const [voiceEditDirty, setVoiceEditDirty] = useState(CLASSROOM_DEMO_QUERY_ENABLED);
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

  const selectCreationMode = useCallback(
    (mode: CreationMode) => {
      setCreationMode(mode);
      if (!demoActive) return;
      const fixture = getClassroomDemoFixture(mode);
      setStyle(fixture.style);
      setRemotePages(null);
      setBookMeta(null);
      setCultureInfo(null);
      setLastBookSource(null);
      setActiveIndex(0);
      setApiError(null);
      setApiDialog(null);
      setAgentTrace([]);
      setStageDetailOverrides({});

      if (mode === "voice") {
        setVoiceEditedText(CLASSROOM_DEMO_VOICE_TEXT);
        setVoiceEditDirty(true);
      } else if (mode === "keywords") {
        setKeywordPayload(CLASSROOM_DEMO_KEYWORD_PAYLOAD);
      } else if (mode === "sketch") {
        setSketchDescription(CLASSROOM_DEMO_SKETCH_DESCRIPTION);
        setSketchSnapshotUrl(null);
        setPendingDemoSketchDraw(true);
      } else if (mode === "family") {
        setFamilyPhotoUrl(CLASSROOM_DEMO_PHOTO_URL);
        setFamilyPhotoThumb(CLASSROOM_DEMO_PHOTO_URL);
        setFamilyPhotoName("亲子合照.png");
        setFamilyPhotoConfirmed(true);
        setFamilySavePhotoToShelf(true);
        setFamilyChildIdea(CLASSROOM_DEMO_INPUT.childIdea);
        setFamilyParentGoal(CLASSROOM_DEMO_INPUT.parentGoal);
        setFamilyTravelWish(CLASSROOM_DEMO_INPUT.travelWish);
        setFamilyComposerOpen(false);
        setFamilyProfiles(CLASSROOM_DEMO_FAMILY_PROFILES.map((member) => ({ ...member })));
      }
    },
    [demoActive],
  );

  useEffect(() => {
    if (!pendingDemoSketchDraw || creationMode !== "sketch") return;
    const timer = window.setTimeout(() => {
      sketchPadRef.current?.drawDemoSketch();
      setPendingDemoSketchDraw(false);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [creationMode, pendingDemoSketchDraw]);

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

  useEffect(() => {
    if (!familyProfileNotice) return;
    const t = window.setTimeout(() => setFamilyProfileNotice(null), 1600);
    return () => window.clearTimeout(t);
  }, [familyProfileNotice]);

  const canAddToShelf = useMemo(() => {
    if (!remotePages?.length) return false;
    return remotePages[0]?.id !== "wait";
  }, [remotePages]);

  const handleAddToBookshelf = useCallback(async () => {
    if (!remotePages?.length || remotePages[0]?.id === "wait") return;
    const title = remotePages[0].title.split("·")[0]?.trim() || "未命名绘本";
    const currentFp = makeBookshelfFingerprint(title, remotePages);
    const src: BookshelfEntry["mode"] =
      lastBookSource === "sketch"
        ? "sketch"
        : lastBookSource === "family"
          ? "family"
          : lastBookSource === "keywords"
            ? "keywords"
            : "voice";
    if (demoActive) {
      const exists = demoBookshelfItems.some(
        (e) => makeBookshelfFingerprint(e.title, e.pages) === currentFp,
      );
      if (exists) {
        setBookshelfNotice("这本绘本已在书架中");
        return;
      }
      setDemoBookshelfItems((prev) => [
        {
          id: `demo-added-${Date.now()}`,
          createdAt: Date.now(),
          title,
          coverUrl: remotePages[0]?.imageUrl ?? "",
          pageCount: remotePages.length,
          mode: src,
          sketchThumb: lastBookSource === "sketch" ? sketchSnapshotUrl ?? undefined : undefined,
          familyPhotoThumb:
            src === "family"
              ? bookMeta?.familyCoCreation?.familyPhotoThumb || undefined
              : undefined,
          culture: cultureInfo ?? undefined,
          bookMeta: bookMeta ?? undefined,
          pages: remotePages.map((p) => ({ ...p })),
        },
        ...prev,
      ]);
      setBookshelfNotice("已添加到书架");
      return;
    }
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
        familyPhotoThumb:
          src === "family"
            ? bookMeta?.familyCoCreation?.familyPhotoThumb || undefined
            : undefined,
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
  }, [remotePages, lastBookSource, demoActive, demoBookshelfItems, sketchSnapshotUrl, cultureInfo, bookMeta, refreshBookshelf]);

  const onKeywordsChange = useCallback((p: KeywordSelectionPayload) => {
    setKeywordPayload(p);
  }, []);

  const handleFamilyPhotoChange = useCallback(async (file: File | null) => {
    setApiError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setApiError("请上传 JPG / PNG / WebP 等图片文件。");
      return;
    }
    if (file.size > MAX_FAMILY_PHOTO_BYTES) {
      setApiError("合照图片太大，请压缩到 7MB 以内再上传。");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const thumbUrl = await makeImageThumbnailDataUrl(dataUrl);
      setFamilyPhotoUrl(dataUrl);
      setFamilyPhotoThumb(thumbUrl);
      setFamilyPhotoName(file.name);
      setFamilyPhotoConfirmed(false);
      if (lastBookSource === "family") {
        setRemotePages(null);
        setBookMeta(null);
        setCultureInfo(null);
        setLastBookSource(null);
      }
      setActiveIndex(0);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "读取合照失败，请重试。");
    }
  }, [lastBookSource]);

  const handleSaveFamilyProfiles = useCallback(() => {
    const normalized = familyProfiles.map((item) =>
      createFamilyMemberProfile({
        ...item,
        displayName: item.displayName.trim() || "家人",
        relation: item.relation.trim() || "家人",
        storyRole: item.storyRole.trim() || "绘本角色",
        characterDescription: item.characterDescription.trim() || "温暖、好奇，愿意一起解决问题。",
        visualNotes: item.visualNotes.trim() || "适合儿童绘本的非写实造型。",
      }),
    );
    setFamilyProfiles(normalized);
    saveFamilyProfiles(normalized);
    setFamilyProfileNotice("家庭角色库已保存");
  }, [familyProfiles]);

  const storyPages = remotePages ?? (demoActive || API_BASE ? WAITING_PAGES : OFFLINE_DEMO);
  const displayedBookshelfItems = demoActive ? demoBookshelfItems : bookshelfItems;

  const sketchSplitActive =
    creationMode === "sketch" &&
    (isGenerating ||
      (lastBookSource === "sketch" && remotePages !== null && remotePages.length > 0));

  const progressText = useMemo(() => {
    if (!isGenerating) return "";
    if (creationMode === "family") return "时空小门正在打开，亲子角色准备穿越...";
    if (creationMode === "sketch") return "魔法画笔正在将草图变为插画...";
    if (style === "paper-cut") return "神笔马良正在帮你剪纸哦...";
    if (style === "ink-wash") return "小墨童正在挥毫泼墨...";
    if (style === "comic") return "漫画小精灵正在勾线涂色...";
    return "皮影爷爷正在点亮皮影灯...";
  }, [isGenerating, style, creationMode]);

  const generationStages = useMemo<GenerationStage[]>(() => {
    if (creationMode === "family") {
      return [
        { id: "queued", title: "任务已接收", detail: "已收到创作请求，正在启动童趣中枢" },
        { id: "orchestrate", title: "中枢 Agent 编排", detail: "正在进行素材整理与安全预处理" },
        { id: "sketch", title: "理解亲子素材", detail: "正在进行合照安全审核，并提取可儿童化改写的亲子角色锚点" },
        { id: "culture", title: "检索文化语料", detail: "正在从传统文化资料中提取可改写灵感" },
        { id: "draft", title: "撰写故事与分镜", detail: "正在一次生成标题、正文、角色设定与 4-6 页分镜" },
        { id: "board", title: "整理分镜脚本", detail: "检查每页旁白、画面提示词与角色一致性" },
        { id: "ranker", title: "墨韵 Ranker", detail: "按画风评估每页视觉关键词，未启用时登记跳过" },
        { id: "image", title: "绘制插画场景", detail: "把亲子角色穿越到中国风绘本画面中" },
        { id: "tts", title: "合成朗读音频", detail: "为每页旁白生成温和朗读" },
        { id: "review", title: "安全审阅与润色", detail: "进行儿童安全复核与价值观对齐" },
      ];
    }
    if (creationMode === "sketch") {
      return [
        { id: "queued", title: "任务已接收", detail: "已收到创作请求，正在启动童趣中枢" },
        { id: "orchestrate", title: "中枢 Agent 编排", detail: "正在进行素材整理与安全预处理" },
        { id: "sketch", title: "解析草图灵感", detail: "正在理解孩子画里的主角和场景" },
        { id: "culture", title: "检索文化语料", detail: "正在从传统文化资料中提取可改写灵感" },
        { id: "draft", title: "撰写故事与分镜", detail: "正在一次生成标题、正文、角色设定与 4-6 页分镜" },
        { id: "board", title: "整理分镜脚本", detail: "检查每页旁白、画面提示词与角色一致性" },
        { id: "ranker", title: "墨韵 Ranker", detail: "按画风评估每页视觉关键词，未启用时登记跳过" },
        { id: "image", title: "绘制插画场景", detail: "按分镜逐页生成中国风配图" },
        { id: "tts", title: "合成朗读音频", detail: "为每页旁白生成温和朗读" },
        { id: "review", title: "安全审阅与润色", detail: "进行儿童安全复核与价值观对齐" },
      ];
    }
    return [
      { id: "queued", title: "任务已接收", detail: "已收到创作请求，正在启动童趣中枢" },
      { id: "orchestrate", title: "中枢 Agent 编排", detail: "正在进行素材整理与安全预处理" },
      { id: "culture", title: "检索文化语料", detail: "正在从传统文化资料中提取可改写灵感" },
      { id: "draft", title: "撰写故事与分镜", detail: "正在一次生成标题、正文、角色设定与 4-6 页分镜" },
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
    if (page.audioUrl) {
      const a = new Audio(page.audioUrl);
      currentAudioRef.current = a;
      a.preload = "auto";
      a.load();
      void a.play().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setApiError(`音频播放失败：${message}`);
        console.error("Story audio play failed", err, {
          audioPrefix: page.audioUrl?.slice(0, 80),
          audioLength: page.audioUrl?.length,
        });
      });
      return;
    }
    setApiError("本页没有音频文件，未使用浏览器机械朗读兜底。");
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
    const savedFamilyThumb = entry.familyPhotoThumb || entry.bookMeta?.familyCoCreation?.familyPhotoThumb || null;
    setFamilyPhotoThumb(savedFamilyThumb);
    setFamilyPhotoUrl(entry.mode === "family" ? savedFamilyThumb : null);
    setFamilyPhotoName(savedFamilyThumb ? "浏览器书架中的合照缩略图" : "");
    setFamilySavePhotoToShelf(Boolean(savedFamilyThumb));
    setFamilyPhotoConfirmed(false);
    setCreationMode(entry.mode);
    setAppView("create");
  };

  const runMockGeneration = async (signal: AbortSignal) => {
    setIsGenerating(true);
    setGenerationStageIndex(0);
    setStageDetailOverrides({});
    setAgentTrace([]);
    setRemotePages(null);
    setCultureInfo(null);
    setBookMeta(null);
    const traceByStage: Record<string, { kind: string; title: string; detail: string }> = {
      queued: { kind: "observe", title: "理解输入", detail: "收到模拟素材，准备进入文化检索与故事编排。" },
      sketch:
        creationMode === "family"
          ? { kind: "tool_call", title: "启动：亲子素材理解子Agent", detail: "有合照或角色库照片时审核并提取角色锚点；无图片时整理文字素材。" }
          : { kind: "tool_call", title: "启动：草图理解子Agent", detail: "模拟读取孩子草图中的角色和场景。" },
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
        await wait(520, signal);
      }
      const title = creationMode === "family" ? "长安灯会小使者" : "竹林小灯";
      const familyMeta =
        creationMode === "family"
          ? buildFamilyCoCreationMeta(
              familyProfiles,
              familyTravelWish,
              familyChildIdea,
              familyParentGoal,
              !familyPhotoUrl || familyPhotoConfirmed,
              familySavePhotoToShelf,
              familyPhotoThumb,
            )
          : undefined;
      const pages: StoryPage[] =
        creationMode === "family"
          ? [
              {
                id: "mock-p1",
                title,
                sceneNo: 1,
                text: "一阵金色风吹来，孩子和家长牵着手，变成绘本里的小旅人，来到了热闹的长安灯会。",
                imagePrompt: "Parent and child as non-photorealistic picture-book travelers in ancient Chang'an lantern festival, no text, no letters, no watermark, no logo",
                imageUrl: "/封面.png",
              },
              {
                id: "mock-p2",
                title: `${title} · 第2页`,
                sceneNo: 2,
                text: "他们一起观察花灯上的纹样，发现每一盏灯都藏着一句关于团圆和守信的小秘密。",
                imagePrompt: "Parent and child examining traditional lantern patterns in ancient China, warm family co-creation, no text, no letters, no watermark, no logo",
                imageUrl: "/封面.png",
              },
              {
                id: "mock-p3",
                title: `${title} · 第3页`,
                sceneNo: 3,
                text: "孩子提出办法，家长帮忙搭桥，他们把迷路的小灯送回灯楼，也把勇气装进口袋。",
                imagePrompt: "Parent and child solving a gentle puzzle together at an ancient lantern tower, Chinese picture book style, no text, no letters, no watermark, no logo",
                imageUrl: "/封面.png",
              },
            ]
          : [
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
      const mockCultureInfo: CultureRagInfo = {
        used: true,
        hits: [
          {
            title: "西游记",
            category: "经典人物",
            score: 0.86,
            story_summary: "《西游记》讲述唐僧师徒西行取经，途中经历许多考验。孙悟空机智勇敢，常用本领保护伙伴，也在旅途中学会合作与担当。",
            core_idea: "勇敢、机智、守护伙伴",
            child_friendly_takeaway: "遇到困难时和朋友一起想办法。",
            visual_motifs: ["金箍", "竹林", "灯笼"],
          },
        ],
        integrationNote: creationMode === "family" ? "亲子角色会带着传统文化里的勇气与互助精神展开冒险。" : "故事会借用传统文化里的积极精神与画面意象。",
      };
      const interactionCards = buildInteractionCards(pages, familyMeta, mockCultureInfo);
      setRemotePages(pages);
      setBookMeta({
        title,
        style,
        storyText: pages.map((p) => p.text).join("\n"),
        visualConsistency: {
          characters: [
            creationMode === "family"
              ? {
                  role: "主角",
                  name: "亲子旅人",
                  appearance_anchor_en: "A parent and child pair redesigned as non-photorealistic Chinese picture-book travelers, warm colors, friendly expressions, consistent outfits.",
                }
              : {
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
        familyCoCreation: familyMeta,
        interactionCards,
      });
      setCultureInfo(mockCultureInfo);
      setLastBookSource(creationMode === "sketch" ? "sketch" : creationMode === "family" ? "family" : creationMode === "keywords" ? "keywords" : "voice");
      setActiveIndex(0);
    } finally {
      setIsGenerating(false);
      if (generationAbortRef.current?.signal === signal) {
        generationAbortRef.current = null;
      }
    }
  };

  const runClassroomDemoGeneration = async (signal: AbortSignal) => {
    const fixture = getClassroomDemoFixture(creationMode);
    setIsGenerating(true);
    setGenerationStageIndex(0);
    setStageDetailOverrides({});
    setAgentTrace([]);
    setRemotePages(null);
    setCultureInfo(null);
    setBookMeta(null);
    const demoStageDetails: Record<string, string> = {
      queued: "已收到创作请求，正在启动童趣中枢",
      orchestrate: "正在进行素材整理与安全预处理",
      sketch:
        creationMode === "family"
          ? "正在进行合照安全审核，并提取可儿童化改写的亲子角色锚点"
          : "正在理解草图中的角色与场景语义",
      culture: "正在从传统文化资料中提取可改写灵感",
      draft: "正在一次生成标题、正文、角色设定与 4-6 页分镜",
      board: "整理每页旁白、画面提示词与角色一致性约束",
      ranker: "为每页挑选 3 个水墨画风关键词",
      image: "按分镜逐页生成中国风配图",
      tts: "为每页旁白生成温和朗读",
      review: "进行儿童安全复核与价值观对齐",
    };
    try {
      for (let i = 0; i < generationStages.length; i += 1) {
        const stage = generationStages[i];
        setGenerationStageIndex(i);
        setStageDetailOverrides((prev) => ({
          ...prev,
          [stage.id]: demoStageDetails[stage.id] || stage.detail,
        }));
        const trace = fixture.traces[stage.id];
        if (trace) {
          setAgentTrace((prev) => [
            ...prev.slice(-24),
            {
              ...trace,
              id: `${trace.id}-${i}`,
            },
          ]);
        }
        await wait(3000, signal);
      }
      const pages = fixture.pages.map((page) => ({ ...page }));
      const meta: BookMeta = {
        ...fixture.meta,
        familyCoCreation: fixture.meta.familyCoCreation
          ? {
              ...fixture.meta.familyCoCreation,
              members: fixture.meta.familyCoCreation.members?.map((member) => ({ ...member })) ?? [],
            }
          : undefined,
        styleKeywords: [...(fixture.meta.styleKeywords || [])],
        styleKeywordEnhancements: fixture.ranker.map((item) => ({
          ...item,
          selected_keywords: [...(item.selected_keywords || [])],
          selected_fragments: [...(item.selected_fragments || [])],
        })),
        interactionCards: fixture.meta.interactionCards?.map((card) => ({ ...card })) ?? [],
      };
      setRemotePages(pages);
      setBookMeta(meta);
      setCultureInfo({
        ...fixture.culture,
        hits: fixture.culture.hits.map((hit) => ({ ...hit, visual_motifs: [...(hit.visual_motifs || [])] })),
      });
      setLastBookSource(fixture.mode);
      setActiveIndex(0);
      setDemoBookshelfItems(createClassroomDemoBookshelfEntries());
    } finally {
      setIsGenerating(false);
      if (generationAbortRef.current?.signal === signal) {
        generationAbortRef.current = null;
      }
    }
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    clearApiError();
    if (demoActive) {
      const controller = new AbortController();
      generationAbortRef.current = controller;
      stopNoticeShownRef.current = false;
      if (creationMode === "sketch") {
        sketchPadRef.current?.drawDemoSketch();
        setSketchSnapshotUrl(sketchPadRef.current?.getDataURL() ?? null);
      }
      try {
        await runClassroomDemoGeneration(controller.signal);
      } catch (e) {
        if (isAbortError(e)) {
          markGenerationStopped();
          return;
        }
        throw e;
      }
      return;
    }
    if (!API_BASE && !MOCK_GENERATION) {
      setApiError("未配置 VITE_API_BASE_URL。请在 tongqu-magic-book/.env 中设置，例如 http://127.0.0.1:8000 后重启 npm run dev。");
      return;
    }
    let sketchImageForApi: string | undefined;
    let familyVisualInputMode: "current_photo" | "role_library" | "none" = "none";
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
    if (creationMode === "family") {
      if (familyPhotoUrl && !familyPhotoConfirmed) {
        setApiError("请先确认：童趣绘梦不会保存上传图像，图像仅用于本次 Agent 生成绘本。");
        return;
      }
      const roleLibraryReferenceImage = familyPhotoUrl ? null : await makeFamilyProfileReferenceDataUrl(familyProfiles);
      sketchImageForApi = familyPhotoUrl ?? roleLibraryReferenceImage ?? undefined;
      familyVisualInputMode = familyPhotoUrl ? "current_photo" : roleLibraryReferenceImage ? "role_library" : "none";
      setRemotePages(null);
      setCultureInfo(null);
      setBookMeta(null);
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

    const controller = new AbortController();
    generationAbortRef.current = controller;
    stopNoticeShownRef.current = false;

    if (MOCK_GENERATION) {
      try {
        await runMockGeneration(controller.signal);
      } catch (e) {
        if (isAbortError(e)) {
          markGenerationStopped();
          return;
        }
        throw e;
      }
      return;
    }

    setIsGenerating(true);
    setGenerationStageIndex(0);
    setStageDetailOverrides({});
    setAgentTrace([]);
    try {
      const sketchNote = sketchDescription.trim();
      const familyWish = familyTravelWish.trim();
      const familyMeta =
        creationMode === "family"
          ? buildFamilyCoCreationMeta(
              familyProfiles,
              familyTravelWish,
              familyChildIdea,
              familyParentGoal,
              !familyPhotoUrl || familyPhotoConfirmed,
              familySavePhotoToShelf,
              familyPhotoThumb,
            )
          : undefined;
      const activeFamilyProfilesText = buildFamilyProfilesText(familyProfiles);
      const enabledProfileCount = familyProfiles.filter((m) => m.enabled).length;
      const profilePhotoCount = familyProfiles.filter((m) => m.enabled && m.photoThumb).length;
      const hasCurrentFamilyPhoto = familyVisualInputMode === "current_photo";
      const hasRoleLibraryReferencePhoto = familyVisualInputMode === "role_library";
      const kw =
        creationMode === "family"
          ? `【亲子共创】${
              hasCurrentFamilyPhoto
                ? "用户上传了本次亲子合照，希望点击「一键穿越」后，把合照里的家长和孩子改写成安全、非写实的儿童绘本角色。"
                : hasRoleLibraryReferencePhoto
                  ? "用户没有上传本次合照；系统已把家庭角色库里已启用成员照片合成为一张参考图，希望点击「一键穿越」后，按角色库参考图和亲子共创文字生成安全、非写实的儿童绘本角色。"
                  : "用户没有上传本次合照，也没有可用的角色库照片，希望点击「一键穿越」后，按家庭角色库文字和亲子共创文字生成安全、非写实的儿童绘本角色。"
            }角色将穿越到古代中国传统故事里共同冒险。

创作要求：
1. 若本次上传了合照，当前合照优先：以合照中的人数、亲子关系、服装色彩、发型轮廓、表情气质和互动氛围为主要视觉证据；只做安全、非写实绘本化，不复刻真实人脸，不出现照片背景隐私。
2. 故事应体现家长和孩子共同观察、讨论、分工、解决问题的亲子共创感。
3. 文化内容重点参考传统文化内核，不强行复刻原故事情节。
4. 每页画面都应保持亲子角色一致，不添加现代品牌、可读文字或水印。
5. 若本次上传了合照，角色库只用于匹配合照中的人物身份、昵称、亲子分工和性格倾向；如果角色库与本次合照的外观冲突，以本次合照为准。
6. 若没有上传本次合照但有角色库参考图，请按参考图中从左到右、从上到下的顺序，对应家庭角色库文字中的第 1、2、3... 位成员；参考图只提供非敏感外观锚点，不要声称看到了合照。
7. 若没有任何图片参考，则以家庭角色库文字、孩子点子、家长期待和穿越愿望为主；不要声称看到了合照或照片。

【家庭角色库】
${activeFamilyProfilesText}

【角色库照片状态】
本次启用 ${enabledProfileCount} 位家庭成员，其中 ${profilePhotoCount} 位已有浏览器本地保存的成员照片。若没有本次合照，已启用成员照片会合成为一张角色库参考图用于本次生成；若有本次合照，则不发送角色库照片，角色库只补充文字设定。

【本次合照状态】
${hasCurrentFamilyPhoto ? "已上传本次合照：请优先参考本次合照，并用角色库辅助识别人物。" : hasRoleLibraryReferencePhoto ? "未上传本次合照：已提供角色库参考图，请按参考图和角色库文字创作；不要把它描述为合照。" : "未上传本次合照，也没有角色库参考图：请按角色库文字和亲子共创文字创作，不要进行照片理解。"}

【孩子负责的点子】
${familyChildIdea.trim() || "孩子想在故事里发现一个小问题，并亲自观察、试验、想办法解决。"}

【家长负责的期待】
${familyParentGoal.trim() || "家长期待故事温暖、有合作感，读完可以一起讨论勇气、互助和守信。"}

【穿越愿望】${familyWish || "穿越到古代中国传统故事里，展开一次温暖、有趣、互相帮助的冒险。"}`
          : creationMode === "sketch"
          ? `儿童手绘画本·根据孩子草图与理解结果创作积极向上的小故事${
              sketchNote ? `\n\n【孩子描述】${sketchNote}` : ""
            }`
          : creationMode === "keywords"
            ? buildKeywordsForApi(keywordPayload)
            : voiceEditedText.trim();
      const base = (API_BASE ?? "").replace(/\/$/, "");
      const res = await fetch(`${base}/api/storybook/create/stream`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: kw,
          style,
          creation_source: creationMode,
          ...(sketchImageForApi ? { sketch_image_base64: sketchImageForApi } : {}),
          ...(creationMode === "sketch" && sketchNote ? { sketch_text: sketchNote } : {}),
          ...(creationMode === "family"
            ? {
                sketch_text: [
                  familyWish ? `穿越愿望：${familyWish}` : "",
                  familyChildIdea.trim() ? `孩子点子：${familyChildIdea.trim()}` : "",
                  familyParentGoal.trim() ? `家长期待：${familyParentGoal.trim()}` : "",
                  hasCurrentFamilyPhoto
                    ? "本次合照：已上传，合照优先；角色库用于匹配人物。"
                    : hasRoleLibraryReferencePhoto
                      ? "本次合照：未上传；已提供角色库参考图，按参考图和文字描述创作，不要称为合照。"
                      : "本次合照：未上传，按角色库文字和亲子共创文字创作。",
                  `家庭角色库：${activeFamilyProfilesText}`,
                ]
                  .filter(Boolean)
                  .join("\n"),
              }
            : {}),
        }),
      });
      if (!res.ok || !res.body) {
        setApiError(`请求失败（HTTP ${res.status}）`);
        if (creationMode === "sketch") setSketchSnapshotUrl(null);
        return;
      }
      let finalData: StorybookCreateResponse | null = null;
      let streamError: string | null = null;
      let streamSafetyBlocked = false;
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
            streamError = kidFacingApiError(message, "服务端流式生成失败");
            streamSafetyBlocked = streamSafetyBlocked || isSafetyBlocked(message);
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
            streamError = kidFacingApiError(message, "服务端流式生成失败");
            streamSafetyBlocked = streamSafetyBlocked || isSafetyBlocked(message);
          }
        } catch {
          // ignore malformed tail chunk
        }
      }
      const data = finalData;
      if (!data) {
        const message = streamError ?? "未收到后端结果，请重试";
        setApiError(message);
        if (streamSafetyBlocked) setApiDialog(message);
        if (creationMode === "sketch") setSketchSnapshotUrl(null);
        return;
      }
      if (!data.ok) {
        showApiFailure(data, `请求失败（HTTP ${res.status}）`);
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
        const nextCultureInfo: CultureRagInfo = {
          used: Boolean(data.culture_rag_used),
          hits: data.culture_hits ?? [],
          context: data.culture_context,
          integrationNote: data.culture_integration_note,
        };
        const interactionCards = buildInteractionCards(pages, familyMeta, nextCultureInfo);
        setBookMeta({
          title: data.title!,
          storyText: data.story_text,
          style,
          visualConsistency: data.visual_consistency,
          familyCoCreation: familyMeta,
          interactionCards,
          styleKeywords: data.style_keywords ?? [],
          styleKeywordEnhancements: data.image_prompt_enhancements ?? [],
        });
        setCultureInfo(nextCultureInfo);
        setActiveIndex(0);
        const src: BookshelfEntry["mode"] =
          creationMode === "sketch"
            ? "sketch"
            : creationMode === "family"
              ? "family"
              : creationMode === "keywords"
                ? "keywords"
                : "voice";
        setLastBookSource(src);
      } else {
        setApiError("后端返回数据不完整（缺少 title / scenes / image_urls）");
        if (creationMode === "sketch") setSketchSnapshotUrl(null);
      }
    } catch (e) {
      if (isAbortError(e)) {
        markGenerationStopped();
        if (creationMode === "sketch") setSketchSnapshotUrl(null);
        return;
      }
      console.error(e);
      setApiError(e instanceof Error ? e.message : "网络错误，请确认后端已启动");
      if (creationMode === "sketch") setSketchSnapshotUrl(null);
    } finally {
      setIsGenerating(false);
      if (generationAbortRef.current === controller) {
        generationAbortRef.current = null;
      }
    }
  };

  const handleRewritePage = async (pageIndex: number, instruction: string): Promise<boolean> => {
    clearApiError();
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
        ...prev,
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
        showApiFailure(data, `替换失败（HTTP ${res.status}）`);
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
        ...prev,
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAppView("create")}
            className={`text-xs font-bold border-2 border-theme-text rounded-full px-3 py-1 transition-colors ${
              appView === "create"
                ? "bg-theme-text text-white"
                : "bg-theme-bg hover:bg-theme-secondary hover:text-white"
            }`}
          >
            创作台
          </button>
          <button
            type="button"
            onClick={() => {
              void refreshBookshelf();
              setAppView("bookshelf");
            }}
            className={`text-xs font-bold border-2 border-theme-text rounded-full px-3 py-1 transition-colors ${
              appView === "bookshelf"
                ? "bg-theme-text text-white"
                : "bg-theme-bg hover:bg-theme-secondary hover:text-white"
            }`}
          >
            我的书架
          </button>
          <button
            type="button"
            onClick={() => setAppView("familyProfiles")}
            className={`text-xs font-bold border-2 border-theme-text rounded-full px-3 py-1 transition-colors ${
              appView === "familyProfiles"
                ? "bg-theme-text text-white"
                : "bg-theme-bg hover:bg-theme-secondary hover:text-white"
            }`}
          >
            角色库
          </button>
          <div className="w-8 h-8 rounded-full border-2 border-theme-text bg-theme-success overflow-hidden">
            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=kid&backgroundColor=2AAD6E`} alt="avatar" />
          </div>
        </div>
      </header>

      {apiDialog && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-cn-ink/35 px-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="kid-safety-dialog-title"
            className="w-full max-w-md border-handdrawn bg-white p-5 shadow-[4px_6px_0px_rgba(26,43,60,0.22)]"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border-2 border-cn-ink bg-cn-yellow">
                <Sparkles className="h-5 w-5 text-cn-red" strokeWidth={2.6} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="kid-safety-dialog-title" className="text-lg font-black text-cn-ink">
                  这个灵感不对哦！
                </h2>
                <p className="mt-2 text-sm font-bold leading-relaxed text-cn-ink/75">
                  {apiDialog}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setApiDialog(null)}
                className="rounded-full border-2 border-cn-ink bg-white p-1.5 text-cn-ink hover:bg-cn-paper"
                aria-label="关闭提示"
              >
                <X className="h-4 w-4" strokeWidth={2.6} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setApiDialog(null)}
              className="mt-4 w-full rounded-xl border-2 border-cn-ink bg-cn-red px-4 py-2.5 text-sm font-black text-white shadow-[1px_2px_0px_#1A2B3C] hover:translate-y-[-1px]"
            >
              我换一个灵感
            </button>
          </div>
        </div>
      )}

      {familyComposerOpen && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-cn-ink/45 px-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="family-composer-title"
            className="w-full max-w-2xl overflow-hidden rounded-[24px] border-4 border-cn-ink bg-cn-paper shadow-[6px_8px_0px_rgba(26,43,60,0.22)]"
          >
            <div className="flex items-start justify-between gap-4 border-b-2 border-cn-red/25 bg-cn-red/10 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-cn-ink bg-white">
                    <UsersRound className="h-5 w-5 text-cn-red" strokeWidth={2.6} />
                  </div>
                  <div>
                    <h2 id="family-composer-title" className="text-lg font-black leading-tight text-cn-ink">
                      亲子共创素材
                    </h2>
                    <p className="mt-0.5 text-[11px] font-bold text-cn-ink/55">
                      把孩子点子、家长期待和穿越愿望放在这里填写
                    </p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFamilyComposerOpen(false)}
                className="rounded-full border-2 border-cn-ink bg-white p-1.5 text-cn-ink hover:bg-cn-yellow"
                aria-label="关闭亲子共创素材"
              >
                <X className="h-4 w-4" strokeWidth={2.6} />
              </button>
            </div>
            <div className="grid gap-3 bg-white/90 p-5">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-black text-cn-ink">孩子负责</span>
                <textarea
                  value={familyChildIdea}
                  onChange={(e) => setFamilyChildIdea(e.target.value.slice(0, 220))}
                  rows={3}
                  maxLength={220}
                  placeholder="想遇见谁？想拿到什么宝物？想试一试什么办法？"
                  disabled={isGenerating}
                  className="w-full resize-none rounded-xl border-2 border-cn-red/35 bg-cn-paper/55 p-3 text-sm font-bold leading-relaxed text-cn-ink placeholder:text-cn-ink/35 disabled:opacity-60"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-black text-cn-ink">家长负责</span>
                <textarea
                  value={familyParentGoal}
                  onChange={(e) => setFamilyParentGoal(e.target.value.slice(0, 220))}
                  rows={3}
                  maxLength={220}
                  placeholder="想让孩子看到什么？比如观察、合作、勇气、守信、解决问题。"
                  disabled={isGenerating}
                  className="w-full resize-none rounded-xl border-2 border-cn-red/35 bg-cn-paper/55 p-3 text-sm font-bold leading-relaxed text-cn-ink placeholder:text-cn-ink/35 disabled:opacity-60"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-black text-cn-ink">一键穿越到哪里？</span>
                <textarea
                  value={familyTravelWish}
                  onChange={(e) => setFamilyTravelWish(e.target.value.slice(0, 300))}
                  rows={3}
                  maxLength={300}
                  placeholder="例如：穿越到古代小工坊，和孩子一起修好会吱呀响的小木桥"
                  disabled={isGenerating}
                  className="w-full resize-none rounded-xl border-2 border-cn-red/40 bg-cn-paper/55 p-3 text-sm font-bold leading-relaxed text-cn-ink placeholder:text-cn-ink/35 disabled:opacity-60"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t-2 border-cn-red/20 bg-cn-paper px-5 py-3">
              <button
                type="button"
                onClick={() => setFamilyComposerOpen(false)}
                className="rounded-full border-2 border-cn-ink bg-white px-4 py-2 text-xs font-black text-cn-ink hover:bg-cn-yellow"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => setFamilyComposerOpen(false)}
                className="rounded-full border-2 border-cn-ink bg-cn-red px-5 py-2 text-xs font-black text-white shadow-[1px_2px_0px_#1A2B3C] hover:translate-y-[-1px]"
              >
                保存设定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area - No vertical scroll */}
      <main
        className={
          appView === "bookshelf"
            ? "flex-1 min-h-0 w-full overflow-hidden"
            : appView === "familyProfiles"
              ? "flex-1 min-h-0 w-full overflow-hidden"
            : "flex-1 flex flex-col lg:flex-row w-full px-4 lg:px-6 py-3 gap-6 lg:gap-8 overflow-hidden min-h-0"
        }
      >
        {appView === "bookshelf" ? (
          <BookshelfPage
            items={displayedBookshelfItems}
            onOpenBook={openBookFromShelf}
            onCreateNew={() => setAppView("create")}
            onRemove={(id) => {
              if (demoActive) {
                setDemoBookshelfItems((prev) => prev.filter((item) => item.id !== id));
              } else {
                void removeBookshelfEntry(id).then(() => refreshBookshelf());
              }
            }}
            onClearAll={() => {
              if (demoActive) {
                setDemoBookshelfItems([]);
              } else {
                void clearBookshelf().then(() => refreshBookshelf());
              }
            }}
          />
        ) : appView === "familyProfiles" ? (
          <FamilyProfilePage
            profiles={familyProfiles}
            onProfilesChange={setFamilyProfiles}
            onSave={handleSaveFamilyProfiles}
            onBackToCreate={() => setAppView("create")}
            notice={familyProfileNotice}
            disabled={isGenerating}
          />
        ) : (
          <>
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
                onClick={() => selectCreationMode("voice")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full font-bold text-[11px] ${creationMode === "voice" ? "bg-theme-surface border-2 border-theme-text shadow-[1px_1px_0px_#1A2B3C]" : "text-theme-text/40 hover:text-theme-text"}`}
              >
                <Mic className="w-3 h-3" /> 语音
              </button>
              <button
                onClick={() => selectCreationMode("keywords")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full font-bold text-[11px] ${creationMode === "keywords" ? "bg-theme-surface border-2 border-theme-text shadow-[1px_1px_0px_#1A2B3C]" : "text-theme-text/40 hover:text-theme-text"}`}
              >
                <Type className="w-3 h-3" /> 选词
              </button>
              <button
                onClick={() => selectCreationMode("sketch")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full font-bold text-[11px] ${creationMode === "sketch" ? "bg-theme-surface border-2 border-theme-text shadow-[1px_1px_0px_#1A2B3C]" : "text-theme-text/40 hover:text-theme-text"}`}
              >
                <PenTool className="w-3 h-3" /> 草图
              </button>
              <button
                onClick={() => selectCreationMode("family")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full font-bold text-[11px] ${creationMode === "family" ? "bg-theme-surface border-2 border-theme-text shadow-[1px_1px_0px_#1A2B3C]" : "text-theme-text/40 hover:text-theme-text"}`}
              >
                <UsersRound className="w-3 h-3" /> 亲子
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
                  {creationMode === "family" && "亲子共创素材"}
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
                    <KeywordsSelector value={keywordPayload} onSelectionChange={onKeywordsChange} />
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

                <div className={creationMode === "family" ? "" : "hidden"}>
                  <div className="rounded-xl border-2 border-dashed border-cn-red/70 bg-cn-red/10 p-2">
                    {familyPhotoUrl ? (
                      <div className="flex flex-col gap-2">
                        <div className="relative overflow-hidden rounded-lg border-2 border-cn-ink bg-white">
                          <img
                            src={familyPhotoUrl}
                            alt="亲子合照预览"
                            className="h-[92px] w-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setFamilyPhotoUrl(null);
                              setFamilyPhotoThumb(null);
                              setFamilyPhotoName("");
                              setFamilyPhotoConfirmed(false);
                            }}
                            disabled={isGenerating}
                            className="absolute right-1.5 top-1.5 rounded-full border-2 border-cn-ink bg-white p-1 hover:bg-cn-yellow disabled:opacity-50"
                            title="移除合照"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="truncate text-[10px] font-bold text-cn-ink/60">{familyPhotoName || "已上传本次合照"}</p>
                      </div>
                    ) : (
                      <label className="flex min-h-[92px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-cn-ink/15 bg-white/75 px-3 text-center hover:bg-white">
                        <Upload className="h-5 w-5 text-cn-red" />
                        <span className="text-[12px] font-black text-cn-ink">上传合照（可选）</span>
                        <span className="text-[9px] font-semibold leading-snug text-cn-ink/50">
                          上传后合照优先；不上传则使用角色库照片和文字
                        </span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          disabled={isGenerating}
                          onChange={(e) => {
                            void handleFamilyPhotoChange(e.target.files?.[0] ?? null);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>

                  {familyPhotoUrl ? (
                    <div className="mt-2 rounded-lg border border-cn-red/35 bg-white/75 p-2">
                      <label className="flex items-start gap-2 text-[10px] font-bold leading-snug text-cn-ink/75">
                        <input
                          type="checkbox"
                          checked={familyPhotoConfirmed}
                          onChange={(e) => setFamilyPhotoConfirmed(e.target.checked)}
                          disabled={isGenerating}
                          className="mt-0.5 h-3.5 w-3.5 accent-cn-red"
                        />
                        <span>
                          我已确认可使用这张家庭合照。童趣绘梦不会云端保存上传图像，图像仅用于本次 Agent 生成绘本。
                        </span>
                      </label>
                      <label className="mt-2 flex items-start gap-2 text-[10px] font-bold leading-snug text-cn-ink/65">
                        <input
                          type="checkbox"
                          checked={familySavePhotoToShelf}
                          onChange={(e) => setFamilySavePhotoToShelf(e.target.checked)}
                          disabled={isGenerating}
                          className="mt-0.5 h-3.5 w-3.5 accent-cn-red"
                        />
                        <span>生成后把合照缩略图保存在当前浏览器书架里，方便做成长纪念。</span>
                      </label>
                    </div>
                  ) : (
                    <p className="mt-2 rounded-lg border border-cn-red/25 bg-white/75 px-2 py-1.5 text-[10px] font-bold leading-snug text-cn-ink/55">
                      合照可选；没有合照时，会优先使用已启用的角色库照片，再结合孩子点子和家长期待创作。
                    </p>
                  )}

                  <div className="mt-2 rounded-xl border-2 border-cn-red/35 bg-white/85 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-black text-cn-ink">亲子共创设定</p>
                        <p className="mt-0.5 text-[9.5px] font-bold leading-snug text-cn-ink/50">
                          孩子点子、家长期待和穿越愿望
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFamilyComposerOpen(true)}
                        className="rounded-full border-2 border-cn-ink bg-cn-red px-3 py-1.5 text-[10px] font-black text-white shadow-[1px_2px_0px_#1A2B3C] hover:translate-y-[-1px]"
                      >
                        {familyChildIdea.trim() || familyParentGoal.trim() || familyTravelWish.trim() ? "编辑素材" : "填写素材"}
                      </button>
                    </div>
                    <div className="mt-2 grid gap-1.5">
                      <div className="rounded-lg bg-cn-paper/55 px-2 py-1.5">
                        <span className="text-[9px] font-black text-cn-red">孩子</span>
                        <p className="line-clamp-1 text-[10.5px] font-bold leading-snug text-cn-ink/70">
                          {familyChildIdea.trim() || "还没填写孩子想放进故事里的点子"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-cn-paper/55 px-2 py-1.5">
                        <span className="text-[9px] font-black text-cn-red">家长</span>
                        <p className="line-clamp-1 text-[10.5px] font-bold leading-snug text-cn-ink/70">
                          {familyParentGoal.trim() || "还没填写家长期待孩子看见的成长点"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-cn-paper/55 px-2 py-1.5">
                        <span className="text-[9px] font-black text-cn-red">穿越</span>
                        <p className="line-clamp-1 text-[10.5px] font-bold leading-snug text-cn-ink/70">
                          {familyTravelWish.trim() || "还没填写想一起穿越到哪里"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 rounded-xl border-2 border-cn-ink/20 bg-cn-paper/35 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <UsersRound className="h-3.5 w-3.5 text-cn-red" />
                          <p className="text-[11px] font-black text-cn-ink">家庭角色库</p>
                        </div>
                        <p className="mt-0.5 text-[9.5px] font-bold leading-snug text-cn-ink/55">
                          已启用 {familyProfiles.filter((m) => m.enabled).length} 位 · {familyProfiles.filter((m) => m.enabled && m.photoThumb).length} 位有照片
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAppView("familyProfiles")}
                        disabled={isGenerating}
                        className="rounded-full border-2 border-cn-ink bg-white px-3 py-1.5 text-[10px] font-black text-cn-ink hover:bg-cn-red hover:text-white disabled:opacity-45"
                      >
                        编辑角色库
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {familyProfiles.filter((m) => m.enabled).slice(0, 4).map((member) => (
                        <span
                          key={member.id}
                          className="flex items-center gap-1 rounded-full border border-cn-red/30 bg-white px-2 py-1 text-[9.5px] font-black text-cn-ink/70"
                        >
                          {member.photoThumb ? (
                            <img src={member.photoThumb} alt="" className="h-4 w-4 rounded-full object-cover" />
                          ) : null}
                          {member.displayName || member.relation}
                        </span>
                      ))}
                      {familyProfiles.filter((m) => m.enabled).length === 0 ? (
                        <span className="rounded-full border border-cn-ink/15 bg-white px-2 py-1 text-[9.5px] font-bold text-cn-ink/45">
                          未启用成员，将按合照或文字自动生成
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[9.5px] font-bold leading-snug text-cn-ink/50">
                      规则：本次合照优先；没有合照时使用已启用成员照片作为角色参考。角色库会补充昵称、身份、性格和分工。
                    </p>
                  </div>
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
              {!API_BASE && !demoActive && (
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
                <span className="font-classical tracking-widest text-lg">
                  {creationMode === "family" ? "一键穿越" : "开始变魔术"}
                </span>
              </button>
              {isGenerating && (
                <button
                  type="button"
                  onClick={handleStopGeneration}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-cn-ink bg-white px-4 py-2 text-sm font-black text-cn-red shadow-[1px_2px_0px_#1A2B3C] transition-all hover:translate-y-[-1px] hover:bg-cn-paper"
                >
                  <Square className="h-4 w-4 fill-cn-red/20" strokeWidth={2.6} />
                  <span>停止变魔术</span>
                </button>
              )}
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
              familyCoCreation={bookMeta?.familyCoCreation}
              interactionCards={bookMeta?.interactionCards ?? []}
              styleKeywords={bookMeta?.styleKeywords ?? []}
              styleKeywordEnhancements={bookMeta?.styleKeywordEnhancements ?? []}
              onSpeakPage={(i) => autoPlayPage(i)}
              onRewritePage={remotePages ? handleRewritePage : undefined}
              rewritingPageIndex={rewritingPageIndex}
              onAddToBookshelf={canAddToShelf ? () => void handleAddToBookshelf() : undefined}
            />
          )}
        </section>
          </>
        )}
      </main>
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
