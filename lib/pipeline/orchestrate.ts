/**
 * The end-to-end pipeline behind POST /api/analyze:
 *
 *   0 validate input                                              (code)
 *   1 read handwriting                                            (vision LLM)         sequential
 *   2 sentence split + shared embeddings                          (code)               sequential
 *   3 PARALLEL: structure | genericness + drift | benchmark | rule checks
 *   4 examiner second opinion                                     (LLM, sees findings) sequential
 *   5 verify, blend, score; builds the Argument X-Ray             (code)               sequential
 *   6 fixes + model paragraph                                     (LLM, grounded)      sequential
 *   7 assemble { report, extras }, validate                       (code)               sequential
 *
 * Failure policy: no essay or no scoring -> stop with a clear error; any measuring stage or the examiner failing ->
 * continue without that finding and say so in warnings; the coach failing -> its fallbacks. A failed stage is never
 * replaced with made-up output, and the mock report is never returned.
 */
import { GEMINI_COACH_MODEL, GEMINI_EMBEDDING_MODEL, GEMINI_EXAMINER_MODEL, GEMINI_VISION_MODEL, PIPELINE } from "../config.ts";
import { GeminiError } from "../gemini.ts";
import { analyzeEssayStructure, type StructureAnalysisInput, type StructureOutcome } from "../structure/index.ts";
import type { Fix, Rewrite } from "../types.ts";
import type { EssayReport } from "../types.ts";
import type { ReportExtras } from "../types.extras.ts";
import { embedPlan, ruleChecks, structureComplete, templateFixesFrom, usableBenchmark, withCachedVectors, essayWordCount } from "./adapters.ts";
import { assembleBundle, AssemblyError, newReportId, WARN } from "./assemble.ts";
import { blendAnalysis } from "./blend.ts";
import type { BlendInput, BlendedAnalysis } from "./blend.types.ts";
import { CoachError, coachEssay, planRewrite, type CoachResult } from "./coach.ts";
import { createRequestEmbed, embedTexts, type EmbedFn } from "./embed.ts";
import { scoreExaminers } from "./examiner.ts";
import type { SecondOpinion } from "./findings.types.ts";
import { measureEssay, type MeasureResult } from "./measure.ts";
import { prepareImages, type UploadedImage } from "./prepareImages.ts";
import { readHandwriting, type PageImage } from "./steps.ts";
import { buildSentenceRefs, labelsFromStructure } from "./structureLabels.ts";
import type { TranscribedEssay } from "./transcribe.types.ts";
import { ApiError } from "./validate.ts";

export interface PipelineInput {
  images: UploadedImage[];
  topic: string;
}

export interface StageRecord {
  name: string;
  status: "ok" | "degraded" | "failed" | "skipped";
  ms: number;
  note?: string;
}

export interface PipelineOutput {
  report: EssayReport;
  extras: ReportExtras;
  stages: StageRecord[];
  meta: { pages: number; words: number; models: Record<string, string>; totalMs: number };
}

/** Steps that can be replaced in tests. */
export interface PipelineDeps {
  prepare?: (images: UploadedImage[]) => Promise<PageImage[]>;
  read?: (pages: PageImage[], topic: string) => Promise<TranscribedEssay>;
  embedBase?: EmbedFn;
  measure?: typeof measureEssay;
  structure?: (input: StructureAnalysisInput) => Promise<StructureOutcome>;
  examine?: typeof scoreExaminers;
  blend?: typeof blendAnalysis;
  coach?: typeof coachEssay;
  now?: () => Date;
  newId?: () => string;
  /** Tests inject steps and have no key; production requires GEMINI_API_KEY. */
  skipKeyCheck?: boolean;
}

export interface PipelineOptions {
  signal?: AbortSignal;
  deps?: PipelineDeps;
  /** Overall deadline in ms. Defaults to PIPELINE.OVERALL_MS; tests shorten it. */
  overallMs?: number;
}

/** An ApiError that also carries the stage records, so a failed request can still be logged. */
export class PipelineFailure extends ApiError {
  stages: StageRecord[];
  constructor(status: number, message: string, stages: StageRecord[]) {
    super(status, message);
    this.stages = stages;
  }
}

