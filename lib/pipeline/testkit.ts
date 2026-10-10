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

/* ---------- end-to-end pipeline fakes (no network, no key) ---------- */

import { analyzeEssayStructure } from "../structure/index.ts";
import { ESSAY_A, ESSAY_A_SPECS, mockComplete } from "../structure/testkit.ts";
import type { GenerateOptions } from "../gemini.ts";
import { coachEssay } from "./coach.ts";
import { FIXES_SYSTEM, REWRITE_SYSTEM } from "./coachPrompt.ts";
import { scoreExaminers } from "./examiner.ts";
import { RUBRIC_KEYS } from "./findings.types.ts";
import type { PipelineDeps } from "./orchestrate.ts";

/** Deterministic 768-d unit vector from text, so fake embeddings match the real data files' dimension. */
export function fakeVec(text: string, dim = 768): number[] {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  const v: number[] = [];
  for (let i = 0; i < dim; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) + i;
    v.push(((h >>> 0) % 2001) / 1000 - 1);
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
}

export const fakeExamineGenerate = async (_o: GenerateOptions): Promise<string> =>
  JSON.stringify({
    dimensions: Object.fromEntries(
      RUBRIC_KEYS.map((k) => [k, { score: 6.5, reason: `The ${k} is adequate.`, quotes: ["Education is the foundation of national progress"], absence: false }]),
    ),
  });

export const fakeCoachGenerate = async (o: GenerateOptions): Promise<string> => {
  if (o.system === FIXES_SYSTEM) {
    const keys = [...o.prompt.matchAll(/^\[((?:issue|dimension|benchmark):[^\]]+)\]$/gm)].map((m) => m[1]);
    return JSON.stringify({ fixes: keys.map((k) => ({ issueKey: k, title: "Strengthen this point", body: "Examiners want more here. Add one concrete example to your own sentence.", evidenceQuote: "" })) });
  }
  if (o.system === REWRITE_SYSTEM) {
    const text = o.prompt.slice(o.prompt.indexOf("<paragraph>\n") + 12, o.prompt.indexOf("\n</paragraph>"));
    return JSON.stringify({ improved: text.replace(/(\w{6,})/, "$1 indeed"), changeNotes: [{ what: "Added one word.", why: "Test rewrite." }] });
  }
  throw new Error("unexpected system prompt");
};

/** Every injectable step replaced by an offline fake; the real measuring, blend and assembly code still runs. */
export function happyDeps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  const essay = essayFrom(ESSAY_A);
  return {
    skipKeyCheck: true,
    prepare: async () => [{ pageNumber: 1, mimeType: "image/jpeg", data: "AAAA" }],
    read: async () => structuredClone(essay),
    embedBase: async (texts) => texts.map((t) => fakeVec(t)),
    structure: (input) => analyzeEssayStructure(input, { complete: mockComplete(ESSAY_A_SPECS) }),
    examine: (e, t, f, o) => scoreExaminers(e, t, f, { ...o, generate: fakeExamineGenerate }),
    coach: (e, t, a, o) => coachEssay(e, t, a, { ...o, generate: fakeCoachGenerate }),
    now: () => new Date("2026-10-10T12:00:00.000Z"),
    newId: () => "TESTID123456",
    ...over,
  };
}

export const IMAGES = [{ data: new Uint8Array([1, 2, 3]), name: "page-1.jpg" }];
