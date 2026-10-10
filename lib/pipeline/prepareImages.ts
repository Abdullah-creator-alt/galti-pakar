import sharp from "sharp";
import { ApiError } from "./validate.ts";
import type { PageImage } from "./steps.ts";

export interface UploadedImage {
  data: Uint8Array;
  name?: string;
}

/** Gemini inline requests are capped near 20 MB total; stay well under, counting base64 growth. */
export const MAX_BASE64_BYTES = 14 * 1024 * 1024;

/** Quality ladder: tried in order until the whole set fits the budget. */
const LADDER = [
  { side: 2000, quality: 85 },
  { side: 1600, quality: 80 },
  { side: 1280, quality: 75 },
  { side: 1024, quality: 70 },
] as const;

async function encode(img: UploadedImage, side: number, quality: number): Promise<Buffer> {
  return sharp(img.data)
    .rotate() // apply EXIF orientation, then drop it
    .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
}

/** Orients, downsizes and re-encodes pages as JPEG, keeping order. Shrinks further instead of failing. */
export async function prepareImages(images: UploadedImage[], opts: { maxBase64Bytes?: number } = {}): Promise<PageImage[]> {
  const budget = opts.maxBase64Bytes ?? MAX_BASE64_BYTES;
  if (images.length === 0) throw new ApiError(400, "Add at least one photo of your essay.");

  for (const step of LADDER) {
    const buffers: Buffer[] = [];
    for (let i = 0; i < images.length; i++) {
      try {
        buffers.push(await encode(images[i], step.side, step.quality));
      } catch {
        const label = images[i].name ? `"${images[i].name}"` : `Page ${i + 1}`;
        throw new ApiError(422, `${label} could not be opened. Retake it, or save it as a JPEG or PNG and try again.`);
      }
    }
    const base64Total = buffers.reduce((n, b) => n + Math.ceil((b.length * 4) / 3), 0);
    if (base64Total <= budget) {
      return buffers.map((b, i) => ({ pageNumber: i + 1, mimeType: "image/jpeg", data: b.toString("base64") }));
    }
  }
  throw new ApiError(413, "These photos are too large to analyse together even after shrinking them. Try fewer pages per upload.");
}
