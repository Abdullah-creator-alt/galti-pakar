/**
 * Contract for the data that travels WITH an EssayReport but is not part of it: the trace behind each highlight, the
 * claim-to-evidence map, conflicts, verification numbers, transcription notes, rewrite extras, the benchmark and warnings.
 * The backend conforms to these types exactly. Every field is optional, and ALL of it is treated as untrusted data:
 * it is validated on read, whatever fails is dropped, and nothing here ever throws.
 */
import { z } from "zod";
import { reportSchema } from "./pipeline/schema.ts";
import type { EssayReport } from "./types.ts";

/* ---------- types ---------- */

/** Paragraph-relative offsets, the same as HighlightSpan: "p3:120-198". */
export type SpanKey = `${string}:${number}-${number}`;

export interface PassageRef {
  paragraphId: string;
  start: number;
  end: number;
}

export type TraceStage = "read" | "label" | "link" | "rule" | "verify";
export interface TraceStep {
  stage: TraceStage;
  text: string;
}

export interface SpanTrace {
  ruleId: string;
  steps: TraceStep[];
  similarity?: number;
  threshold?: number;
  linked?: PassageRef;
}

export type LinkStrength = "strong" | "weak" | "orphan" | "unrebutted";
export interface ClaimLink {
  id: string;
  kind: "claim" | "counterclaim";
  claim: PassageRef;
  evidence?: PassageRef;
  similarity?: number;
  strength: LinkStrength;
}

export interface ClaimMap {
  links: ClaimLink[];
  summary: { claimsTotal: number; strong: number; weak: number; orphan: number; unrebutted: number };
}

export interface ExtraConflict {
  id: string;
  dimension: string;
  examinerSays: string;
  measuredSays: string;
}

export interface VerificationInfo {
  spansProposed?: number;
  spansDropped?: number;
  quotesProposed?: number;
  quotesVerified?: number;
  quotesRejected?: number;
  conflictsFound?: number;
  examinerAgreementRate?: number;
  labelAgreementRate?: number;
}

export interface TranscriptionInfo {
  legibility: "good" | "fair" | "poor";
  uncertain: { paragraphId: string; word: string; guess: string }[];
}

export interface RewriteExtras {
  changeNotes: { what: string; why: string }[];
  placeholders: string[];
}

/** A further weak paragraph with its own model version. The main one stays in report.rewrite. */
export interface MoreRewrite {
  paragraphId: string;
  original: string;
  improved: string;
  removed?: string[];
  added?: string[];
  changeNotes: { what: string; why: string }[];
  placeholders: string[];
}

export interface BenchmarkInfo {
  status: "ok" | "partial" | "unavailable";
  themeLabel?: string;
  nReferences?: number;
  coverage?: {
    covered: number;
    total: number;
    basis: "reference" | "mixed" | "llm-checklist";
    missing: { point: string; madeByCount: number | null; ofN: number | null }[];
  };
  profile?: {
    label: string;
    value: number;
    refQ1: number;
    refQ3: number;
    position: "below" | "within" | "above";
    betterDirection: "higher" | "lower";
  }[];
  disclaimers: string[];
}

export interface ReportExtras {
  trace?: Record<SpanKey, SpanTrace>;
  claimMap?: ClaimMap;
  conflicts?: ExtraConflict[];
  verification?: VerificationInfo;
  transcription?: TranscriptionInfo;
  rewriteExtras?: RewriteExtras;
  /** Model versions of other weak paragraphs, weakest first. */
  moreRewrites?: MoreRewrite[];
  benchmark?: BenchmarkInfo;
  warnings?: string[];
}

export interface AnalysisBundle {
  report: EssayReport;
  extras?: ReportExtras;
}

/* ---------- helpers ---------- */

export const spanKey = (paragraphId: string, start: number, end: number): SpanKey => `${paragraphId}:${start}-${end}`;

const KEY_RE = /^(.+):(\d+)-(\d+)$/;
export function parseSpanKey(key: string): PassageRef | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const start = Number(m[2]);
  const end = Number(m[3]);
  return end > start ? { paragraphId: m[1], start, end } : null;
}

/* ---------- lenient schemas ---------- */

const MAX_TEXT = 600;
const str = z.string().transform((s) => s.slice(0, MAX_TEXT));
const num = z.number().finite();
const count = z.number().finite().min(0);

/** An array whose invalid items are dropped one by one. Not an array at all -> the field fails (and is dropped by .catch). */
function lenientArray<T>(item: z.ZodType<T>, max = 200) {
  return z.array(z.unknown()).transform((arr) => arr.slice(0, max).flatMap((x) => {
    const r = item.safeParse(x);
    return r.success ? [r.data] : [];
  }));
}

const passage = z.object({ paragraphId: z.string().min(1), start: z.number().int().min(0), end: z.number().int().min(1) }).refine((p) => p.end > p.start);

const traceStep = z.object({ stage: z.enum(["read", "label", "link", "rule", "verify"]), text: str });
const spanTrace = z.object({
  ruleId: str,
  steps: lenientArray(traceStep, 12).catch([]),
  similarity: num.optional().catch(undefined),
  threshold: num.optional().catch(undefined),
  linked: passage.optional().catch(undefined),
});

const traceMap = z.record(z.string(), z.unknown()).transform((rec) => {
  const out: Record<string, SpanTrace> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (!parseSpanKey(k)) continue;
    const r = spanTrace.safeParse(v);
    if (r.success) out[k] = r.data;
  }
  return out as Record<SpanKey, SpanTrace>;
});

