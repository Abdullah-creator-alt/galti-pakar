/**
 * Step 7: assemble { report, extras } from the outputs of the earlier steps. Pure code, no model calls.
 * The report is validated with the report schema (an invalid report throws). Extras follow the UI's contract in
 * lib/types.extras.ts and are validated defensively: anything that does not check out is dropped with a warning.
 */
import { randomBytes } from "node:crypto";
import type { Fix, Rewrite } from "../types.ts";
import type { EssayReport } from "../types.ts";
import { spanKey, parseExtras, type ClaimLink as ExtraLink, type PassageRef, type ReportExtras, type SpanTrace, type TraceStage, type TraceStep } from "../types.extras.ts";
import type { BenchmarkResult } from "./benchmark.types.ts";
import type { BlendedAnalysis, SentenceRef, TraceEntry } from "./blend.types.ts";
import { essayWordCount } from "./adapters.ts";
import { reportSchema } from "./schema.ts";
import type { TranscribedEssay } from "./transcribe.types.ts";

export class AssemblyError extends Error {}

export interface AssembleInput {
  id: string;
  now: Date;
  topic: string;
  pageCount: number;
  essay: TranscribedEssay;
  sentences: SentenceRef[];
  blend: BlendedAnalysis;
  fixes: Fix[];
  rewrite: Rewrite;
  rewriteExtras?: { changeNotes: { what: string; why: string }[]; placeholders: string[] };
  /** Other weak paragraphs with their own model version (see coach.ts). Checked against the essay here. */
  moreRewrites?: { rewrite: Rewrite; changeNotes: { what: string; why: string }[]; placeholders: string[] }[];
  benchmark?: BenchmarkResult;
  /** Plain-language notes about stages that were degraded or skipped. */
  warnings: string[];
}

/** URL-safe random id of 11 characters. */
export const newReportId = (): string => randomBytes(8).toString("base64url");

const MAX_WARNINGS = 20;

/** The plain-language wording for each degradation. The orchestrator uses the same constants, so duplicates collapse. */
export const WARN = {
  structure: "Structure labels were unavailable, so the argument map and some scores are limited.",
  analysis: "Topic-drift and genericness analysis was unavailable for this essay.",
  benchmark: "The top-essay comparison was unavailable.",
  linking: "Claim-to-evidence linking was skipped because the sentence comparison was unavailable.",
  examiner: "The AI examiner's opinion was unavailable; scores use the measurements only.",
  relevance: "Topic relevance could not be measured, so every paragraph is shown as on topic and the drift chart is not meaningful.",
} as const;

/** Blend's own notes are technical; map the ones that describe a degraded input to the plain wording above. */
const PLAIN_BLEND: [RegExp, string][] = [
  [/^structure labels unavailable/i, WARN.structure],
  [/^drift and genericness unavailable/i, WARN.analysis],
  [/^embeddings unavailable/i, WARN.linking],
  [/^sentence vectors unavailable/i, WARN.linking],
  [/^examiner second opinion unavailable/i, WARN.examiner],
  [/^relevance unavailable/i, WARN.relevance],
];
export const plainWarning = (w: string): string => PLAIN_BLEND.find(([re]) => re.test(w))?.[1] ?? w;
const cap = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/* ---------- trace ---------- */

function stageOf(step: string): TraceStage {
  if (/^read\b/i.test(step)) return "read";
  if (/^labelled\b/i.test(step)) return "label";
  if (/^(linked to|no evidence link|answered by|no rebuttal)/i.test(step)) return "link";
  return "rule";
}
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One plain sentence per rule, filled with the real numbers where the rule has them. */
function ruleText(ruleId: string, t: TraceEntry["inputs"]): string {
  const n = (x: number | undefined) => (x === undefined ? "" : x.toFixed(2));
  switch (ruleId) {
    case "orphan_claim":
      return `A claim with no evidence match of at least ${n(t.thresholds.linkWeak)} counts as having no linked evidence (best match ${n(t.similarity)}).`;
    case "weak_link_claim":
      return `A match between ${n(t.thresholds.linkWeak)} and ${n(t.thresholds.linkStrong)} is a weak link, not a supported claim (this one scored ${n(t.similarity)}).`;
    case "strong_link_claim":
    case "strong_link_evidence":
      return `A match of at least ${n(t.thresholds.linkStrong)} in an on-topic paragraph counts as supported (this one scored ${n(t.similarity)}).`;
    case "unrebutted_counterclaim":
      return "An opposing view needs an answer within the next few sentences or in the next paragraph. None was found.";
    case "off_topic_paragraph":
      return `A paragraph scoring below ${t.thresholds.driftThreshold} for relevance to the topic counts as drifting${t.relevance !== null && t.relevance !== undefined ? ` (this one scored ${Math.round(t.relevance)})` : ""}.`;
    case "generic_sentence":
    case "generic_evidence":
      return "Wording close to known filler, with no names, figures or places, counts as generic.";
    case "specific_evidence":
      return "Evidence with specific detail counts as specific.";
    default:
      return `Rule applied: ${ruleId}.`;
  }
}

