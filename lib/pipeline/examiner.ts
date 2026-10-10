import { EXAMINER_TEMPERATURE, GEMINI_EXAMINER_FALLBACKS, GEMINI_EXAMINER_MODEL } from "../config.ts";
import { GeminiError, generateText, type GenerateOptions } from "../gemini.ts";
import type { DimensionScore, ExaminerResult, RubricKey } from "../types.ts";
import { buildUserContent, EXAMINER_SYSTEM } from "./examinerPrompt.ts";
import {
  RUBRIC_KEYS,
  runOutputResponseSchema,
  runOutputSchema,
  type AggregatedDimension,
  type Confidence,
  type MeasuredFindings,
  type RunDimension,
  type RunResult,
  type SecondOpinion,
  type VerifiedQuote,
} from "./findings.types.ts";
import { bandFromScore, clampScore, labelFor, SCALE_OUT_OF } from "./rubric.ts";
import type { TranscribedEssay } from "./transcribe.types.ts";
import { ApiError } from "./validate.ts";
import { verifyDimension } from "./verifyQuotes.ts";
import { median } from "./stats.ts";

export type GenerateFn = (opts: GenerateOptions) => Promise<string>;

export interface ScoreOptions {
  runs?: 1 | 2 | 3;
  /** Total time budget for the whole step. Default 40 s. */
  timeoutMs?: number;
  /** Test hook: replaces the Gemini call. */
  generate?: GenerateFn;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const PER_MODEL_TIMEOUT_MS = 25_000;
export const DEFAULT_RUNS = 2;
/** Scores this far apart (in points) still count as agreeing. */
export const AGREE_WITHIN = 1;

/** Strips code fences and surrounding prose, parses and validates. Throws ZodError or SyntaxError. */
export function parseRunOutput(text: string) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
  }
  return runOutputSchema.parse(JSON.parse(t));
}

function describe(e: unknown): string {
  const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
  return issues ? issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") : (e as Error).message;
}

/** One model run: tries fallback models on overload/timeouts, retries once on invalid output. */
async function oneRun(index: number, user: string, generate: GenerateFn, deadline: number) {
  const models = [GEMINI_EXAMINER_MODEL, ...GEMINI_EXAMINER_FALLBACKS];
  let modelIdx = 0;
  let parseFailures = 0;
  let lastError = "";
  let lastStatus: number | undefined;
  while (modelIdx < models.length && parseFailures < 2) {
    const remaining = deadline - Date.now();
    if (remaining < 3000) break;
    let text: string;
    try {
      text = await generate({
        model: models[modelIdx],
        system: EXAMINER_SYSTEM,
        prompt: parseFailures ? `${user}\n\nYour previous reply was invalid: ${lastError}\nReturn corrected JSON only.` : user,
        temperature: EXAMINER_TEMPERATURE,
        maxOutputTokens: 8192,
        responseSchema: runOutputResponseSchema,
        timeoutMs: modelIdx < models.length - 1 ? Math.min(remaining, PER_MODEL_TIMEOUT_MS) : remaining,
      });
    } catch (e) {
      lastStatus = e instanceof GeminiError ? e.status : undefined;
      console.error(`scoreExaminers run ${index}: Gemini call failed`, models[modelIdx], lastStatus ?? "", (e as Error).message.slice(0, 160));
      if (lastStatus !== undefined && RETRYABLE.has(lastStatus)) {
        modelIdx++;
        continue;
      }
      throw new ApiError(502, "The examiner could not score this essay just now. Please try again in a moment.");
    }
    try {
      return { output: parseRunOutput(text), model: models[modelIdx] };
    } catch (e) {
      parseFailures++;
      lastError = describe(e);
    }
  }
  if (parseFailures >= 2) throw new ApiError(502, "The examiner returned an unreadable result. Please try again.");
  throw new ApiError(lastStatus === 504 ? 504 : 503, "The examiner is very busy right now. Please try again in a minute.");
}

/** Plain average of dimension scores, to one decimal. The blend step decides the real overall score. */
export function simpleAverageOverall(scores: number[]): number {
  return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
}

