import type { FamilyMemberProfile } from "../types";

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / Math.max(1, img.width), height / Math.max(1, img.height));
  const sw = width / scale;
  const sh = height / scale;
  const sx = Math.max(0, (img.width - sw) / 2);
  const sy = Math.max(0, (img.height - sh) / 2);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, width, height);
}

export async function makeFamilyProfileReferenceDataUrl(
  profiles: FamilyMemberProfile[],
  maxProfiles = 6,
): Promise<string | null> {
  const rows = profiles.filter((profile) => profile.enabled && profile.photoThumb).slice(0, maxProfiles);
  if (!rows.length) return null;

  const loaded = await Promise.all(rows.map(async (profile) => ({
    profile,
    image: await loadImage(profile.photoThumb || ""),
  })));
  const items = loaded.filter((item): item is { profile: FamilyMemberProfile; image: HTMLImageElement } => Boolean(item.image));
  if (!items.length) return null;

  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 800;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#FFF8E8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#F7E8C7";
  ctx.fillRect(26, 26, canvas.width - 52, canvas.height - 52);
  ctx.fillStyle = "#FFFDF6";
  ctx.fillRect(44, 44, canvas.width - 88, canvas.height - 88);

  const n = items.length;
  const cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
  const rowCount = Math.ceil(n / cols);
  const marginX = cols === 1 ? 240 : 70;
  const marginY = rowCount === 1 ? 150 : 74;
  const gap = 34;
  const cardW = (canvas.width - marginX * 2 - gap * (cols - 1)) / cols;
  const cardH = (canvas.height - marginY * 2 - gap * (rowCount - 1)) / rowCount;

  items.forEach(({ image }, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = marginX + col * (cardW + gap);
    const y = marginY + row * (cardH + gap);
    ctx.fillStyle = "#C94830";
    ctx.fillRect(x - 7, y - 7, cardW + 14, cardH + 14);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y, cardW, cardH);
    drawCoverImage(ctx, image, x + 8, y + 8, cardW - 16, cardH - 16);
  });

  return canvas.toDataURL("image/jpeg", 0.84);
}

export function makeImageThumbnailDataUrl(dataUrl: string, maxWidth = 720): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / Math.max(1, img.width));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.78));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
