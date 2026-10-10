/**
 * Fixes + model paragraphs. CODE decides which problems matter and which paragraphs are rewritten (the weakest, plus up to
 * COACH.MAX_REWRITES - 1 others that have measured problems); the LLM only explains each chosen problem and rewrites each
 * chosen paragraph as a teaching model. Everything it writes is verified in code. It never rewrites the whole essay.
 */
import { COACH, COACH_TEMPERATURE, GEMINI_COACH_FALLBACKS, GEMINI_COACH_MODEL } from "../config.ts";
import { GeminiError, generateText, type GenerateOptions } from "../gemini.ts";
import type { Fix, Rewrite } from "../types.ts";
import type { BenchmarkResult } from "./benchmark.types.ts";
import type { BlendedAnalysis } from "./blend.types.ts";
import { buildFixesPrompt, buildRewritePrompt, FIXES_SYSTEM, ISSUE_DESCRIPTION, REWRITE_SYSTEM, inspirationFor, type RewritePlan } from "./coachPrompt.ts";
import { templateFix } from "./coachTemplates.ts";
import { wordDiff } from "./diff.ts";
import { selectFixes, type FixSource, type FixTarget } from "./selectFixes.ts";
import { countTextWords } from "./sentences.ts";
import { buildSentenceRefs } from "./structureLabels.ts";
import type { TranscribedEssay } from "./transcribe.types.ts";
import { ApiError } from "./validate.ts";
import type { VerifiedQuote } from "./findings.types.ts";
import {
  capSlots, checkFixes, checkRewrite, cleanNotes, cutWords, findSlots, fixesResponseSchema, neutralise, rewriteOutputSchema, rewriteResponseSchema, validateCoach,
  type VerifiedFix,
} from "./verifyCoach.ts";

export type GenerateFn = (opts: GenerateOptions) => Promise<string>;

export interface CoachOptions {
  /** Retry each model call once with the exact validation error appended. Default true. */
  retry?: boolean;
  /** Needed only for benchmark-based fixes and rewrite inspiration. */
  benchmark?: BenchmarkResult;
  /** How many paragraphs get a model version, the weakest first. Default COACH.MAX_REWRITES; 1 gives the old single-paragraph behaviour. */
  maxRewrites?: number;
  /** Total time budget. Default 40 s. */
  timeoutMs?: number;
  /** Test hook: replaces the Gemini call. */
  generate?: GenerateFn;
}

export interface FixSourceInfo {
  rank: number;
  source: FixSource | "template";
  issueKey: string;
  issueIds: string[];
  quote?: VerifiedQuote;
  quoteUnverified: boolean;
  notes: string[];
}

export interface CoachMetrics {
  issuesSelected: number;
  fixesFromIssues: number;
  fixesFromDimension: number;
  fixesFromBenchmark: number;
  fixesFromTemplate: number;
  quotesProposed: number;
  quotesVerified: number;
  quotesRejected: number;
  numberGuardTriggers: number;
  slotsInserted: number;
  /** Further weak paragraphs that got a model version, besides the main one. */
  extraRewrites: number;
  rewriteLengthRatio: number;
  retries: number;
  totalMs: number;
  /** Models that answered the calls (fallbacks included). */
  models: string[];
}

/** A further weak paragraph rewritten as a teaching model. Same checks as the main one. */
export interface MoreRewrite {
  rewrite: Rewrite;
  changeNotes: { what: string; why: string }[];
  placeholders: string[];
}

export interface CoachResult {
  fixes: Fix[];
  /** The weakest paragraph's rewrite. Always present. */
  rewrite: Rewrite;
  extras: {
    changeNotes: { what: string; why: string }[];
    placeholdersAdded: string[];
    /** Other weak paragraphs, rewritten on a best-effort basis: a failure here never fails the coach. */
    moreRewrites: MoreRewrite[];
    fixSources: FixSourceInfo[];
    warnings: string[];
  };
  metrics: CoachMetrics;
}

