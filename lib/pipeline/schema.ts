import { z } from "zod";
import type { EssayReport, HistoryItem } from "../types.ts";

export const bandSchema = z.enum(["competitive", "borderline", "below-pass"]);
export const toneSchema = z.enum(["strong", "weak", "offtopic"]);
export const roleSchema = z.enum(["position", "claim", "evidence", "counter-argument", "conclusion"]);
export const rubricKeySchema = z.enum(["thesis", "outline", "argument", "evidence", "counter-argument", "coherence", "language"]);

export const dimensionSchema = z.object({
  key: rubricKeySchema,
  label: z.string().min(1),
  score: z.number().min(0),
  outOf: z.number().positive(),
  band: bandSchema,
  note: z.string().optional(),
});

const spanSchema = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    tone: toneSchema,
    reason: z.string().min(1),
  })
  .refine((s) => s.end > s.start, { message: "span end must be after start" });

export const paragraphSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    role: roleSchema,
    relevance: z.number().min(0).max(100),
    summary: z.string(),
    spans: z.array(spanSchema),
  })
  .refine((p) => p.spans.every((s) => s.end <= p.text.length), { message: "span offsets must lie inside the paragraph text" });

export const fixSchema = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: z.string().min(1),
  body: z.string().min(1),
  paragraphId: z.string().optional(),
});

export const rewriteSchema = z
  .object({
    paragraphId: z.string().min(1),
    original: z.string().min(1),
    improved: z.string().min(1),
    removed: z.array(z.string()).optional(),
    added: z.array(z.string()).optional(),
  })
  .refine((r) => (r.removed ?? []).every((x) => r.original.includes(x)), { message: "every removed phrase must be an exact substring of the original" })
  .refine((r) => (r.added ?? []).every((x) => r.improved.includes(x)), { message: "every added phrase must be an exact substring of the improved text" });

export const examinerSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  overall: z.number().min(0),
  band: bandSchema,
  dimensions: z.record(rubricKeySchema, bandSchema).refine((d) => rubricKeySchema.options.every((k) => k in d), {
    message: "dimensions must include all seven rubric keys",
  }),
});

export const reportSchema = z
  .object({
    id: z.string().min(1),
    topic: z.string().min(1),
    analysedAt: z.iso.datetime(),
    wordCount: z.number().int().min(0),
    pageCount: z.number().int().min(1),
    overallScore: z.number().min(0),
    overallOutOf: z.number().positive(),
    verdict: bandSchema,
    dimensions: z.array(dimensionSchema).length(7),
    paragraphs: z.array(paragraphSchema).min(1),
    driftThreshold: z.number().min(0).max(100),
    fixes: z.array(fixSchema).length(3),
    rewrite: rewriteSchema,
    // Zero is allowed: when the AI examiner is unavailable the report is scored from the measurements alone.
    examiners: z.array(examinerSchema).max(5),
    isExample: z.boolean(),
  })
  .refine((r) => r.paragraphs.some((p) => p.id === r.rewrite.paragraphId), { message: "rewrite.paragraphId must match a paragraph" })
  .refine((r) => r.fixes.every((f) => !f.paragraphId || r.paragraphs.some((p) => p.id === f.paragraphId)), {
    message: "fix.paragraphId must match a paragraph",
  });

export const historyItemSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  analysedAt: z.iso.datetime(),
  overallScore: z.number().min(0),
  overallOutOf: z.number().positive(),
  verdict: bandSchema,
  isExample: z.boolean(),
});

/* Compile-time check that the schemas and the UI types in lib/types.ts agree in both directions. */
type Equal<A, B> = A extends B ? (B extends A ? true : never) : never;
const _report: Equal<z.infer<typeof reportSchema>, EssayReport> = true;
const _history: Equal<z.infer<typeof historyItemSchema>, HistoryItem> = true;
void _report;
void _history;

export function parseReport(input: unknown): EssayReport {
  return reportSchema.parse(input);
}

/**
 * The part of the report produced by the blend step (everything except id, analysedAt, pageCount, isExample,
 * fixes and rewrite). `examiners` may be empty here because the examiner step can be missing; the full
 * reportSchema still requires at least one before a report is shown.
 */
export const reportPartsSchema = z
  .object({
    topic: z.string().min(1),
    wordCount: z.number().int().min(0),
    overallScore: z.number().min(0),
    overallOutOf: z.number().positive(),
    verdict: bandSchema,
    dimensions: z.array(dimensionSchema).length(7),
    paragraphs: z.array(paragraphSchema).min(1),
    driftThreshold: z.number().min(0).max(100),
    examiners: z.array(examinerSchema).max(5),
  });

type Parts = Pick<EssayReport, "topic" | "wordCount" | "overallScore" | "overallOutOf" | "verdict" | "dimensions" | "paragraphs" | "driftThreshold" | "examiners">;
const _parts: Equal<z.infer<typeof reportPartsSchema>, Parts> = true;
void _parts;