export function aggregate(runs: RunResult[], essay: Pick<TranscribedEssay, "paragraphs">, elapsedMs: number, warnings: string[] = []): SecondOpinion {
  const dimensions: AggregatedDimension[] = RUBRIC_KEYS.map((key) => {
    const ds: RunDimension[] = runs.map((r) => r.dimensions[key]);
    const scores = ds.map((d) => d.score);
    const medianScore = clampScore(median(scores));
    const runsAgree = Math.max(...scores) - Math.min(...scores) <= AGREE_WITHIN;
    const quotes: VerifiedQuote[] = [];
    for (const d of ds) for (const q of d.verifiedQuotes) if (!quotes.some((x) => x.paragraphId === q.paragraphId && x.start === q.start && x.end === q.end)) quotes.push(q);
    const unverified = ds.every((d) => d.unverified);
    const conflict = ds.some((d) => d.conflict);
    const base: Confidence = unverified || conflict ? "low" : ds.some((d) => d.confidence === "high") ? "high" : "medium";
    return {
      key,
      label: labelFor(key),
      medianScore,
      band: bandFromScore(medianScore),
      scores,
      runsAgree,
      reasons: ds.map((d) => d.reason),
      disagreements: ds.flatMap((d, i) => (d.disagreesWith ? [`Run ${runs[i].index}: ${d.disagreesWith}`] : [])),
      verifiedQuotes: quotes,
      flags: { unverified, conflict, runsDisagree: !runsAgree },
      confidence: base === "high" && !runsAgree ? "medium" : base,
    };
  });

  const examiners: ExaminerResult[] = runs.map((r) => {
    const overall = simpleAverageOverall(RUBRIC_KEYS.map((k) => r.dimensions[k].score));
    return {
      id: `ai-run-${r.index}`,
      label: `AI run ${r.index}`,
      overall,
      band: bandFromScore(overall),
      dimensions: Object.fromEntries(RUBRIC_KEYS.map((k) => [k, r.dimensions[k].band])) as Record<RubricKey, ExaminerResult["band"]>,
    };
  });

  const medianDimensions: DimensionScore[] = dimensions.map((d) => ({
    key: d.key,
    label: d.label,
    score: d.medianScore,
    outOf: SCALE_OUT_OF,
    band: d.band,
    note: d.reasons[0],
  }));

  const disagreeing = dimensions.filter((d) => d.flags.runsDisagree).map((d) => d.key);
  const multi = runs.length > 1;
  const all = runs.flatMap((r) => RUBRIC_KEYS.map((k) => r.dimensions[k]));
  const unverifiedDimensions = dimensions.filter((d) => d.flags.unverified).map((d) => d.key);
  const conflicts = dimensions.flatMap((d) => runs.flatMap((r) => (r.dimensions[d.key].conflict ? [{ key: d.key, note: r.dimensions[d.key].conflictNote ?? "" }] : []))).filter((c, i, a) => a.findIndex((x) => x.key === c.key) === i);

  const w = [...warnings];
  if (!multi) w.push("Only one examiner run succeeded, so run agreement could not be checked.");
  if (unverifiedDimensions.length) w.push(`No verifiable quote for: ${unverifiedDimensions.join(", ")}.`);
  for (const c of conflicts) w.push(`Conflict on ${c.key}: ${c.note}`);
  for (const d of dimensions) for (const x of d.disagreements) w.push(`Disagrees with a measurement on ${d.key} (${x})`);

  return {
    runs,
    dimensions,
    medianDimensions,
    examiners,
    agreement: multi ? { agreedCount: RUBRIC_KEYS.length - disagreeing.length, total: RUBRIC_KEYS.length, disagreeingDimensions: disagreeing } : { agreedCount: 0, total: 0, disagreeingDimensions: [] },
    quotesProposed: all.reduce((n, d) => n + d.quotesProposed, 0),
    quotesVerified: all.reduce((n, d) => n + d.verifiedQuotes.length, 0),
    quotesRejected: all.reduce((n, d) => n + d.quotesRejected, 0),
    unverifiedDimensions,
    conflicts,
    warnings: w,
    elapsedMs,
  };
}

/**
 * Examiner second opinion: an LLM scores the seven dimensions after the measurements exist, must quote the
 * text it relies on, and code verifies every quote. It never produces highlights or the final score.
 */
export async function scoreExaminers(
  essay: TranscribedEssay,
  topic: string,
  findings: MeasuredFindings = {},
  opts: ScoreOptions = {},
): Promise<SecondOpinion> {
  const started = Date.now();
  const generate = opts.generate ?? generateText;
  const n = opts.runs ?? DEFAULT_RUNS;
  const deadline = started + (opts.timeoutMs ?? 40_000);
  const user = buildUserContent(topic, essay, findings);

  // Quotes may come from the candidate's outline as well as the paragraphs.
  const verifiable = [...essay.paragraphs.map((p) => ({ id: p.id, text: p.text })), ...(essay.outline.length ? [{ id: "outline", text: essay.outline.join("\n") }] : [])];

  const settled = await Promise.allSettled(Array.from({ length: n }, (_, i) => oneRun(i + 1, user, generate, deadline)));
  const warnings: string[] = [];
  const runs: RunResult[] = [];
  settled.forEach((s, i) => {
    if (s.status === "rejected") {
      warnings.push(`Run ${i + 1} failed: ${(s.reason as Error).message}`);
      return;
    }
    const dims = Object.fromEntries(RUBRIC_KEYS.map((k) => [k, verifyDimension(k, s.value.output.dimensions[k], verifiable, findings)])) as Record<RubricKey, RunDimension>;
    runs.push({ index: i + 1, dimensions: dims, model: s.value.model });
  });
  if (runs.length === 0) {
    const first = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
    throw first.reason instanceof ApiError ? first.reason : new ApiError(503, "The examiner could not score this essay just now. Please try again in a moment.");
  }
  return aggregate(runs, essay, Date.now() - started, warnings);
}