/** Thrown when the coach cannot produce a required part. Carries any fixes that did succeed. */
export class CoachError extends ApiError {
  partialFixes: Fix[];
  kind: "no-key" | "unavailable" | "invalid";
  constructor(status: number, message: string, kind: CoachError["kind"], partialFixes: Fix[] = []) {
    super(status, message);
    this.kind = kind;
    this.partialFixes = partialFixes;
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const PER_MODEL_TIMEOUT_MS = 25_000;

function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
  }
  return JSON.parse(t);
}

interface CallCtx {
  generate: GenerateFn;
  deadline: number;
  retry: boolean;
  /** Models that actually answered, for the metrics. */
  used: Set<string>;
}

/** One model call with fallback models on overload. Throws CoachError if no model answers. */
async function callModels(ctx: CallCtx, req: { system: string; prompt: string; schema: unknown }, label: string): Promise<string> {
  const models = [GEMINI_COACH_MODEL, ...GEMINI_COACH_FALLBACKS];
  let lastStatus: number | undefined;
  for (let i = 0; i < models.length; i++) {
    const remaining = ctx.deadline - Date.now();
    if (remaining < 3000) break;
    try {
      const text = await ctx.generate({
        model: models[i],
        system: req.system,
        prompt: req.prompt,
        temperature: COACH_TEMPERATURE,
        maxOutputTokens: 8192,
        responseSchema: req.schema,
        timeoutMs: i < models.length - 1 ? Math.min(remaining, PER_MODEL_TIMEOUT_MS) : remaining,
      });
      ctx.used.add(models[i]);
      return text;
    } catch (e) {
      if (e instanceof GeminiError && /GEMINI_API_KEY/.test(e.message)) throw new CoachError(500, e.message, "no-key");
      lastStatus = e instanceof GeminiError ? e.status : undefined;
      console.error(`coach ${label}: Gemini call failed`, models[i], lastStatus ?? "", (e as Error).message.slice(0, 160));
      if (lastStatus === undefined || !RETRYABLE.has(lastStatus)) throw new CoachError(502, "The coach could not reach the model just now. Please try again in a moment.", "unavailable");
    }
  }
  throw new CoachError(lastStatus === 504 ? 504 : 503, "The coach is very busy right now. Please try again in a minute.", "unavailable");
}

interface Attempt<T> {
  value?: T;
  problems: string[];
  retries: number;
}

/** Calls the model, runs `check`, and retries once with the exact problems appended. Returns the last value and problems. */
async function runCall<T>(ctx: CallCtx, label: string, system: string, schema: unknown, prompt: (problems?: string[]) => string, check: (raw: unknown) => { value?: T; problems: string[] }): Promise<Attempt<T>> {
  let problems: string[] = [];
  let value: T | undefined;
  const attempts = ctx.retry ? 2 : 1;
  for (let a = 0; a < attempts; a++) {
    const text = await callModels(ctx, { system, prompt: prompt(a ? problems : undefined), schema }, label);
    let raw: unknown;
    try {
      raw = extractJson(text);
    } catch {
      problems = ["The reply was not valid JSON."];
      value = undefined;
      continue;
    }
    const r = check(raw);
    value = r.value;
    problems = r.problems;
    if (problems.length === 0) return { value, problems, retries: a };
  }
  return { value, problems, retries: attempts - 1 };
}

/* ---------- planning the rewrite (code decides) ---------- */

export function planRewrite(essay: TranscribedEssay, analysis: BlendedAnalysis, benchmark?: BenchmarkResult): { plan: RewritePlan; warnings: string[] } {
  const warnings: string[] = [];
  let paragraphId = analysis.weakestParagraphId;
  let fallbackNote: string | undefined;
  if (!paragraphId) {
    const ps = analysis.reportParts.paragraphs;
    const measured = new Set(ps.map((p) => p.relevance)).size > 1; // all-equal relevance means it was not measured
    const body = ps.find((p, i) => essay.paragraphs[i]?.kind === "body") ?? ps[0];
    const least = [...ps].sort((a, b) => a.relevance - b.relevance)[0];
    paragraphId = (measured ? least : body).id;
    fallbackNote = measured ? "No paragraph-level problem was measured; the least relevant paragraph was chosen." : "No paragraph-level problem was measured; the first body paragraph was chosen.";
    warnings.push(fallbackNote);
  }
  return { warnings, plan: planFor(essay, analysis, paragraphId, benchmark, fallbackNote) };
}

