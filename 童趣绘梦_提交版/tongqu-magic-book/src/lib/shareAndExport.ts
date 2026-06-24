import type { CultureRagInfo, FamilyCoCreationMeta, InteractionCard, StoryPage } from "../types";

export type ExportPreviewDocument = {
  title: string;
  filename: string;
  html: string;
  kind: "story" | "memory";
};

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
      h.story_summary ? `传统故事简介：${h.story_summary}` : "",
      h.core_idea ? `核心思想：${h.core_idea}` : "",
      h.child_friendly_takeaway ? `儿童化寓意：${h.child_friendly_takeaway}` : "",
      h.visual_motifs?.length ? `视觉意象：${h.visual_motifs.join("、")}` : "",
    ].filter(Boolean)),
    "",
  ].filter(Boolean);
}

function buildFamilyText(family?: FamilyCoCreationMeta): string[] {
  if (!family) return [];
  const members = family.members?.filter((m) => m.enabled) ?? [];
  return [
    "【亲子共创】",
    family.travelWish ? `穿越愿望：${family.travelWish}` : "",
    family.childIdea ? `孩子的点子：${family.childIdea}` : "",
    family.parentGoal ? `家长的期待：${family.parentGoal}` : "",
    members.length
      ? `家庭角色：${members.map((m) => `${m.displayName}（${m.storyRole}）`).join("、")}`
      : "",
    "",
  ].filter(Boolean);
}

