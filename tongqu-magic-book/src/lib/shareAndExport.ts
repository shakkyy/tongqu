import type { StoryPage } from "../types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sanitizeFilename(s: string): string {
  const t = s.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, "_").trim();
  return t.slice(0, 80) || "绘本";
}

function buildPlainText(pages: StoryPage[], bookTitle: string): string {
  const lines: string[] = [
    `《${bookTitle}》`,
    `共 ${pages.length} 页`,
    "",
    ...pages.flatMap((p, i) => [`【第 ${i + 1} 页】${p.title}`, p.text, ""]),
    `——`,
    `来自「童趣绘梦」${typeof window !== "undefined" ? window.location.href : ""}`,
  ];
  return lines.join("\n").trim();
}

function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildHtmlDocument(pages: StoryPage[], bookTitle: string): string {
  const sections = pages
    .map(
      (p) => `
<section class="page">
  <h2>${escapeHtml(p.title)}</h2>
  <figure>
    <img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.title)}" loading="lazy" />
  </figure>
  <p class="caption">${escapeHtml(p.text)}</p>
</section>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(bookTitle)}</title>
<style>
body { font-family: "Noto Serif SC", "Songti SC", "SimSun", serif; max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; background: #faf8f5; color: #1a1a2e; }
h1 { text-align: center; font-size: 1.35rem; margin-bottom: 1.5rem; }
.page { margin-bottom: 2.5rem; page-break-inside: avoid; }
h2 { font-size: 1rem; margin: 0 0 0.5rem; color: #333; }
figure { margin: 0; }
img { display: block; width: 100%; height: auto; border-radius: 8px; border: 2px solid #1a2b3c; box-sizing: border-box; }
.caption { margin-top: 12px; font-size: 0.95rem; line-height: 1.75; white-space: pre-wrap; }
footer { text-align: center; font-size: 12px; color: #666; margin-top: 2rem; padding-top: 1rem; border-top: 1px dashed #ccc; }
@media print { body { background: #fff; } img { border-color: #333; } }
</style>
</head>
<body>
<h1>${escapeHtml(bookTitle)}</h1>
${sections}
<footer>由「童趣绘梦」导出 · ${escapeHtml(new Date().toLocaleString("zh-CN"))}</footer>
</body>
</html>`;
}

/** 优先系统分享；不支持或失败则复制全文到剪贴板 */
export async function shareStory(
  pages: StoryPage[],
  bookTitle: string
): Promise<{ ok: boolean; message: string }> {
  if (pages.length === 0) {
    return { ok: false, message: "当前没有可分享的内容" };
  }
  const text = buildPlainText(pages, bookTitle);

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: `《${bookTitle}》`,
        text,
        url: typeof window !== "undefined" ? window.location.href : undefined,
      });
      return { ok: true, message: "已通过系统分享面板发送" };
    } catch (e) {
      const err = e as Error;
      if (err?.name === "AbortError") {
        return { ok: false, message: "" };
      }
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, message: "全文已复制到剪贴板，可粘贴到微信等应用分享" };
  } catch {
    return { ok: false, message: "分享失败：浏览器不允许复制，请手动选中文字复制" };
  }
}

/** 下载单文件 HTML，可用浏览器打开，或通过打印另存为 PDF */
export function exportStoryAsHtmlFile(pages: StoryPage[], bookTitle: string): void {
  if (pages.length === 0) {
    throw new Error("empty");
  }
  const name = sanitizeFilename(bookTitle);
  const html = buildHtmlDocument(pages, bookTitle);
  downloadBlob(`${name}.html`, html, "text/html;charset=utf-8");
}

export function resolveBookTitle(pages: StoryPage[]): string {
  const raw = pages[0]?.title?.trim() || "童趣绘本";
  return raw.split("·")[0]?.trim() || raw;
}