function planFor(essay: TranscribedEssay, analysis: BlendedAnalysis, paragraphId: string, benchmark?: BenchmarkResult, fallbackNote?: string): RewritePlan {
  const index = essay.paragraphs.findIndex((p) => p.id === paragraphId);
  if (index < 0) throw new CoachError(500, `The paragraph chosen for rewriting (${paragraphId}) is not in the essay.`, "invalid");
  const para = essay.paragraphs[index];
  const refs = buildSentenceRefs(essay);
  const thesisLabel = analysis.labels.find((l) => l.label === "Position");
  const issues = analysis.rankedIssues.filter((i) => i.paragraphId === para.id);
  const role = analysis.reportParts.paragraphs[index]?.role ?? "claim";
  return {
    paragraphId: para.id,
    paragraphNumber: index + 1,
    text: para.text,
    role,
    kind: para.kind,
    thesis: thesisLabel ? refs.find((r) => r.id === thesisLabel.sentenceId)?.text : undefined,
    before: index > 0 ? refs.filter((r) => r.paragraphId === essay.paragraphs[index - 1].id).at(-1)?.text : undefined,
    after: index < essay.paragraphs.length - 1 ? refs.find((r) => r.paragraphId === essay.paragraphs[index + 1].id)?.text : undefined,
    problems: issues.length
      ? issues.map((i) => ({ type: i.type, description: ISSUE_DESCRIPTION[i.type], sentences: i.sentences.slice(0, COACH.MAX_TARGET_SENTENCES) }))
      : [{ type: "general", description: "No specific problem was measured in this paragraph; tighten it and make its point more specific without changing its meaning.", sentences: [] }],
    inspiration: inspirationFor(role, benchmark),
    fallbackNote,
  };
}

/**
 * The other weak paragraphs to rewrite besides `primaryId`. CODE decides, from measured problems only: a paragraph is
 * chosen when the measurements found at least one problem in it, in order of total impact, long enough to rewrite.
 * A paragraph with nothing measured is never rewritten just to fill the quota.
 */
export function planExtraRewrites(essay: TranscribedEssay, analysis: BlendedAnalysis, primaryId: string, benchmark?: BenchmarkResult, max: number = COACH.MAX_REWRITES - 1): RewritePlan[] {
  const impact = new Map<string, number>();
  for (const i of analysis.rankedIssues) if (i.paragraphId) impact.set(i.paragraphId, (impact.get(i.paragraphId) ?? 0) + i.impact);
  return essay.paragraphs
    .filter((p) => p.id !== primaryId && (impact.get(p.id) ?? 0) > 0 && countTextWords(p.text) >= COACH.MIN_REWRITE_WORDS)
    .sort((a, b) => (impact.get(b.id) ?? 0) - (impact.get(a.id) ?? 0) || essay.paragraphs.indexOf(a) - essay.paragraphs.indexOf(b))
    .slice(0, Math.max(0, max))
    .map((p) => planFor(essay, analysis, p.id, benchmark));
}

/* ---------- main ---------- */

