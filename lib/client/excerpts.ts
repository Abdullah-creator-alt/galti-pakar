import type { PassageRef } from "../types.extras.ts";
import type { EssayReport } from "../types.ts";

/** The exact text a passage reference points at, or null when the paragraph is missing or the offsets are out of range. */
export function sliceRef(report: Pick<EssayReport, "paragraphs">, ref: PassageRef): string | null {
  const p = report.paragraphs.find((x) => x.id === ref.paragraphId);
  if (!p) return null;
  const { start, end } = ref;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > p.text.length) return null;
  const text = p.text.slice(start, end).trim();
  return text || null;
}

export interface Excerpt {
  short: string;
  full: string;
  truncated: boolean;
}

/** At most `maxWords` words, with an ellipsis when cut. The full text stays available for expansion. */
export function excerptOf(report: Pick<EssayReport, "paragraphs">, ref: PassageRef, maxWords = 20): Excerpt | null {
  const full = sliceRef(report, ref);
  if (full === null) return null;
  const words = full.split(/\s+/);
  return words.length <= maxWords ? { short: full, full, truncated: false } : { short: `${words.slice(0, maxWords).join(" ")}...`, full, truncated: true };
}