class StageTimeout extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not finish within ${Math.round(ms / 1000)} seconds`);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new StageTimeout(label, ms)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export const BUSY_MESSAGE = "The AI service is busy. Please try again in a minute.";
export const TIMEOUT_MESSAGE = "The analysis took too long. Please try again.";

/** Maps anything thrown inside the pipeline to a user-readable ApiError (never a stack trace, key or prompt). */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof StageTimeout) return new ApiError(504, TIMEOUT_MESSAGE);
  if (e instanceof GeminiError) {
    if (/GEMINI_API_KEY/.test(e.message)) return new ApiError(500, "The AI service is not set up on this server yet.");
    if (e.status === 429 || e.status === 503) return new ApiError(503, BUSY_MESSAGE);
    if (e.status === 504) return new ApiError(504, TIMEOUT_MESSAGE);
  }
  return new ApiError(500, "Something went wrong while analysing your essay. Your photos were not lost; please try again.");
}

export const MODEL_NAMES = {
  vision: GEMINI_VISION_MODEL,
  examiner: GEMINI_EXAMINER_MODEL,
  coach: GEMINI_COACH_MODEL,
  embedding: GEMINI_EMBEDDING_MODEL,
} as const;

export async function runPipeline(input: PipelineInput, opts: PipelineOptions = {}): Promise<PipelineOutput> {
  const stages: StageRecord[] = [];
  const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined };
  const overall = new Promise<never>((_, reject) => {
    timer.id = setTimeout(() => reject(new ApiError(504, TIMEOUT_MESSAGE)), opts.overallMs ?? PIPELINE.OVERALL_MS);
  });
  try {
    return await Promise.race([execute(input, opts, stages), overall]);
  } catch (e) {
    let api = toApiError(e);
    // Whichever step reports that the AI service is busy, the user sees one consistent message.
    if (api.status === 503) api = new ApiError(503, BUSY_MESSAGE);
    if (!(e instanceof ApiError)) console.error("pipeline error:", e instanceof Error ? e.constructor.name : typeof e); // type only: never the message, which could hold essay text
    throw new PipelineFailure(api.status, api.message, stages);
  } finally {
    clearTimeout(timer.id);
  }
}

async function execute(input: PipelineInput, opts: PipelineOptions, stages: StageRecord[]): Promise<PipelineOutput> {
  const deps = opts.deps ?? {};
  const started = Date.now();
  const now = deps.now ?? (() => new Date());
  const checkAbort = () => {
    if (opts.signal?.aborted) throw new ApiError(499, "The request was cancelled.");
  };
  const record = (name: string, t0: number, status: StageRecord["status"], note?: string) => stages.push({ name, status, ms: Date.now() - t0, ...(note ? { note } : {}) });
  const warnings: string[] = [];

  /* 0. validate */
  const t0 = Date.now();
  if (!deps.skipKeyCheck && !deps.read && !process.env.GEMINI_API_KEY) throw new ApiError(500, "The AI service is not set up on this server yet.");
  if (input.topic.trim().length < 3) throw new ApiError(400, "Add the essay topic before analysing.");
  if (input.images.length < 1 || input.images.length > 12) throw new ApiError(400, "Add between 1 and 12 photos of your essay.");
  record("validate", t0, "ok");

  /* 1. read handwriting */
  const t1 = Date.now();
  let essay: TranscribedEssay;
  try {
    const prepare = deps.prepare ?? ((imgs: UploadedImage[]) => prepareImages(imgs));
    const read = deps.read ?? ((pages: PageImage[], topic: string) => readHandwriting(pages, topic));
    essay = await withTimeout((async () => read(await prepare(input.images), input.topic))(), PIPELINE.HANDWRITING_MS, "Reading the handwriting");
  } catch (e) {
    record("handwriting", t1, "failed", (e as Error).message?.slice(0, 120));
    throw e;
  }
  const words = essayWordCount(essay);
  if (words > PIPELINE.MAX_ESSAY_WORDS) {
    record("handwriting", t1, "failed", `${words} words`);
    throw new ApiError(422, `This essay is about ${words} words, which is more than the ${PIPELINE.MAX_ESSAY_WORDS} words we can analyse in one go. Try a shorter essay or fewer pages.`);
  }
  record("handwriting", t1, essay.legibility === "poor" ? "degraded" : "ok", `legibility ${essay.legibility}; ${essay.paragraphs.length} paragraphs, ${words} words`);
  essay.warnings.slice(0, 3).forEach((w) => warnings.push(`Handwriting note: ${w.slice(0, 200)}`));
  checkAbort();

  /* 2. shared context: sentences and one request-scoped embedding cache */
  const t2 = Date.now();
  const shared = createRequestEmbed(deps.embedBase ?? embedTexts);
  let embed: EmbedFn = shared;
  try {
    await withTimeout(shared(embedPlan(essay, input.topic)), 50_000, "Embedding the essay");
    record("embeddings", t2, "ok", `${shared.stats().embeddedTexts} texts in ${shared.stats().calls} call(s)`);
  } catch (e) {
    // Without embeddings the stages that need them fail fast instead of each waiting out the same quota error.
    embed = () => Promise.reject(new Error("embeddings unavailable"));
    record("embeddings", t2, "failed", (e as Error).message?.slice(0, 120));
  }
  checkAbort();

  /* 3. parallel measurement */
  const t3 = Date.now();
  const measure = deps.measure ?? measureEssay;
  const structureFn = deps.structure ?? ((i: StructureAnalysisInput) => analyzeEssayStructure(i, { complete: structureComplete, extraction: { timeoutMs: 28_000, maxAttempts: 1 } }));
  let m: MeasureResult | undefined;
  try {
    m = await withTimeout(measure(essay, input.topic, { embed, structure: structureFn }), PIPELINE.MEASURE_MS + 3000, "Measuring the essay");
  } catch (e) {
    record("measure", t3, "failed", (e as Error).message?.slice(0, 120));
    warnings.push("The structure, drift and benchmark measurements were unavailable for this essay, so the feedback is limited.");
  }
  const rules = ruleChecks(essay);
  record("rules", Date.now(), "ok");
  if (m) {
    const st = m.structure;
    const an = m.analysis;
    const bm = m.benchmark;
    stages.push({ name: "structure", status: st.status === "ok" ? "ok" : "failed", ms: st.ms, ...(st.error ? { note: st.error.slice(0, 120) } : {}) });
    stages.push({ name: "genericness+drift", status: an.status === "ok" ? (an.value!.unassessedSentences > 0 ? "degraded" : "ok") : "failed", ms: an.ms, ...(an.error ? { note: an.error.slice(0, 120) } : an.value?.unassessedSentences ? { note: `${an.value.unassessedSentences} sentences not assessed (over the embedding budget)` } : {}) });
    stages.push({
      name: "benchmark",
      status: bm.status !== "ok" ? "failed" : bm.value!.status === "unavailable" ? "skipped" : bm.value!.status === "partial" ? "degraded" : "ok",
      ms: bm.ms,
      ...(bm.error ? { note: bm.error.slice(0, 120) } : bm.value?.reason ? { note: bm.value.reason.slice(0, 120) } : {}),
    });
    if (st.status !== "ok") warnings.push(WARN.structure);
    if (an.status !== "ok") warnings.push(WARN.analysis);
    else if (an.value!.unassessedSentences > 0) warnings.push(`${an.value!.unassessedSentences} short sentences were not checked for generic wording because the essay is long.`);
    if (bm.status !== "ok") warnings.push(WARN.benchmark);
    m.warnings.filter((w) => !/unavailable:/i.test(w)).forEach((w) => warnings.push(w));
  }
  checkAbort();

  /* 4. examiner second opinion */
  const t4 = Date.now();
  const findings = { ...(m?.findings ?? {}), rules: m?.findings.rules ?? rules };
  let examiner: SecondOpinion | undefined;
  try {
    const examine = deps.examine ?? scoreExaminers;
    examiner = await withTimeout(examine(essay, input.topic, findings, { runs: PIPELINE.EXAMINER_RUNS, timeoutMs: PIPELINE.EXAMINER_MS - 3000 }), PIPELINE.EXAMINER_MS, "The examiner");
    record("examiner", t4, examiner.runs.length < PIPELINE.EXAMINER_RUNS ? "degraded" : "ok", `${examiner.runs.length} run(s)`);
  } catch (e) {
    record("examiner", t4, "failed", (e as Error).message?.slice(0, 120));
    warnings.push(WARN.examiner);
  }
  checkAbort();

  /* 5. verify, blend, score */
  const t5 = Date.now();
  const refs = buildSentenceRefs(essay);
  const benchmarkResult = usableBenchmark(m?.benchmark.value);
  let structure: BlendInput["structure"];
  if (m?.structure.status === "ok" && m.structure.value) {
    const labelled = labelsFromStructure(m.structure.value, essay, refs);
    labelled.warnings.forEach((w) => warnings.push(w));
    if (labelled.sentences.length > 0) structure = { sentences: labelled.sentences };
    else warnings.push("Structure labels could not be matched to your essay, so the argument map was left out.");
  }
  const blendInput = (withVectors: boolean): BlendInput => ({
    essay,
    topic: input.topic,
    sentences: withVectors ? withCachedVectors(refs, shared) : refs,
    ...(structure ? { structure } : {}),
    ...(m?.analysis.value ? { analysis: m.analysis.value } : {}),
    ...(benchmarkResult ? { benchmark: benchmarkResult } : {}),
    ...(examiner ? { examiner } : {}),
  });
  const blend = deps.blend ?? blendAnalysis;
  let blended: BlendedAnalysis;
  try {
    try {
      blended = await withTimeout(blend(blendInput(true), { embed }), 45_000, "Scoring");
    } catch {
      // The only optional outside call is embedding; if it failed, score without linking rather than not at all.
      blended = await blend(blendInput(false));
      warnings.push(WARN.linking);
    }
    record("blend", t5, "ok");
  } catch (e) {
    record("blend", t5, "failed", (e as Error).message?.slice(0, 120));
    throw new ApiError(500, "We could not finish scoring your essay. Please try again.");
  }
  checkAbort();

  /* 6. fixes + model paragraph */
  const t6 = Date.now();
  let fixes: Fix[];
  let rewrite: Rewrite;
  let coachExtras: CoachResult["extras"] | undefined;
  try {
    const coach = deps.coach ?? coachEssay;
    const c = await withTimeout(coach(essay, input.topic, blended, { benchmark: benchmarkResult, timeoutMs: PIPELINE.COACH_MS - 2000 }), PIPELINE.COACH_MS, "The coach");
    fixes = c.fixes;
    rewrite = c.rewrite;
    coachExtras = c.extras;
    warnings.push(...c.extras.warnings);
    record("coach", t6, c.metrics.fixesFromTemplate > 0 ? "degraded" : "ok", `${c.metrics.fixesFromTemplate} template fix(es), ${c.metrics.retries} retr${c.metrics.retries === 1 ? "y" : "ies"}`);
  } catch (e) {
    if (e instanceof CoachError && e.kind === "no-key") throw new ApiError(500, "The AI service is not set up on this server yet.");
    record("coach", t6, "degraded", (e as Error).message?.slice(0, 120));
    // Fixes: whatever succeeded, else code-written templates built from the same findings.
    const partial = e instanceof CoachError ? e.partialFixes : [];
    fixes = partial.length >= 3 ? partial : templateFixesFrom(blended, benchmarkResult);
    warnings.push("The fixes were written from templates because the AI coach was unavailable.");
    // Rewrite: a model paragraph cannot be made in code. The paragraph is shown unchanged and the page says so.
    const { plan } = planRewrite(essay, blended, benchmarkResult);
    rewrite = { paragraphId: plan.paragraphId, original: plan.text, improved: plan.text, removed: [], added: [] };
    warnings.push("A model paragraph could not be written this time, so the paragraph shown under Before and after is your own, unchanged.");
  }

  /* 7. assemble and validate */
  const t7 = Date.now();
  let bundle: { report: EssayReport; extras: ReportExtras };
  try {
    bundle = assembleBundle({
      id: (deps.newId ?? newReportId)(),
      now: now(),
      topic: input.topic.trim(),
      pageCount: input.images.length,
      essay,
      sentences: refs,
      blend: blended,
      fixes,
      rewrite,
      ...(coachExtras ? { rewriteExtras: { changeNotes: coachExtras.changeNotes, placeholders: coachExtras.placeholdersAdded } } : {}),
      ...(benchmarkResult ? { benchmark: benchmarkResult } : {}),
      warnings,
    });
    record("assemble", t7, "ok");
  } catch (e) {
    record("assemble", t7, "failed", (e as Error).message?.slice(0, 160));
    if (e instanceof AssemblyError) throw new ApiError(500, "We finished analysing but could not build a valid report. Please try again.");
    throw e;
  }

  return { ...bundle, stages, meta: { pages: input.images.length, words, models: { ...MODEL_NAMES }, totalMs: Date.now() - started } };
}
