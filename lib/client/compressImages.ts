/**
 * Browser-side photo compression. A Vercel function accepts a request body of about 4.5 MB, so photos are shrunk
 * here before upload. The pure parts (dimension maths and the size-budget loop) are unit-tested; the canvas part needs
 * a browser.
 */

/** Total upload budget in bytes. A little under Vercel's body limit, leaving room for multipart overhead. */
export const MAX_TOTAL_BYTES = 3_800_000;

export interface CompressStep {
  maxSide: number;
  quality: number;
}

/** First pass, then progressively smaller if the total is still over budget. */
export const COMPRESS_STEPS: readonly CompressStep[] = [
  { maxSide: 1600, quality: 0.8 },
  { maxSide: 1400, quality: 0.7 },
  { maxSide: 1200, quality: 0.6 },
];

/** Scales so the longest side is at most maxSide. Never enlarges. */
export function fitDimensions(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > 0)) return { width: 1, height: 1 };
  const scale = Math.min(1, maxSide / longest);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type FitResult<T> = { ok: true; items: T[]; total: number; stepIndex: number } | { ok: false; items: T[]; total: number; stepIndex: number };

/**
 * Encodes every page at the first step; if the total is over budget, re-encodes ALL pages at the next step, and so on.
 * Page order is kept. `ok: false` means even the smallest step did not fit.
 */
export async function fitToBudget<T extends { size: number }>(
  pageCount: number,
  encode: (page: number, step: CompressStep) => Promise<T>,
  opts: { budget?: number; steps?: readonly CompressStep[]; onProgress?: (done: number, total: number) => void } = {},
): Promise<FitResult<T>> {
  const budget = opts.budget ?? MAX_TOTAL_BYTES;
  const steps = opts.steps ?? COMPRESS_STEPS;
  let items: T[] = [];
  let total = 0;
  for (let s = 0; s < steps.length; s++) {
    items = [];
    for (let p = 0; p < pageCount; p++) {
      opts.onProgress?.(s * pageCount + p, steps.length * pageCount);
      items.push(await encode(p, steps[s]));
    }
    total = items.reduce((n, i) => n + i.size, 0);
    if (total <= budget) return { ok: true, items, total, stepIndex: s };
  }
  return { ok: false, items, total, stepIndex: steps.length - 1 };
}

export class UnsupportedImageError extends Error {
  fileName: string;
  constructor(fileName: string) {
    super("Please use a JPEG or PNG photo.");
    this.fileName = fileName;
  }
}

export type CompressResult = { ok: true; files: File[]; total: number } | { ok: false; reason: "too-large"; total: number };

/** Formats bytes for display: "2.1 MB" or "640 KB". */
export function formatBytes(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;
}

/**
 * Decodes each photo with its EXIF orientation applied (createImageBitmap "from-image" fixes sideways phone photos),
 * then encodes JPEGs until the total fits. Throws UnsupportedImageError for anything the browser cannot decode (HEIC).
 */
export async function compressPhotos(files: File[], onProgress?: (done: number, total: number) => void): Promise<CompressResult> {
  const bitmaps: ImageBitmap[] = [];
  try {
    for (const f of files) {
      try {
        bitmaps.push(await createImageBitmap(f, { imageOrientation: "from-image" }));
      } catch {
        throw new UnsupportedImageError(f.name);
      }
    }
    const encode = async (page: number, step: CompressStep): Promise<File> => {
      const bmp = bitmaps[page];
      const { width, height } = fitDimensions(bmp.width, bmp.height, step.maxSide);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new UnsupportedImageError(files[page].name);
      ctx.fillStyle = "#ffffff"; // PNGs with transparency would otherwise turn black
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bmp, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", step.quality));
      if (!blob) throw new UnsupportedImageError(files[page].name);
      return new File([blob], `page-${page + 1}.jpg`, { type: "image/jpeg" });
    };
    const r = await fitToBudget(files.length, encode, { onProgress });
    return r.ok ? { ok: true, files: r.items, total: r.total } : { ok: false, reason: "too-large", total: r.total };
  } finally {
    for (const b of bitmaps) b.close();
  }
}
