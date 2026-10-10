/** Test helpers for pipeline tests. */
import type { TranscribedEssay } from "./transcribe.types.ts";

/** Builds a transcript from paragraphs separated by blank lines. */
export function essayFrom(text: string, ids?: string[]): TranscribedEssay {
  const parts = text.split("\n\n");
  return {
    outline: [],
    paragraphs: parts.map((t, i) => ({ id: ids?.[i] ?? `p${i + 1}`, kind: i === 0 ? "intro" : i === parts.length - 1 ? "conclusion" : "body", text: t, pageIndex: 0 })),
    uncertain: [],
    legibility: "good",
    wordCount: text.split(/\s+/).length,
    warnings: [],
  };
}