export async function coachEssay(essay: TranscribedEssay, topic: string, analysis: BlendedAnalysis, opts: CoachOptions = {}): Promise<CoachResult> {
  const started = Date.now();
  const ctx: CallCtx = { generate: opts.generate ?? generateText, deadline: started + (opts.timeoutMs ?? 40_000), retry: opts.retry ?? true, used: new Set() };
  const warnings: string[] = [];
  const paragraphs = essay.paragraphs.map((p) => ({ id: p.id, text: p.text }));
  const paraNumber = (id: string | null) => (id ? paragraphs.findIndex((p) => p.id === id) + 1 || null : null);

  const selection = selectFixes(analysis, opts.benchmark);
  warnings.push(...selection.warnings);
  const { plan, warnings: planWarnings } = planRewrite(essay, analysis, opts.benchmark);
  warnings.push(...planWarnings);

  const m = { retries: 0, numberGuardTriggers: 0 };

  const doFixes = async (): Promise<VerifiedFix[]> => {
    if (selection.targets.length === 0) return [];
    const r = await runCall(ctx, "fixes", FIXES_SYSTEM, fixesResponseSchema, (p) => buildFixesPrompt(topic, selection.targets, paraNumber, p), (raw) => {
      const c = checkFixes(raw, selection.targets, paragraphs);
      return { value: c.fixes, problems: c.problems };
    });
    m.retries += r.retries;
    if (r.problems.length) warnings.push(`Some fixes were not usable after a retry (${r.problems[0]}); code-written templates were used for them.`);
    return r.value ?? [];
  };

  /** Rewrites one paragraph and applies every check. `tag` names the paragraph in warnings. Throws CoachError if unusable. */
  const rewriteOne = async (plan: RewritePlan, tag: string) => {
    const original = plan.text;
    const r = await runCall(ctx, "rewrite", REWRITE_SYSTEM, rewriteResponseSchema, (p) => buildRewritePrompt(topic, plan, p), (raw) => {
      const parsed = rewriteOutputSchema.safeParse(raw);
      if (!parsed.success) return { problems: [`The reply did not match the required format: ${parsed.error.issues[0]?.message ?? "invalid"}`] };
      const c = checkRewrite(parsed.data.improved, original);
      if (c.guard.numbers.length || c.guard.names.length) m.numberGuardTriggers++;
      return { value: parsed.data, problems: c.problems };
    });
    m.retries += r.retries;
    if (!r.value) throw new CoachError(502, "The model paragraph could not be produced in the required format. Please try again.", "invalid");
    let improved = r.value.improved.trim();
    let check = checkRewrite(improved, original);
    if (check.hard) throw new CoachError(502, `The model paragraph broke the rules and was not used: ${check.problems[0]}`, "invalid");
    if (check.guard.numbers.length || check.guard.names.length) {
      const n = neutralise(improved, original);
      improved = n.text;
      warnings.push(`${tag} contained ${n.replaced} figure(s) or name(s) that were not in your paragraph; each was replaced with a bracketed slot.`);
    }
    check = checkRewrite(improved, original);
    if (check.guard.slots.length > COACH.MAX_SLOTS) {
      const c = capSlots(improved, original);
      improved = c.text;
      warnings.push(`${tag} had more than ${COACH.MAX_SLOTS} slots; ${c.dropped} extra slot(s) were removed.`);
    }
    return { improved, notes: cleanNotes(r.value.changeNotes) };
  };

  // The extra paragraphs run at the same time as the fixes and the main rewrite, so they add no waiting time.
  const extraPlans = planExtraRewrites(essay, analysis, plan.paragraphId, opts.benchmark, (opts.maxRewrites ?? COACH.MAX_REWRITES) - 1);
  const [fixesRes, rewriteRes, ...extraRes] = await Promise.allSettled([
    doFixes(),
    rewriteOne(plan, "The model paragraph"),
    ...extraPlans.map((p) => rewriteOne(p, `The model version of paragraph ${p.paragraphNumber}`)),
  ]);

  if (fixesRes.status === "rejected" && fixesRes.reason instanceof CoachError && fixesRes.reason.kind === "no-key") throw fixesRes.reason;
  if (rewriteRes.status === "rejected") {
    const e = rewriteRes.reason;
    const partial = fixesRes.status === "fulfilled" ? assembleFixes(selection.targets, fixesRes.value, paraNumber, [], true).fixes : [];
    if (e instanceof CoachError) throw new CoachError(e.status, e.message, e.kind, partial);
    throw new CoachError(500, (e as Error).message, "invalid", partial);
  }

  let verified: VerifiedFix[] = [];
  if (fixesRes.status === "fulfilled") verified = fixesRes.value;
  else warnings.push(`The fixes could not be written by the model (${(fixesRes.reason as Error).message}); code-written templates were used.`);

  const assembled = assembleFixes(selection.targets, verified, paraNumber, warnings, false);
  const fixes = assembled.fixes;

  const original = plan.text;
  const { improved, notes } = rewriteRes.value as { improved: string; notes: { what: string; why: string }[] };
  const diff = wordDiff(original, improved);
  const rewrite: Rewrite = { paragraphId: plan.paragraphId, original, improved, removed: diff.removed, added: diff.added };
  const placeholders = findSlots(improved, original);

  validateCoach({ fixes, rewrite }, paragraphs);

  const moreRewrites: MoreRewrite[] = [];
  extraRes.forEach((res, i) => {
    const p = extraPlans[i];
    if (res.status === "rejected") {
      if (res.reason instanceof CoachError && res.reason.kind === "no-key") throw res.reason;
      warnings.push(`Paragraph ${p.paragraphNumber} could not be rewritten this time, so only the other paragraphs have a model version.`);
      return;
    }
    const v = res.value as { improved: string; notes: { what: string; why: string }[] };
    if (v.improved.trim() === p.text.trim()) return; // nothing changed: do not show an empty before/after
    const d = wordDiff(p.text, v.improved);
    moreRewrites.push({
      rewrite: { paragraphId: p.paragraphId, original: p.text, improved: v.improved, removed: d.removed, added: d.added },
      changeNotes: v.notes,
      placeholders: findSlots(v.improved, p.text),
    });
  });

  const src = assembled.sources;
  const proposed = verified.filter((v) => v.quoteProposed);
  return {
    fixes,
    rewrite,
    extras: { changeNotes: notes, placeholdersAdded: placeholders, moreRewrites, fixSources: src, warnings },
    metrics: {
      issuesSelected: selection.issuesSelected,
      fixesFromIssues: src.filter((s) => s.source === "issue").length,
      fixesFromDimension: src.filter((s) => s.source === "dimension").length,
      fixesFromBenchmark: src.filter((s) => s.source === "benchmark").length,
      fixesFromTemplate: src.filter((s) => s.source === "template").length,
      quotesProposed: proposed.length,
      quotesVerified: proposed.filter((v) => v.quote).length,
      quotesRejected: proposed.filter((v) => !v.quote).length,
      numberGuardTriggers: m.numberGuardTriggers,
      slotsInserted: placeholders.length + moreRewrites.reduce((n, m) => n + m.placeholders.length, 0),
      extraRewrites: moreRewrites.length,
      rewriteLengthRatio: Math.round((countTextWords(improved) / Math.max(countTextWords(original), 1)) * 100) / 100,
      retries: m.retries,
      totalMs: Date.now() - started,
      models: [...ctx.used],
    },
  };
}