const claimLink = z.object({
  id: str,
  kind: z.enum(["claim", "counterclaim"]),
  claim: passage,
  evidence: passage.optional().catch(undefined),
  similarity: num.optional().catch(undefined),
  strength: z.enum(["strong", "weak", "orphan", "unrebutted"]),
});

const claimMap = z.object({ links: lenientArray(claimLink, 100), summary: z.unknown().optional() }).transform((m): ClaimMap => {
  const s = z.object({ claimsTotal: count, strong: count, weak: count, orphan: count, unrebutted: count }).safeParse(m.summary);
  // A missing or malformed summary is recomputed from the links that did validate.
  const claims = m.links.filter((l) => l.kind === "claim");
  const derived = {
    claimsTotal: claims.length,
    strong: claims.filter((l) => l.strength === "strong").length,
    weak: claims.filter((l) => l.strength === "weak").length,
    orphan: claims.filter((l) => l.strength === "orphan").length,
    unrebutted: m.links.filter((l) => l.strength === "unrebutted").length,
  };
  return { links: m.links, summary: s.success ? s.data : derived };
});

const conflict = z.object({ id: str, dimension: str, examinerSays: str, measuredSays: str });

const verification = z.object({
  spansProposed: count.optional().catch(undefined),
  spansDropped: count.optional().catch(undefined),
  quotesProposed: count.optional().catch(undefined),
  quotesVerified: count.optional().catch(undefined),
  quotesRejected: count.optional().catch(undefined),
  conflictsFound: count.optional().catch(undefined),
  examinerAgreementRate: num.min(0).max(1).optional().catch(undefined),
  labelAgreementRate: num.min(0).max(1).optional().catch(undefined),
});

const transcription = z.object({
  legibility: z.enum(["good", "fair", "poor"]),
  uncertain: lenientArray(z.object({ paragraphId: z.string().min(1), word: str, guess: str }), 100).catch([]),
});

const rewriteExtras = z.object({
  changeNotes: lenientArray(z.object({ what: str, why: str }), 6).catch([]),
  placeholders: lenientArray(str, 10).catch([]),
});

const moreRewrite = z
  .object({
    paragraphId: z.string().min(1),
    original: str,
    improved: str,
    removed: z.array(str).optional().catch(undefined),
    added: z.array(str).optional().catch(undefined),
    changeNotes: lenientArray(z.object({ what: str, why: str }), 6).catch([]),
    placeholders: lenientArray(str, 10).catch([]),
  })
  // The same rule as the report's rewrite: highlighted phrases must really be in the text, and there must be a change to show.
  .refine((r) => r.original.length > 0 && r.improved.length > 0 && r.original.trim() !== r.improved.trim(), { message: "nothing to compare" })
  .refine((r) => (r.removed ?? []).every((x) => r.original.includes(x)) && (r.added ?? []).every((x) => r.improved.includes(x)), { message: "phrase not in text" });

const benchmark = z.object({
  status: z.enum(["ok", "partial", "unavailable"]),
  themeLabel: str.optional().catch(undefined),
  nReferences: count.optional().catch(undefined),
  coverage: z
    .object({
      covered: count,
      total: count,
      basis: z.enum(["reference", "mixed", "llm-checklist"]),
      missing: lenientArray(z.object({ point: str, madeByCount: count.nullable().catch(null), ofN: count.nullable().catch(null) }), 20).catch([]),
    })
    .optional()
    .catch(undefined),
  profile: lenientArray(
    z.object({ label: str, value: num, refQ1: num, refQ3: num, position: z.enum(["below", "within", "above"]), betterDirection: z.enum(["higher", "lower"]) }),
    12,
  )
    .optional()
    .catch(undefined),
  disclaimers: lenientArray(str, 10).catch([]),
});

const extrasObject = z.object({
  trace: traceMap.optional().catch(undefined),
  claimMap: claimMap.optional().catch(undefined),
  conflicts: lenientArray(conflict, 20).optional().catch(undefined),
  verification: verification.optional().catch(undefined),
  transcription: transcription.optional().catch(undefined),
  rewriteExtras: rewriteExtras.optional().catch(undefined),
  moreRewrites: lenientArray(moreRewrite, 2).optional().catch(undefined),
  benchmark: benchmark.optional().catch(undefined),
  warnings: lenientArray(str, 20).optional().catch(undefined),
});

/** Never throws. Anything that is not a valid object yields {}; each invalid field or item is dropped. */
export function parseExtras(input: unknown): ReportExtras {
  const r = extrasObject.safeParse(input);
  if (!r.success) return {};
  const out: ReportExtras = {};
  for (const [k, v] of Object.entries(r.data)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** A zod schema for ReportExtras that always succeeds (invalid parts are dropped). */
export const reportExtrasSchema = z.unknown().transform((v): ReportExtras => parseExtras(v));

/** Strict on the report, lenient on the extras. */
export const analysisBundleSchema = z.object({ report: reportSchema, extras: reportExtrasSchema.optional() });

export type BundleResult = { ok: true; bundle: AnalysisBundle } | { ok: false; error: string };

export function parseBundle(input: unknown): BundleResult {
  if (!input || typeof input !== "object") return { ok: false, error: "not an object" };
  const r = analysisBundleSchema.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "invalid report" };
  const extras = r.data.extras && Object.keys(r.data.extras).length ? r.data.extras : undefined;
  return { ok: true, bundle: { report: r.data.report, ...(extras ? { extras } : {}) } };
}
