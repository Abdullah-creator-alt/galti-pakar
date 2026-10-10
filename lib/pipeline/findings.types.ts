import { z } from "zod";
import type { Band, DimensionScore, ExaminerResult, RubricKey } from "../types.ts";

/** Same keys as RubricKey in lib/types.ts, in display order. A compile-time check below keeps them in sync. */
export const RUBRIC_KEYS = ["thesis", "outline", "argument", "evidence", "counter-argument", "coherence", "language"] as const satisfies readonly RubricKey[];
type _AllKeysCovered = Exclude<RubricKey, (typeof RUBRIC_KEYS)[number]> extends never ? true : never;
const _keysCheck: _AllKeysCovered = true;
void _keysCheck;

/* ---------- inputs from earlier steps (every field optional) ---------- */

export type StructureLabel = "Position" | "Claim" | "Evidence" | "Counter-argument" | "Rebuttal" | "Conclusion";

export interface MeasuredFindings {
  structure?: { paragraphId: string; label: StructureLabel; summary?: string }[];
  links?: { claimParagraphId: string; evidenceParagraphId?: string; similarity: number; orphan: boolean }[];
  drift?: { paragraphId: string; relevance: number; drifts: boolean }[];
  genericness?: { paragraphId: string; avgGenericScore: number | null; generic: number; mixed: number; specific: number; unassessed: number }[];
  rules?: { wordCount: number; paragraphCount: number; clicheHits: number; missingIntro: boolean; missingConclusion: boolean };
  benchmark?: { missingPoints: string[]; profileGaps: string[] };
}

/* ---------- what the model returns for one run ---------- */

const dimensionSchema = z.object({
  score: z.number().finite(),
  reason: z.string().min(1),
  quotes: z.array(z.string()).max(4),
  absence: z.boolean(),
  disagreesWith: z.string().optional(),
});

export const runOutputSchema = z.object({
  dimensions: z.object(Object.fromEntries(RUBRIC_KEYS.map((k) => [k, dimensionSchema])) as Record<RubricKey, typeof dimensionSchema>),
});
export type RunOutput = z.infer<typeof runOutputSchema>;

/** Gemini responseSchema mirroring runOutputSchema. */
export const runOutputResponseSchema = {
  type: "OBJECT",
  properties: {
    dimensions: {
      type: "OBJECT",
      properties: Object.fromEntries(
        RUBRIC_KEYS.map((k) => [
          k,
          {
            type: "OBJECT",
            properties: {
              score: { type: "NUMBER" },
              reason: { type: "STRING" },
              quotes: { type: "ARRAY", items: { type: "STRING" } },
              absence: { type: "BOOLEAN" },
              disagreesWith: { type: "STRING" },
            },
            required: ["score", "reason", "quotes", "absence"],
          },
        ]),
      ),
      required: [...RUBRIC_KEYS],
    },
  },
  required: ["dimensions"],
};

/* ---------- verified output ---------- */

export interface VerifiedQuote {
  /** Exact text from the transcript, sliced by offsets (not the model's string). */
  text: string;
  paragraphId: string;
  start: number;
  end: number;
}

export type Confidence = "high" | "medium" | "low";

export interface RunDimension {
  key: RubricKey;
  score: number;
  band: Band;
  reason: string;
  absence: boolean;
  disagreesWith?: string;
  quotesProposed: number;
  verifiedQuotes: VerifiedQuote[];
  quotesRejected: number;
  /** Quotes were given (or required) but none could be verified. */
  unverified: boolean;
  /** Absence claim contradicted by measured findings; reason in conflictNote. */
  conflict: boolean;
  conflictNote?: string;
  confidence: Confidence;
}

export interface RunResult {
  index: number;
  dimensions: Record<RubricKey, RunDimension>;
  model: string;
}

export interface AggregatedDimension {
  key: RubricKey;
  label: string;
  medianScore: number;
  band: Band;
  scores: number[];
  runsAgree: boolean;
  reasons: string[];
  /** Where a run disagreed with a software measurement, with its explanation. */
  disagreements: string[];
  verifiedQuotes: VerifiedQuote[];
  flags: { unverified: boolean; conflict: boolean; runsDisagree: boolean };
  confidence: Confidence;
}

/** Named SecondOpinion because lib/types.ts already exports an ExaminerResult (one examiner row of the report). */
export interface SecondOpinion {
  runs: RunResult[];
  dimensions: AggregatedDimension[];
  /** Median score per dimension in the report's DimensionScore shape. The blend step decides final scores. */
  medianDimensions: DimensionScore[];
  /** One entry per run, in the shape of EssayReport.examiners. */
  examiners: ExaminerResult[];
  agreement: { agreedCount: number; total: number; disagreeingDimensions: RubricKey[] };
  quotesProposed: number;
  quotesVerified: number;
  quotesRejected: number;
  unverifiedDimensions: RubricKey[];
  conflicts: { key: RubricKey; note: string }[];
  warnings: string[];
  elapsedMs: number;
}
