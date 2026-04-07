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
const DB_NAME = "tongqu_bookshelf_db";
const DB_VERSION = 1;
const STORE_NAME = "entries";
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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("打开 IndexedDB 失败"));
  });
}

function readAllFromDb(): Promise<BookshelfEntry[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const rows = (req.result as BookshelfEntry[]) || [];
          rows.sort((a, b) => b.createdAt - a.createdAt);
          resolve(rows.slice(0, MAX_ITEMS));
        };
        req.onerror = () => reject(req.error ?? new Error("读取书架失败"));
      }),
  );
}

function writeAllToDb(entries: BookshelfEntry[]): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const clearReq = store.clear();
        clearReq.onerror = () => reject(clearReq.error ?? new Error("清空书架失败"));
        clearReq.onsuccess = () => {
          for (const e of entries.slice(0, MAX_ITEMS)) {
            store.put(e);
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("写入书架失败"));
      }),
  );
}

async function migrateFromLocalStorageIfNeeded(): Promise<void> {
  const existing = await readAllFromDb();
  if (existing.length > 0) return;
  const legacy = safeParse(localStorage.getItem(STORAGE_KEY));
  if (legacy.length === 0) return;
  await writeAllToDb(legacy);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function loadBookshelf(): Promise<BookshelfEntry[]> {
  await migrateFromLocalStorageIfNeeded();
  return readAllFromDb();
}

export async function addBookshelfEntry(entry: BookshelfEntry): Promise<void> {
  const list = await loadBookshelf();
  const next = [entry, ...list.filter((e) => e.id !== entry.id)]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ITEMS);
  await writeAllToDb(next);
}

export async function removeBookshelfEntry(id: string): Promise<void> {
  const list = await loadBookshelf();
  await writeAllToDb(list.filter((e) => e.id !== id));
}

export async function clearBookshelf(): Promise<void> {
  await writeAllToDb([]);
}
