import { BENCHMARK } from "../config.ts";
import {
  PROFILE_FEATURES,
  benchmarkSchema,
  type Benchmark,
  type BenchmarkPoint,
  type BenchmarkResult,
  type CoveragePoint,
  type QualityBasis,
} from "./benchmark.types.ts";
import { loadAssets, type Assets } from "./dataFiles.ts";
// Imported statically so it is bundled into the serverless function (see dataFiles.ts).
import benchmarkJson from "../../data/benchmark.json" with { type: "json" };
import { embedTexts, type EmbedFn } from "./embed.ts";
import type { FeatureVector } from "./features.ts";
import { essayProfile, profileRows } from "./profile.ts";
import { cosine, dot, normalize } from "./vecmath.ts";

export interface BenchmarkInput {
  topic: string;
  topicVec: number[];
  /** Reuse the vectors from the genericness step. Sentences without a vec are embedded in one batched call. */
  sentences: { text: string; vec?: number[]; features?: FeatureVector }[];
}

export interface BenchmarkDeps {
  benchmark?: Benchmark;
  assets?: Assets;
  embed?: EmbedFn;
  coverageThreshold?: number;
  themeMinSimilarity?: number;
}

let cached: Benchmark | null = null;

/** Validates the bundled data/benchmark.json once per server instance. Throws with a clear reason if it is malformed. */
export function loadBenchmark(): Benchmark {
  if (cached) return cached;
  const r = benchmarkSchema.safeParse(benchmarkJson);
  if (!r.success) throw new Error(`data/benchmark.json is malformed: ${r.error.issues[0]?.message ?? "invalid"}. Run: npm run build:benchmark`);
  cached = r.data;
  return cached;
}

function unavailable(reason: string): BenchmarkResult {
  return { status: "unavailable", reason, profile: [], nProfileEssays: 0, disclaimers: [] };
}

export function pointsToUse(theme: Benchmark["themes"][number]): { points: BenchmarkPoint[]; basis: "reference" | "mixed" | "llm-checklist" } {
  const refs = theme.points.filter((p) => p.origin === "reference");
  const checklist = theme.points.filter((p) => p.origin === "llm-checklist");
  if (theme.nEssays < BENCHMARK.MIN_REFERENCE_ESSAYS || refs.length === 0) return { points: checklist, basis: "llm-checklist" };
  // With enough essays, ignore idiosyncratic points that only one essay made.
  const usable = theme.nEssays >= 4 ? refs.filter((p) => (p.madeByCount ?? 0) >= BENCHMARK.MIN_MADE_BY) : refs;
  if (usable.length >= BENCHMARK.MIN_REFERENCE_POINTS) return { points: usable, basis: "reference" };
  // Too few reference points: add checklist points that do not duplicate them.
  const extra = checklist.filter((c) => !usable.some((r) => dot(r.centroid, c.centroid) >= BENCHMARK.CLUSTER_THRESHOLD));
  return { points: [...usable, ...extra], basis: usable.length ? "mixed" : "llm-checklist" };
}

const byMadeBy = (a: CoveragePoint, b: CoveragePoint) => (b.madeByCount ?? -1) - (a.madeByCount ?? -1) || b.bestSimilarity - a.bestSimilarity;

export function coverageOf(points: BenchmarkPoint[], vecs: number[][], threshold: number) {
  const scored: (CoveragePoint & { isCovered: boolean })[] = points.map((p) => {
    let best = -1;
    for (const v of vecs) best = Math.max(best, cosine(v, p.centroid));
    return {
      point: p.point,
      type: p.type,
      madeByCount: p.madeByCount,
      ofN: p.ofN,
      origin: p.origin,
      bestSimilarity: Math.round(best * 1000) / 1000,
      isCovered: best >= threshold,
    };
  });
  const strip = ({ isCovered: _c, ...rest }: (typeof scored)[number]): CoveragePoint => rest;
  return {
    total: scored.length,
    covered: scored.filter((s) => s.isCovered).length,
    missing: scored.filter((s) => !s.isCovered).map(strip).sort(byMadeBy).slice(0, BENCHMARK.MAX_LISTED),
    coveredPoints: scored.filter((s) => s.isCovered).map(strip).sort(byMadeBy).slice(0, BENCHMARK.MAX_LISTED),
  };
}

/** Nearest theme by cosine to the theme centroids. */
export function nearestTheme(query: number[], b: Benchmark) {
  let best = { key: "", label: "", similarity: -1 };
  for (const t of b.themes) {
    const s = cosine(query, t.centroid);
    if (s > best.similarity) best = { key: t.key, label: t.label, similarity: Math.round(s * 1000) / 1000 };
  }
  return best;
}