function buildInteractionText(cards?: InteractionCard[]): string[] {
  if (!cards?.length) return [];
  return [
    "【读完一起玩】",
    ...cards.map((card, idx) => `${idx + 1}. ${card.title}：${card.prompt}`),
    "",
  ];
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

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

function resolveAssetUrl(src: string): string {
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return src;
  if (typeof window === "undefined") return src;
  return new URL(src, window.location.href).toString();
}

async function inlineImageSrc(src: string): Promise<string> {
  if (!src || src.startsWith("data:")) return src;
  const resolved = resolveAssetUrl(src);
  try {
    const response = await fetch(resolved, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`图片加载失败: ${response.status}`);
    return await readBlobAsDataUrl(await response.blob());
  } catch {
    return resolved;
  }
}

async function inlineExportImages(
  pages: StoryPage[],
  family?: FamilyCoCreationMeta,
): Promise<{ pages: StoryPage[]; family?: FamilyCoCreationMeta }> {
  const inlinedPages = await Promise.all(
    pages.map(async (page) => ({
      ...page,
      imageUrl: await inlineImageSrc(page.imageUrl),
    })),
  );
  const inlinedFamily = family
    ? {
        ...family,
        familyPhotoThumb: family.familyPhotoThumb ? await inlineImageSrc(family.familyPhotoThumb) : undefined,
      }
    : undefined;
  return { pages: inlinedPages, family: inlinedFamily };
}

function buildFamilyHtml(family?: FamilyCoCreationMeta): string {
  if (!family) return "";
  const members = family.members?.filter((m) => m.enabled) ?? [];
  return `
<section class="memory">
  <h2>亲子共创记录</h2>
  ${family.familyPhotoThumb ? `<img class="family-photo" src="${escapeHtml(family.familyPhotoThumb)}" alt="家庭合照缩略图" />` : ""}
  ${family.travelWish ? `<p><strong>穿越愿望：</strong>${escapeHtml(family.travelWish)}</p>` : ""}
  ${family.childIdea ? `<p><strong>孩子的点子：</strong>${escapeHtml(family.childIdea)}</p>` : ""}
  ${family.parentGoal ? `<p><strong>家长的期待：</strong>${escapeHtml(family.parentGoal)}</p>` : ""}
  ${
    members.length
      ? `<div class="member-grid">${members
          .map(
            (m) => `
    <div class="member">
      <h3>${escapeHtml(m.displayName)} <span>${escapeHtml(m.relation)}</span></h3>
      <p><strong>${escapeHtml(m.storyRole)}</strong></p>
      <p>${escapeHtml(m.characterDescription)}</p>
    </div>`,
          )
          .join("")}</div>`
      : ""
  }
</section>`;
}

function buildInteractionHtml(cards?: InteractionCard[]): string {
  if (!cards?.length) return "";
  return `
<section class="memory">
  <h2>读完一起玩</h2>
  <div class="card-grid">
    ${cards
      .map(
        (card) => `
    <div class="play-card">
      <h3>${escapeHtml(card.title)}</h3>
      <p>${escapeHtml(card.prompt)}</p>
    </div>`,
      )
      .join("")}
  </div>
</section>`;
}

function buildHtmlDocument(
  pages: StoryPage[],
  bookTitle: string,
  culture?: CultureRagInfo,
  options?: {
    family?: FamilyCoCreationMeta;
    interactionCards?: InteractionCard[];
    memoryBook?: boolean;
  },
): string {
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
    ${h.story_summary ? `<p><strong>传统故事简介：</strong>${escapeHtml(h.story_summary)}</p>` : ""}
    ${h.core_idea ? `<p><strong>核心思想：</strong>${escapeHtml(h.core_idea)}</p>` : ""}
    ${h.child_friendly_takeaway ? `<p><strong>儿童化寓意：</strong>${escapeHtml(h.child_friendly_takeaway)}</p>` : ""}
    ${h.visual_motifs?.length ? `<p><strong>视觉意象：</strong>${escapeHtml(h.visual_motifs.join("、"))}</p>` : ""}
  </div>`
    )
    .join("")}
</section>`
      : "";

  const familyBlock = options?.memoryBook ? buildFamilyHtml(options.family) : "";
  const interactionBlock = options?.memoryBook ? buildInteractionHtml(options.interactionCards) : "";
  const memberNames = options?.family?.members?.filter((m) => m.enabled).map((m) => m.displayName).join("、") || "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(bookTitle)}</title>
<style>
body { font-family: "Noto Serif SC", "Songti SC", "SimSun", serif; max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; background: #faf8f5; color: #1a1a2e; }
h1 { text-align: center; font-size: 1.35rem; margin-bottom: 1.5rem; }
.cover { min-height: ${options?.memoryBook ? "72vh" : "auto"}; display: ${options?.memoryBook ? "flex" : "block"}; flex-direction: column; justify-content: center; text-align: center; page-break-after: ${options?.memoryBook ? "always" : "auto"}; }
.cover .subtitle { color: #7c4a20; font-size: 0.95rem; line-height: 1.8; }
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
.memory { margin: 2.5rem 0; padding: 18px; border: 2px solid #1a2b3c; border-radius: 12px; background: #fffdf6; page-break-inside: avoid; }
.memory h2 { color: #1a2b3c; }
.member-grid, .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 12px; }
.family-photo { width: 100%; max-height: 260px; object-fit: cover; margin: 8px 0 14px; border-radius: 10px; border: 2px solid #1a2b3c; }
.member, .play-card { border: 1px dashed #b8905f; border-radius: 10px; padding: 12px; background: #fff8e8; }
.member h3, .play-card h3 { margin: 0 0 6px; font-size: 0.95rem; }
.member h3 span { color: #777; font-size: 0.78rem; font-weight: 400; }
.member p, .play-card p { margin: 0.35rem 0; font-size: 0.88rem; line-height: 1.65; }
@media print { body { background: #fff; } img { border-color: #333; } }
</style>
</head>
<body>
<section class="cover">
  <h1>${escapeHtml(bookTitle)}</h1>
  ${options?.memoryBook ? `<p class="subtitle">一本由${memberNames ? ` ${escapeHtml(memberNames)} ` : "家人"}共同完成的童趣绘梦纪念册<br />${escapeHtml(new Date().toLocaleDateString("zh-CN"))}</p>` : ""}
</section>
${familyBlock}
${sections}
${cultureBlock}
${interactionBlock}
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

export async function buildStoryExportPreview(
  pages: StoryPage[],
  bookTitle: string,
  culture?: CultureRagInfo,
): Promise<ExportPreviewDocument> {
  if (pages.length === 0) {
    throw new Error("empty");
  }
  const name = sanitizeFilename(bookTitle);
  const inlined = await inlineExportImages(pages);
  return {
    title: `《${bookTitle}》导出预览`,
    filename: `${name}.pdf`,
    kind: "story",
    html: buildHtmlDocument(inlined.pages, bookTitle, culture),
  };
}

export async function buildMemoryBookExportPreview(
  pages: StoryPage[],
  bookTitle: string,
  culture?: CultureRagInfo,
  family?: FamilyCoCreationMeta,
  interactionCards?: InteractionCard[],
): Promise<ExportPreviewDocument> {
  if (pages.length === 0) {
    throw new Error("empty");
  }
  const name = sanitizeFilename(`${bookTitle}_亲子纪念册`);
  const inlined = await inlineExportImages(pages, family);
  return {
    title: `《${bookTitle}》纪念册预览`,
    filename: `${name}.pdf`,
    kind: "memory",
    html: buildHtmlDocument(inlined.pages, bookTitle, culture, {
      family: inlined.family,
      interactionCards,
      memoryBook: true,
    }),
  };
}

export async function buildExportPreviewDocument(
  pages: StoryPage[],
  bookTitle: string,
  culture?: CultureRagInfo,
  options?: {
    family?: FamilyCoCreationMeta;
    interactionCards?: InteractionCard[];
    memoryBook?: boolean;
  },
): Promise<ExportPreviewDocument> {
  if (options?.memoryBook) {
    return buildMemoryBookExportPreview(pages, bookTitle, culture, options.family, options.interactionCards);
  }
  return buildStoryExportPreview(pages, bookTitle, culture);
}

export function resolveBookTitle(pages: StoryPage[]): string {
  const raw = pages[0]?.title?.trim() || "童趣绘本";
  return raw.split("·")[0]?.trim() || raw;
}
