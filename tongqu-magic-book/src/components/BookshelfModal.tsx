import type { BookshelfEntry } from "../lib/bookshelfStorage";
import { BookOpen, Trash2, X, Settings2 } from "lucide-react";
interface BookshelfModalProps {
  open: boolean;
  onClose: () => void;
  items: BookshelfEntry[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onOpenBook: (entry: BookshelfEntry) => void;
}

function modeLabel(m: BookshelfEntry["mode"]): string {
  if (m === "sketch") return "草图";
  if (m === "keywords") return "选词";
  return "语音";
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const FALLBACK_COVER = "/封面.png";

export function BookshelfModal({
  open,
  onClose,
  items,
  onRemove,
  onClearAll,
  onOpenBook,
}: BookshelfModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-white border-4 border-cn-ink rounded-2xl shadow-2xl overflow-hidden font-classical"
        role="dialog"
        aria-labelledby="bookshelf-title"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-cn-ink bg-cn-paper">
          <h2 id="bookshelf-title" className="text-lg font-bold text-cn-ink flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            我的书架
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg border-2 border-cn-ink hover:bg-cn-red hover:text-white transition-colors"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {items.length === 0 ? (
            <p className="text-center text-cn-ink/50 text-sm py-12">还没有记录，生成绘本后会自动保存在这里。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((e) => (
                <li
                  key={e.id}
                  className="flex gap-3 p-2 rounded-xl border-2 border-cn-ink/20 bg-cn-paper/50 hover:border-cn-ink/50 transition-colors"
                >
                  <img
                    src={e.coverUrl || FALLBACK_COVER}
                    alt=""
                    onError={(ev) => {
                      const img = ev.currentTarget;
                      if (img.src.endsWith(encodeURI(FALLBACK_COVER)) || img.src.endsWith(FALLBACK_COVER)) return;
                      img.src = FALLBACK_COVER;
                    }}
                    className="w-20 h-14 object-cover rounded-lg border border-cn-ink/30 shrink-0"
                  />
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <p className="font-bold text-cn-ink text-sm truncate">{e.title}</p>
                    <p className="text-[10px] text-cn-ink/60">
                      {formatTime(e.createdAt)} · {modeLabel(e.mode)} · {e.pageCount} 页
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <button
                        type="button"
                        onClick={() => {
                          onOpenBook(e);
                          onClose();
                        }}
                        className="text-[10px] font-bold px-2 py-1 rounded-md bg-cn-red text-white border border-cn-ink"
                      >
                        打开阅读
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(e.id)}
                        className="text-[10px] font-bold px-2 py-1 rounded-md border-2 border-cn-ink bg-white hover:bg-cn-red hover:text-white flex items-center gap-0.5"
                      >
                        <Trash2 className="w-3 h-3" />
                        删除
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t-2 border-cn-ink bg-cn-paper/80 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-cn-ink/80 text-[10px] font-bold">
            <Settings2 className="w-3.5 h-3.5" />
            设置
          </div>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("确定清空全部书架历史？此操作不可恢复。")) onClearAll();
            }}
            className="w-full py-2 text-xs font-bold border-2 border-cn-ink rounded-xl bg-white hover:bg-cn-red hover:text-white transition-colors"
          >
            清空全部历史记录
          </button>
          <p className="text-[9px] text-cn-ink/45 text-center">数据保存在本机浏览器（localStorage），换设备不会同步。</p>
        </div>
      </div>
    </div>
  );
}