/** Ranks fixes in code (impact order), using the model's text where it passed and a template otherwise. */
function assembleFixes(targets: FixTarget[], verified: VerifiedFix[], paraNumber: (id: string | null) => number | null, warnings: string[], silent: boolean): { fixes: Fix[]; sources: FixSourceInfo[] } {
  const fixes: Fix[] = [];
  const sources: FixSourceInfo[] = [];
  targets.forEach((t, i) => {
    const rank = (i + 1) as 1 | 2 | 3;
    const v = verified.find((x) => x.target.key === t.key);
    if (v) {
      fixes.push({ rank, title: v.title, body: v.body, ...(v.paragraphId ? { paragraphId: v.paragraphId } : {}) });
      sources.push({ rank, source: t.source, issueKey: t.key, issueIds: t.issueIds, ...(v.quote ? { quote: v.quote } : {}), quoteUnverified: v.quoteUnverified, notes: v.notes });
    } else {
      const tpl = templateFix(t, paraNumber(t.paragraphId));
      if (!silent) warnings.push(`Fix ${rank} (${t.key}) was written from a template.`);
      fixes.push({ rank, title: cutWords(tpl.title, COACH.TITLE_MAX_WORDS).text, body: cutWords(tpl.body, COACH.BODY_MAX_WORDS).text, ...(t.paragraphId ? { paragraphId: t.paragraphId } : {}) });
      sources.push({ rank, source: "template", issueKey: t.key, issueIds: t.issueIds, quoteUnverified: false, notes: ["template"] });
    }
  });
  return { fixes, sources };
}
