import type { StoryPage } from "../types";

export type BookshelfMode = "voice" | "keywords" | "sketch";

export interface BookshelfEntry {
  id: string;
  createdAt: number;
  title: string;
  coverUrl: string;
  pageCount: number;
  mode: BookshelfMode;
  sketchThumb?: string;
  /** 完整分页，便于从书架重新打开 */
  pages: StoryPage[];
}

const STORAGE_KEY = "tongqu_bookshelf_v1";
const MAX_ITEMS = 30;

function safeParse(raw: string | null): BookshelfEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is BookshelfEntry =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as BookshelfEntry).id === "string" &&
        typeof (x as BookshelfEntry).title === "string" &&
        Array.isArray((x as BookshelfEntry).pages)
    );
  } catch {
    return [];
  }
}

/**
 * 书架只保留短链接与文本：不存 TTS 的 data:audio；data:image 一律改为封面 HTTP（或清空），否则单本书即可占满 ~5MB。
 */
export function compactPageForShelf(p: StoryPage, coverFallback: string): StoryPage {
  let imageUrl = p.imageUrl;
  if (imageUrl.startsWith("data:")) {
    imageUrl = coverFallback.startsWith("http") ? coverFallback : "";
  }
  const next: StoryPage = {
    ...p,
    imageUrl,
  };
  if (next.audioUrl?.startsWith("data:")) {
    delete next.audioUrl;
  }
  return next;
}

export function compactBookshelfEntry(entry: BookshelfEntry): BookshelfEntry {
  const cover = entry.coverUrl || entry.pages[0]?.imageUrl || "";
  return {
    ...entry,
    /** 整幅 PNG 的 data URL 动辄数百 KB，不写入 localStorage，避免配额爆满 */
    sketchThumb: undefined,
    pages: entry.pages.map((p) => compactPageForShelf(p, cover)),
  };
}

function trySetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * 写入书架；遇 QuotaExceeded 时依次：去全部草图缩略图 → 淘汰最旧条目 → 仅保留封面与文字页。
 * 仍失败时清空该 key 后只保留最新一条（尽最大努力让用户能继续保存）。
 */
export function saveBookshelf(entries: BookshelfEntry[]): void {
  const base = entries.slice(0, MAX_ITEMS).map(compactBookshelfEntry);

  const serialize = (list: BookshelfEntry[]) => JSON.stringify(list);

  const attempt = (list: BookshelfEntry[]): boolean => {
    return trySetItem(STORAGE_KEY, serialize(list));
  };

  let list = base;
  if (attempt(list)) return;

  list = list.map((e) => ({ ...e, sketchThumb: undefined }));
  if (attempt(list)) return;

  while (list.length > 1) {
    list = list.slice(0, -1);
    if (attempt(list)) return;
  }

  if (list.length === 1) {
    const e = list[0];
    const cover = e.coverUrl || e.pages[0]?.imageUrl || "";
    list = [
      {
        ...e,
        sketchThumb: undefined,
        pages: e.pages.map((p) => compactPageForShelf({ ...p, audioUrl: undefined }, cover)),
      },
    ];
    if (attempt(list)) return;
    const coverHttp = cover.startsWith("http") ? cover : "";
    list = [
      {
        ...e,
        sketchThumb: undefined,
        coverUrl: coverHttp || e.coverUrl,
        pages: e.pages.map((p, i) => ({
          ...p,
          audioUrl: undefined,
          imageUrl: i === 0 ? coverHttp : "",
        })),
      },
    ];
    if (attempt(list)) return;
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (list.length >= 1) {
    const e = compactBookshelfEntry(list[0]);
    if (!trySetItem(STORAGE_KEY, serialize([e]))) {
      throw new DOMException("书架存储空间不足，请清空书架或清理浏览器站点数据。", "QuotaExceededError");
    }
  }
}

export function loadBookshelf(): BookshelfEntry[] {
  const raw = safeParse(localStorage.getItem(STORAGE_KEY));
  const compacted = raw.map(compactBookshelfEntry);
  if (raw.length && JSON.stringify(raw) !== JSON.stringify(compacted)) {
    try {
      saveBookshelf(compacted);
    } catch {
      /* 迁移失败时仍返回压缩后的内存结果，避免 UI 崩溃 */
    }
  }
  return compacted;
}

export function addBookshelfEntry(entry: BookshelfEntry): void {
  const compacted = compactBookshelfEntry(entry);
  const list = loadBookshelf().map(compactBookshelfEntry);
  const next = [compacted, ...list.filter((e) => e.id !== entry.id)].slice(0, MAX_ITEMS);
  saveBookshelf(next);
}

export function removeBookshelfEntry(id: string): void {
  saveBookshelf(loadBookshelf().filter((e) => e.id !== id));
}

export function clearBookshelf(): void {
  localStorage.removeItem(STORAGE_KEY);
}
