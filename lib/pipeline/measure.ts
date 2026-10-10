/**
 * Runs the measuring stages that sit side by side after the handwriting is read:
 *   structure analysis | genericness + drift | top-essay benchmark
 * and merges what they found into one MeasuredFindings for the examiner second opinion, which runs AFTER this
 * (pass `result.findings` to scoreExaminers). A stage that fails or times out is reported and skipped; the others
 * still contribute. Nothing here throws for a stage failure.
 */
import { EMBED_TEXT_BUDGET, MEASURE_STAGE_TIMEOUT_MS } from "../config.ts";
import { analyzeEssayStructure, type StructureAnalysis, type StructureAnalysisInput, type StructureOutcome } from "../structure/index.ts";
import { analyseGenericnessAndDrift, type AnalyseDeps, type EssayAnalysis } from "./analyse.ts";
import { benchmarkEssay, type BenchmarkDeps, type BenchmarkInput } from "./benchmark.ts";
import type { BenchmarkResult } from "./benchmark.types.ts";
import { embedTexts, type EmbedFn } from "./embed.ts";
import { findingsFromAnalysis, findingsFromBenchmark, findingsFromStructure, structureInputText } from "./findings.ts";
import type { MeasuredFindings } from "./findings.types.ts";
import { countTextWords, splitSentences } from "./sentences.ts";
import { createSharedEmbed } from "./sharedEmbed.ts";
import type { TranscribedEssay } from "./transcribe.types.ts";

export interface StageResult<T> {
  status: "ok" | "failed";
  value?: T;
  error?: string;
  ms: number;
}

export interface MeasureDeps {
  /** Underlying embedding call; wrapped so parallel stages share requests. Defaults to embedTexts. */
  embed?: EmbedFn;
  structure?: (input: StructureAnalysisInput) => Promise<StructureOutcome>;
  analyse?: (topic: string, paragraphs: { id: string; text: string }[], deps: AnalyseDeps) => Promise<EssayAnalysis>;
  benchmark?: (input: BenchmarkInput, deps: BenchmarkDeps) => Promise<BenchmarkResult>;
  timeoutsMs?: Partial<Record<"structure" | "analysis" | "benchmark", number>>;
}

export interface MeasureResult {
  structure: StageResult<StructureAnalysis>;
  analysis: StageResult<EssayAnalysis>;
  benchmark: StageResult<BenchmarkResult>;
  /** Merged input for scoreExaminers. Fields from failed stages are simply absent. */
  findings: MeasuredFindings;
  warnings: string[];
  embedding: { requestedTexts: number; embeddedTexts: number; calls: number };
  elapsedMs: number;
}

async function runStage<T>(name: string, timeoutMs: number, fn: () => Promise<T>): Promise<StageResult<T>> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} did not finish within ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs);
      }),
    ]);
    return { status: "ok", value, ms: Date.now() - started };
  } catch (e) {
    return { status: "failed", error: (e as Error).message, ms: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Sentences the benchmark compares, chosen exactly as analyseGenericnessAndDrift chooses the ones it embeds
 * (longest first within the budget left after the topic and paragraphs). Using the same set lets the shared
 * embed send each sentence once. Keep in step with analyse.ts.
 */
function benchmarkSentences(paragraphs: { text: string }[]): string[] {
  const all = paragraphs.flatMap((p, pi) => splitSentences(p.text).map((s, si) => ({ pi, si, text: s.text, words: countTextWords(s.text) })));
  const room = Math.max(EMBED_TEXT_BUDGET - 1 - paragraphs.length, 0);
  const chosen = all.length <= room ? all : [...all].sort((x, y) => y.words - x.words || x.pi - y.pi || x.si - y.si).slice(0, room);
  const keep = new Set(chosen.map((c) => `${c.pi}:${c.si}`));
  return all.filter((c) => keep.has(`${c.pi}:${c.si}`)).map((c) => c.text);
}

export async function measureEssay(essay: TranscribedEssay, topic: string, deps: MeasureDeps = {}): Promise<MeasureResult> {
  const started = Date.now();
  const limits = { ...MEASURE_STAGE_TIMEOUT_MS, ...deps.timeoutsMs };
  const shared = createSharedEmbed(deps.embed ?? embedTexts);
  const paragraphs = essay.paragraphs.map((p) => ({ id: p.id, text: p.text }));

  const structureFn =
    deps.structure ??
    ((input: StructureAnalysisInput) => analyzeEssayStructure(input, { extraction: { timeoutMs: Math.max(limits.structure - 2000, 1000), maxAttempts: 1 } }));
  const analyseFn = deps.analyse ?? analyseGenericnessAndDrift;
  const benchmarkFn = deps.benchmark ?? benchmarkEssay;

  const [structure, analysis, benchmark] = await Promise.all([
    runStage("Structure analysis", limits.structure, async () => {
      const outcome = await structureFn({ text: structureInputText(paragraphs), topic }); // semantic mode stays off: no embedding cost
      if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
      return outcome.result;
    }),
    runStage("Genericness and drift", limits.analysis, () => analyseFn(topic, paragraphs, { embed: shared })),
    runStage("Benchmark", limits.benchmark, async () => {
      const sentences = benchmarkSentences(paragraphs);
      const vecs = await shared([topic, ...sentences]);
      return benchmarkFn({ topic, topicVec: vecs[0], sentences: sentences.map((text, i) => ({ text, vec: vecs[i + 1] })) }, { embed: shared });
    }),
  ]);

  const warnings: string[] = [];
  const findings: MeasuredFindings = {};
  if (analysis.status === "ok") Object.assign(findings, findingsFromAnalysis(analysis.value!, essay));
  else warnings.push(`Genericness and drift unavailable: ${analysis.error}`);
  if (benchmark.status === "ok" && benchmark.value!.status !== "unavailable") Object.assign(findings, findingsFromBenchmark(benchmark.value!));
  else warnings.push(`Benchmark unavailable: ${benchmark.error ?? benchmark.value?.reason ?? "no reference data"}`);
  if (structure.status === "ok") {
    const adapted = findingsFromStructure(structure.value!, essay);
    Object.assign(findings, adapted.findings);
    warnings.push(...adapted.warnings);
  } else warnings.push(`Structure analysis unavailable: ${structure.error}`);

  return { structure, analysis, benchmark, findings, warnings, embedding: shared.stats(), elapsedMs: Date.now() - started };
}