const LINK_RULES = new Set(["orphan_claim", "weak_link_claim", "strong_link_claim", "strong_link_evidence"]);

function toTrace(entry: TraceEntry, refs: Map<string, SentenceRef>): { key: ReturnType<typeof spanKey>; trace: SpanTrace } {
  const steps: TraceStep[] = [];
  for (const raw of entry.chain) {
    if (/^rule fired/i.test(raw)) continue; // replaced by the plain rule sentences below
    steps.push({ stage: stageOf(raw), text: cap(sentence(raw)) });
  }
  for (const r of entry.ruleIds) steps.push({ stage: "rule", text: cap(ruleText(r, entry.inputs)) });
  steps.push({ stage: "verify", text: entry.sentenceIds.length > 1 ? "Checked: this passage is at this exact place in your essay." : "Checked: these words are at this exact place in your essay." });

  const linkedRef = entry.inputs.linkedSentenceId ? refs.get(entry.inputs.linkedSentenceId) : undefined;
  const linked: PassageRef | undefined = linkedRef ? { paragraphId: linkedRef.paragraphId, start: linkedRef.start, end: linkedRef.end } : undefined;
  const isLink = entry.ruleIds.some((r) => LINK_RULES.has(r));
  // An orphan claim needs a match above the weak threshold to count as linked at all; weaker links need the strong one.
  const threshold = !isLink ? undefined : entry.ruleIds.includes("orphan_claim") ? entry.inputs.thresholds.linkWeak : entry.inputs.thresholds.linkStrong;
  return {
    key: spanKey(entry.paragraphId, entry.start, entry.end),
    trace: {
      ruleId: entry.ruleIds.join("+"),
      steps,
      ...(isLink && entry.inputs.similarity !== undefined ? { similarity: entry.inputs.similarity } : {}),
      ...(threshold !== undefined && entry.inputs.similarity !== undefined ? { threshold } : {}),
      ...(linked ? { linked } : {}),
    },
  };
}

const inRange = (r: PassageRef, essay: Pick<TranscribedEssay, "paragraphs">) => {
  const p = essay.paragraphs.find((x) => x.id === r.paragraphId);
  return !!p && Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end > r.start && r.end <= p.text.length;
};

/* ---------- extras ---------- */

