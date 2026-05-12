import type { CultureRagInfo, StoryPage } from "../types";

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

function buildCultureText(culture?: CultureRagInfo): string[] {
  if (!culture?.used || culture.hits.length === 0) return [];
  return [
    "【文化发掘】",
    `检索到：${culture.hits.map((h) => h.title).join("、")}`,
    ...culture.hits.slice(0, 3).flatMap((h, i) => [
      `${i + 1}. ${h.title}${h.score !== undefined ? `（相似度 ${h.score}）` : ""}`,
      h.core_idea ? `核心思想：${h.core_idea}` : "",
      h.child_friendly_takeaway ? `儿童化寓意：${h.child_friendly_takeaway}` : "",
      h.visual_motifs?.length ? `视觉意象：${h.visual_motifs.join("、")}` : "",
    ].filter(Boolean)),
    culture.integrationNote ? `改写说明：${culture.integrationNote}` : "",
    "",
  ].filter(Boolean);
}

function buildPlainText(pages: StoryPage[], bookTitle: string, culture?: CultureRagInfo): string {
  const lines: string[] = [
    `《${bookTitle}》`,
    `共 ${pages.length} 页`,
    "",
    ...pages.flatMap((p, i) => [`【第 ${i + 1} 页】${p.title}`, p.text, ""]),
    ...buildCultureText(culture),
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

function buildHtmlDocument(pages: StoryPage[], bookTitle: string, culture?: CultureRagInfo): string {
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
  const cultureBlock =
    culture?.used && culture.hits.length > 0
      ? `
<section class="culture">
  <h2>文化发掘过程</h2>
  <p><strong>检索到：</strong>${escapeHtml(culture.hits.map((h) => h.title).join("、"))}</p>
  ${culture.hits
    .slice(0, 3)
    .map(
      (h) => `
  <div class="culture-hit">
    <h3>${escapeHtml(h.title)}${h.score !== undefined ? ` <span>相似度 ${escapeHtml(String(h.score))}</span>` : ""}</h3>
    ${h.core_idea ? `<p><strong>核心思想：</strong>${escapeHtml(h.core_idea)}</p>` : ""}
    ${h.child_friendly_takeaway ? `<p><strong>儿童化寓意：</strong>${escapeHtml(h.child_friendly_takeaway)}</p>` : ""}
    ${h.visual_motifs?.length ? `<p><strong>视觉意象：</strong>${escapeHtml(h.visual_motifs.join("、"))}</p>` : ""}
  </div>`
    )
    .join("")}
  ${culture.integrationNote ? `<p><strong>改写说明：</strong>${escapeHtml(culture.integrationNote)}</p>` : ""}
</section>`
      : "";

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
.culture { margin: 2.5rem 0; padding: 16px; border: 2px dashed #9c6b35; border-radius: 10px; background: #fffaf0; }
.culture h2 { color: #7c4a20; }
.culture-hit { margin: 12px 0; padding-top: 8px; border-top: 1px dashed #dcc7a8; }
.culture-hit h3 { font-size: 0.95rem; margin: 0 0 0.35rem; }
.culture-hit h3 span { font-size: 0.75rem; color: #777; font-weight: 400; }
.culture p { font-size: 0.9rem; line-height: 1.65; margin: 0.35rem 0; }
@media print { body { background: #fff; } img { border-color: #333; } }
</style>
</head>
<body>
<h1>${escapeHtml(bookTitle)}</h1>
${sections}
${cultureBlock}
<footer>由「童趣绘梦」导出 · ${escapeHtml(new Date().toLocaleString("zh-CN"))}</footer>
</body>
</html>`;
}

/** 优先系统分享；不支持或失败则复制全文到剪贴板 */
export async function shareStory(
  pages: StoryPage[],
  bookTitle: string,
  culture?: CultureRagInfo
): Promise<{ ok: boolean; message: string }> {
  if (pages.length === 0) {
    return { ok: false, message: "当前没有可分享的内容" };
  }
  const text = buildPlainText(pages, bookTitle, culture);

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
export function exportStoryAsHtmlFile(pages: StoryPage[], bookTitle: string, culture?: CultureRagInfo): void {
  if (pages.length === 0) {
    throw new Error("empty");
  }
  const name = sanitizeFilename(bookTitle);
  const html = buildHtmlDocument(pages, bookTitle, culture);
  downloadBlob(`${name}.html`, html, "text/html;charset=utf-8");
}

export function resolveBookTitle(pages: StoryPage[]): string {
  const raw = pages[0]?.title?.trim() || "童趣绘本";
  return raw.split("·")[0]?.trim() || raw;
}