function disclaimers(b: Benchmark, nRefs: number, basis: string): string[] {
  const out: string[] = [];
  const bases = Object.entries(b.meta.countsByQualityBasis).filter(([, n]) => n > 0);
  if (nRefs > 0) {
    out.push(`Compared with ${nRefs} reference essay${nRefs === 1 ? "" : "s"} for this theme (${b.profile.nEssays} overall). Sources: ${bases.map(([k, n]) => `${n} ${k}`).join(", ")}.`);
  }
  if (basis === "llm-checklist") out.push("Coverage uses a checklist of expected points written by an AI model, not points from reference essays.");
  out.push("The reference essays are not marked exam scripts.");
  out.push("This comparison does not affect your score or verdict.");
  if (b.profile.nEssays < BENCHMARK.INDICATIVE_BELOW) out.push(`Indicative only: fewer than ${BENCHMARK.INDICATIVE_BELOW} reference essays.`);
  return out;
}

/**
 * Coverage of key points that reference essays make, plus a style profile against the reference range.
 * No LLM calls: reuses sentence vectors, or embeds the missing ones in a single batch.
 */
export async function benchmarkEssay(input: BenchmarkInput, deps: BenchmarkDeps = {}): Promise<BenchmarkResult> {
  let b: Benchmark;
  try {
    b = deps.benchmark ?? loadBenchmark();
  } catch (e) {
    return unavailable((e as Error).message);
  }
  if (b.themes.length === 0) return unavailable("The benchmark contains no themes.");
  if (input.sentences.length === 0) return unavailable("There are no sentences to compare.");

  // Embed only what is missing, in one batch.
  const missing = input.sentences.map((s, i) => (s.vec ? -1 : i)).filter((i) => i >= 0);
  const vecs = input.sentences.map((s) => s.vec);
  if (missing.length) {
    const embed = deps.embed ?? embedTexts;
    const got = await embed(missing.map((i) => input.sentences[i].text));
    if (got.length !== missing.length) throw new Error(`Embedding returned ${got.length} vectors for ${missing.length} texts.`);
    missing.forEach((i, k) => (vecs[i] = got[k]));
  }
  const sentenceVecs = vecs as number[][];

  // Theme: nearest centroid to the topic combined with the essay's own sentence centroid.
  const mean = new Array<number>(sentenceVecs[0].length).fill(0);
  for (const v of sentenceVecs) for (let i = 0; i < mean.length; i++) mean[i] += v[i] / sentenceVecs.length;
  const query = normalize(input.topicVec.map((x, i) => x + normalize(mean)[i]));
  const theme = nearestTheme(query, b);
  const themeMin = deps.themeMinSimilarity ?? BENCHMARK.THEME_MIN_SIMILARITY;

  // Profile against the overall reference distribution.
  let profile: BenchmarkResult["profile"] = [];
  if (b.profile.nEssays > 0) {
    const assets = deps.assets ?? loadAssets();
    const values = essayProfile(
      input.sentences.map((s, i) => ({ text: s.text, vec: sentenceVecs[i], features: s.features })),
      { topicVecs: assets.topics.map((t) => t.vec), bankVecs: assets.bankVecs, model: assets.model },
    );
    profile = profileRows(values, b.profile.features, PROFILE_FEATURES);
  }

  const base = { theme, profile, nProfileEssays: b.profile.nEssays };
  if (theme.similarity < themeMin) {
    return {
      status: "partial",
      reason: `This essay does not clearly match any benchmark theme (closest: ${theme.label}, similarity ${theme.similarity.toFixed(2)}), so key-point coverage was skipped.`,
      ...base,
      disclaimers: disclaimers(b, 0, "llm-checklist"),
    };
  }

  const t = b.themes.find((x) => x.key === theme.key)!;
  const { points, basis } = pointsToUse(t);
  if (points.length === 0) {
    return { status: "partial", reason: `No key points are stored for the theme "${t.label}".`, ...base, disclaimers: disclaimers(b, t.nEssays, "llm-checklist") };
  }
  const cov = coverageOf(points, sentenceVecs, deps.coverageThreshold ?? BENCHMARK.COVERAGE_THRESHOLD);

  const noRefs = b.profile.nEssays === 0;
  return {
    status: noRefs ? "partial" : "ok",
    ...(noRefs ? { reason: "No reference essays have been added yet, so coverage uses an AI-written checklist and the style comparison is unavailable." } : {}),
    ...base,
    coverage: { basis, nReferences: basis === "llm-checklist" ? 0 : t.nEssays, ...cov },
    disclaimers: disclaimers(b, basis === "llm-checklist" ? 0 : t.nEssays, basis),
  };
}
