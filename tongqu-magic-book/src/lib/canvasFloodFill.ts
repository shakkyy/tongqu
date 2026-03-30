/** 在 ImageData 上对 (sx,sy) 连通区域做填充（忽略 alpha，目标为不透明） */
export function floodFillImageData(
  data: ImageData,
  width: number,
  height: number,
  sx: number,
  sy: number,
  fr: number,
  fg: number,
  fb: number,
  tolerance: number
): void {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return;

  const d = data.data;
  const start = (y0 * width + x0) * 4;
  const tr = d[start];
  const tg = d[start + 1];
  const tb = d[start + 2];

  const match = (p: number) => {
    const r = d[p];
    const g = d[p + 1];
    const b = d[p + 2];
    return (
      Math.abs(r - tr) <= tolerance &&
      Math.abs(g - tg) <= tolerance &&
      Math.abs(b - tb) <= tolerance
    );
  };

  const sameAsFill = (p: number) =>
    Math.abs(d[p] - fr) <= tolerance &&
    Math.abs(d[p + 1] - fg) <= tolerance &&
    Math.abs(d[p + 2] - fb) <= tolerance;

  if (sameAsFill(start)) return;

  const visited = new Uint8Array(width * height);
  const stack: number[] = [y0 * width + x0];

  while (stack.length > 0) {
    const i = stack.pop()!;
    if (visited[i]) continue;
    const px = i % width;
    const py = (i / width) | 0;
    const p = i * 4;
    if (!match(p)) continue;
    visited[i] = 1;
    d[p] = fr;
    d[p + 1] = fg;
    d[p + 2] = fb;
    d[p + 3] = 255;

    if (px + 1 < width && !visited[i + 1]) stack.push(i + 1);
    if (px > 0 && !visited[i - 1]) stack.push(i - 1);
    if (py + 1 < height && !visited[i + width]) stack.push(i + width);
    if (py > 0 && !visited[i - width]) stack.push(i - width);
  }
}