function buildExtras(i: AssembleInput, report: EssayReport): { extras: ReportExtras; warnings: string[] } {
  const { blend, essay } = i;
  const refs = new Map(i.sentences.map((s) => [s.id, s]));
  const spanKeys = new Set(report.paragraphs.flatMap((p) => p.spans.map((s) => spanKey(p.id, s.start, s.end))));
  const refOf = (id: string | null | undefined): PassageRef | undefined => {
    const r = id ? refs.get(id) : undefined;
    return r ? { paragraphId: r.paragraphId, start: r.start, end: r.end } : undefined;
  };

  // Trace: only entries for spans that exist in the report.
  const trace: Record<string, SpanTrace> = {};
  for (const e of blend.trace) {
    const t = toTrace(e, refs);
    if (spanKeys.has(t.key)) trace[t.key] = t.trace;
  }

  const droppedNotes: string[] = [];

  // Claim map: needs the X-Ray (sentence vectors were available). Position sentences are not claims here.
  let claimMap: ReportExtras["claimMap"];
  if (blend.xray) {
    const links: ExtraLink[] = [];
    for (const l of blend.links) {
      if (l.claimLabel !== "Claim") continue;
      const claim = refOf(l.claimSentenceId);
      if (!claim) continue;
      const evidence = refOf(l.evidenceSentenceId);
      links.push({ id: `l${links.length + 1}`, kind: "claim", claim, ...(evidence ? { evidence } : {}), similarity: l.similarity, strength: l.strength });
    }
    for (const c of blend.counters) {
      const claim = refOf(c.counterSentenceId);
      if (!claim) continue;
      const answer = refOf(c.rebuttalSentenceId);
      links.push({ id: `l${links.length + 1}`, kind: "counterclaim", claim, ...(answer ? { evidence: answer } : {}), strength: c.status === "rebutted" ? "strong" : "unrebutted" });
    }
    const valid = links.filter((l) => inRange(l.claim, essay) && (!l.evidence || inRange(l.evidence, essay)));
    if (valid.length < links.length) droppedNotes.push(`${links.length - valid.length} argument-map row(s) were left out because they did not match your essay text.`);
    const x = blend.xray;
    claimMap = { links: valid, summary: { claimsTotal: x.claimsTotal, strong: x.claimsStrong, weak: x.claimsWeak, orphan: x.claimsOrphan, unrebutted: x.unrebuttedCount } };
  }

  const m = blend.metrics;
  const b = i.benchmark;
  const benchmark: ReportExtras["benchmark"] =
    b && b.status !== "unavailable"
      ? {
          status: b.status,
          ...(b.theme ? { themeLabel: b.theme.label } : {}),
          ...(b.coverage ? { nReferences: b.coverage.nReferences } : {}),
          ...(b.coverage ? { coverage: { covered: b.coverage.covered, total: b.coverage.total, basis: b.coverage.basis, missing: b.coverage.missing.map((p) => ({ point: p.point, madeByCount: p.madeByCount, ofN: p.ofN })) } } : {}),
          ...(b.profile.length
            ? {
                profile: b.profile
                  .filter((p) => p.betterDirection !== "neutral") // the UI's contract only has higher or lower
                  .map((p) => ({ label: p.label, value: p.value, refQ1: p.refQ1, refQ3: p.refQ3, position: p.position, betterDirection: p.betterDirection as "higher" | "lower" })),
              }
            : {}),
          disclaimers: b.disclaimers,
        }
      : undefined;

  // Warnings: stage notes first, then each step's own notes. Plain language, deduplicated.
  const warnings = [...new Set([...i.warnings, ...blend.warnings.map(plainWarning), ...droppedNotes].map((w) => cap(w)))].slice(0, MAX_WARNINGS);

  // A further rewrite is kept only if its paragraph exists, is not the main one, and its "original" is that paragraph's text.
  const moreRewrites = (i.moreRewrites ?? [])
    .filter((m) => m.rewrite.paragraphId !== i.rewrite.paragraphId && essay.paragraphs.some((p) => p.id === m.rewrite.paragraphId && p.text === m.rewrite.original))
    .map((m) => ({ paragraphId: m.rewrite.paragraphId, original: m.rewrite.original, improved: m.rewrite.improved, ...(m.rewrite.removed ? { removed: m.rewrite.removed } : {}), ...(m.rewrite.added ? { added: m.rewrite.added } : {}), changeNotes: m.changeNotes, placeholders: m.placeholders }));

  const extras: ReportExtras = {
    ...(Object.keys(trace).length ? { trace: trace as ReportExtras["trace"] } : {}),
    ...(claimMap ? { claimMap } : {}),
    conflicts: blend.conflicts.map((c) => ({ id: c.id, dimension: c.dimension ?? "overall", examinerSays: c.examinerSays, measuredSays: c.measuredSays })),
    verification: {
      spansProposed: m.spansProposed,
      spansDropped: m.spansDropped,
      quotesProposed: m.quotesProposed,
      quotesVerified: m.quotesVerified,
      quotesRejected: m.quotesRejected + m.quotesRecheckFailed,
      conflictsFound: blend.conflicts.length,
      ...(m.examinerAgreementRate !== undefined ? { examinerAgreementRate: m.examinerAgreementRate } : {}),
      ...(m.labelAgreementRate !== undefined ? { labelAgreementRate: m.labelAgreementRate } : {}),
    },
    transcription: {
      legibility: essay.legibility,
      uncertain: essay.uncertain.map((u) => ({ paragraphId: u.paragraphId, word: u.word, guess: u.guess })),
    },
    ...(i.rewriteExtras ? { rewriteExtras: { changeNotes: i.rewriteExtras.changeNotes, placeholders: i.rewriteExtras.placeholders } } : {}),
    ...(moreRewrites.length ? { moreRewrites } : {}),
    ...(benchmark ? { benchmark } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
  return { extras, warnings };
}

/**
 * Builds the final bundle. Throws AssemblyError if the report does not pass the report schema. Extras that fail
 * validation are dropped and a warning is added.
 */
export function assembleBundle(i: AssembleInput): { report: EssayReport; extras: ReportExtras } {
  const b = i.blend.reportParts;
  const candidate: EssayReport = {
    id: i.id,
    topic: i.topic,
    analysedAt: i.now.toISOString(),
    wordCount: essayWordCount(i.essay),
    pageCount: Math.max(1, i.pageCount),
    overallScore: b.overallScore,
    overallOutOf: b.overallOutOf,
    verdict: b.verdict,
    dimensions: b.dimensions,
    paragraphs: b.paragraphs,
    driftThreshold: b.driftThreshold,
    fixes: i.fixes,
    rewrite: i.rewrite,
    examiners: b.examiners,
    isExample: false,
  };
  const parsed = reportSchema.safeParse(candidate);
  if (!parsed.success) throw new AssemblyError(`The assembled report did not pass validation: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`.trim());
  const report = parsed.data;

  const built = buildExtras(i, report);
  const checked = parseExtras(built.extras);
  // Anything the validator dropped is reported rather than silently lost.
  const lost: string[] = [];
  for (const k of Object.keys(built.extras) as (keyof ReportExtras)[]) if (!(k in checked)) lost.push(String(k));
  if ((checked.trace ? Object.keys(checked.trace).length : 0) < (built.extras.trace ? Object.keys(built.extras.trace).length : 0)) lost.push("some highlight details");
  if ((checked.claimMap?.links.length ?? 0) < (built.extras.claimMap?.links.length ?? 0)) lost.push("some argument-map rows");
  if (lost.length) checked.warnings = [...(checked.warnings ?? []), `Some extra details (${lost.join(", ")}) did not pass checks and were left out.`].slice(0, MAX_WARNINGS);
  return { report, extras: checked };
}
