/**
 * Evaluates the benchmark and recommends thresholds. No API calls; reads data/ and data/cache/.
 * Run: npm run eval:benchmark
 *
 * Three parts:
 *  A. Reference leave-one-out coverage separation (needs >= 3 reference essays in a theme).
 *  B. Checklist separation on the synthetic on-topic paragraphs (works without reference essays).
 *  C. Theme matching of the 50 topics (leave-one-out) and a THEME_MIN_SIMILARITY recommendation.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BENCHMARK } from "../lib/config.ts";
import { benchmarkSchema, PROFILE_FEATURES, type Benchmark } from "../lib/pipeline/benchmark.types.ts";
import { coverageOf, pointsToUse } from "../lib/pipeline/benchmark.ts";
import { mergeThemePoints, type RawPoint } from "../lib/pipeline/cluster.ts";
import { auc } from "../lib/pipeline/logreg.ts";
import { quantile } from "../lib/pipeline/stats.ts";
import { splitSentences } from "../lib/pipeline/sentences.ts";
import { cosine, normalize } from "../lib/pipeline/vecmath.ts";
import { embedCached } from "./util.ts";

const DATA = path.join(process.cwd(), "data");
const CACHE = path.join(DATA, "cache");
const read = <T>(f: string): T => JSON.parse(readFileSync(path.join(DATA, f), "utf8"));
const bm = benchmarkSchema.parse(read("benchmark.json")) as Benchmark;
const themes = read<{ key: string; topicIds: string[] }[]>("themes.json");
const topics = read<{ topics: { id: string; vec: number[] }[] }>("topics.embedded.json").topics;
const THRESHOLDS = Array.from({ length: 24 }, (_, i) => Math.round((0.5 + i * 0.02) * 100) / 100);

function bestThreshold(rows: { th: number; auc: number }[]) {
  const max = Math.max(...rows.map((r) => r.auc));
  return [...rows].reverse().find((r) => r.auc === max)!; // ties: prefer the stricter (higher) threshold
}
const themeOfTopic = (id: string) => themes.find((t) => t.topicIds.includes(id))!.key;
const centroidOf = (vs: number[][]) => normalize(vs[0].map((_, i) => vs.reduce((s, v) => s + v[i], 0)));

const result: Record<string, unknown> = { builtAt: new Date().toISOString(), nEssays: bm.meta.nEssays, countsByTheme: bm.meta.countsByTheme };

/* ---------- A. reference leave-one-out ---------- */
interface EssayData { id: string; theme: string; points: { point: string; type: never; vec: number[] }[]; sentenceVecs: number[][]; qualityBasis: never }
const essays: EssayData[] = existsSync(CACHE)
  ? readdirSync(CACHE).filter((f) => f.startsWith("bm-essaydata-")).map((f) => JSON.parse(readFileSync(path.join(CACHE, f), "utf8")))
  : [];

const eligible = themes.filter((t) => essays.filter((e) => e.theme === t.key).length >= BENCHMARK.MIN_REFERENCE_ESSAYS).map((t) => t.key);
if (essays.length === 0 || eligible.length < 1) {
  result.referenceLOO = {
    status: "insufficient data",
    message: essays.length === 0 ? "No reference essays were used to build the benchmark, so leave-one-out coverage cannot be evaluated." : `No theme has ${BENCHMARK.MIN_REFERENCE_ESSAYS} or more reference essays. Counts: ${JSON.stringify(bm.meta.countsByTheme)}.`,
  };
  console.log("A. Reference leave-one-out:", (result.referenceLOO as { message: string }).message);
} else {
  const rows = THRESHOLDS.map((th) => {
    const labels: number[] = [];
    const scores: number[] = [];
    for (const e of essays.filter((x) => eligible.includes(x.theme))) {
      const others = essays.filter((x) => x.theme === e.theme && x.id !== e.id);
      const raw: RawPoint[] = others.flatMap((o) => o.points.map((p) => ({ point: p.point, type: p.type, vec: p.vec, essayId: o.id, qualityBasis: o.qualityBasis })));
      const own = pointsToUse({ key: e.theme, label: e.theme, centroid: [], nEssays: others.length, points: mergeThemePoints(raw, others.length, BENCHMARK.CLUSTER_THRESHOLD) });
      if (own.basis === "llm-checklist") continue;
      const frac = (pts: typeof own.points) => { const c = coverageOf(pts, e.sentenceVecs, th); return c.total ? c.covered / c.total : 0; };
      labels.push(1); scores.push(frac(own.points));
      for (const t of bm.themes.filter((x) => x.key !== e.theme)) {
        const u = pointsToUse(t);
        if (u.basis === "llm-checklist") continue;
        labels.push(0); scores.push(frac(u.points));
      }
    }
    return { th, auc: labels.includes(0) && labels.includes(1) ? auc(scores, labels) : NaN, n: labels.filter((l) => l === 1).length };
  }).filter((r) => !Number.isNaN(r.auc));
  const best = rows.length ? bestThreshold(rows) : null;
  result.referenceLOO = { status: best ? "ok" : "insufficient data", eligibleThemes: eligible, byThreshold: rows, recommendedCoverageThreshold: best?.th ?? null, bestAuc: best?.auc ?? null };
  console.log("A. Reference leave-one-out (themes:", eligible.join(", "), ")");
  console.log(best ? `   AUC ${best.auc.toFixed(3)} at threshold ${best.th}` : "   Not enough cross-theme data (need reference points in at least two themes).");
  const small = themes.filter((t) => !eligible.includes(t.key)).map((t) => `${t.key} (n=${bm.meta.countsByTheme[t.key] ?? 0})`);
  if (small.length) console.log("   Skipped, fewer than 3 essays:", small.join(", "));
}

/* ---------- B. checklist separation on synthetic on-topic paragraphs ---------- */
const driftItems = read<{ items: { topicId: string; onTopic: boolean; text: string; vec: number[] }[] }>("drift-set.json").items.filter((i) => i.onTopic);
// Candidates are the paragraph's sentences (as at runtime). Embeddings are cached in data/cache; falls back to whole-paragraph vectors if the API is unavailable.
let candidateMode = "sentences";
let drift: { topicId: string; vecs: number[][] }[];
try {
  const sents = driftItems.map((i) => splitSentences(i.text).map((x) => x.text));
  const vecs = await embedCached(sents.flat());
  let k = 0;
  drift = driftItems.map((i, n) => ({ topicId: i.topicId, vecs: sents[n].map(() => vecs[k++]) }));
} catch (e) {
  candidateMode = "whole paragraphs (API unavailable: " + (e as Error).message.slice(0, 60) + ")";
  drift = driftItems.map((i) => ({ topicId: i.topicId, vecs: [i.vec] }));
}
const checklistThemes = bm.themes.map((t) => ({ key: t.key, points: t.points.filter((p) => p.origin === "llm-checklist") })).filter((t) => t.points.length);
const bRows = THRESHOLDS.map((th) => {
  const labels: number[] = [];
  const scores: number[] = [];
  for (const it of drift) {
    const own = themeOfTopic(it.topicId);
    for (const t of checklistThemes) {
      const c = coverageOf(t.points, it.vecs, th);
      labels.push(t.key === own ? 1 : 0);
      scores.push(c.total ? c.covered / c.total : 0);
    }
  }
  return { th, auc: auc(scores, labels) };
}).filter((r) => !Number.isNaN(r.auc));
const bBest = bRows.length ? bestThreshold(bRows) : null;
result.checklistSeparation = {
  note: "Uses 40 synthetic on-topic paragraphs against each theme's AI checklist. Indicative only.",
  candidates: candidateMode,
  nParagraphs: drift.length,
  byThreshold: bRows,
  recommended: bBest?.th ?? null,
  bestAuc: bBest?.auc ?? null,
};
console.log("\nB. Checklist separation (synthetic paragraphs, indicative)");
if (bBest) {
  for (const r of bRows) console.log(`   threshold ${r.th.toFixed(2)}  AUC ${r.auc.toFixed(3)}${r.th === bBest.th ? "   <-- best" : ""}`);
  console.log(`   Configured COVERAGE_THRESHOLD: ${BENCHMARK.COVERAGE_THRESHOLD}`);
} else console.log("   No checklist points in benchmark.json.");

/* ---------- C. theme matching ---------- */
let correct = 0;
const correctSims: number[] = [];
const wrongSims: number[] = [];
for (const t of topics) {
  const own = themeOfTopic(t.id);
  const cents = themes.map((th) => ({ key: th.key, c: centroidOf(th.topicIds.filter((id) => id !== t.id).map((id) => normalize(topics.find((x) => x.id === id)!.vec))) }));
  const best = cents.map((c) => ({ key: c.key, s: cosine(t.vec, c.c) })).sort((a, b) => b.s - a.s)[0];
  if (best.key === own) { correct++; correctSims.push(best.s); } else wrongSims.push(best.s);
}
// Runtime query = topic + the essay's own centroid. Approximate with topic + synthetic on-topic paragraph.
let combinedCorrect = 0;
for (const it of driftItems) {
  const t = topics.find((x) => x.id === it.topicId)!;
  const q = normalize(t.vec.map((x, i) => x + it.vec[i]));
  const cents = themes.map((th) => ({ key: th.key, c: centroidOf(th.topicIds.filter((id) => id !== t.id).map((id) => normalize(topics.find((x) => x.id === id)!.vec))) }));
  if (cents.map((c) => ({ key: c.key, s: cosine(q, c.c) })).sort((a, b) => b.s - a.s)[0].key === themeOfTopic(t.id)) combinedCorrect++;
}
// Clearly unrelated probes: how similar are they to the nearest theme centroid?
const PROBES = ["Cricket world cup final highlights", "How to cook chicken biryani at home", "Quantum computing hardware advances", "A review of the latest superhero film", "Fashion trends for the summer season", "Best smartphones to buy this year"];
let probeSims: number[] = [];
try {
  const pv = await embedCached(PROBES);
  probeSims = pv.map((v) => Math.max(...bm.themes.map((t) => cosine(normalize(v), t.centroid))));
} catch { /* API unavailable */ }
const p05 = quantile(correctSims, 0.05);
const wrongMax = wrongSims.length ? Math.max(...wrongSims) : 0;
result.themeMatching = {
  note: "Leave-one-out over the 50 topics, topic vector only. At runtime the query also includes the essay's own sentences.",
  accuracy: correct / topics.length,
  correctSimilarity: { min: Math.min(...correctSims), p05, median: quantile(correctSims, 0.5) },
  wrongMatchSimilarityMax: wrongMax,
  topicPlusParagraphAccuracy: combinedCorrect / driftItems.length,
  unrelatedProbeMaxSimilarity: probeSims.length ? Math.max(...probeSims) : null,
  unrelatedProbeSimilarities: probeSims,
  configuredThemeMin: BENCHMARK.THEME_MIN_SIMILARITY,
};
console.log(`\nC. Theme matching (50 topics, leave-one-out): ${(100 * correct / topics.length).toFixed(0)}% correct`);
console.log(`   similarity of correct matches: min ${Math.min(...correctSims).toFixed(3)}, 5th pct ${p05.toFixed(3)}, median ${quantile(correctSims, 0.5).toFixed(3)}; configured THEME_MIN_SIMILARITY ${BENCHMARK.THEME_MIN_SIMILARITY}`);

console.log(`   topic + paragraph query (closer to runtime): ${(100 * combinedCorrect / driftItems.length).toFixed(0)}% correct`);
console.log(probeSims.length ? `   unrelated probes (cricket, biryani, ...): nearest-theme similarity ${Math.min(...probeSims).toFixed(3)} to ${Math.max(...probeSims).toFixed(3)}` : "   unrelated probes: skipped (API unavailable)");

/* ---------- profile sanity ---------- */
const prof = bm.profile;
if (prof.nEssays === 0) {
  result.profileSanity = { status: "insufficient data", message: "No reference essays: the style profile has no distributions." };
  console.log("\nProfile sanity: no reference essays, so the style profile is unavailable.");
} else {
  console.log("\nProfile sanity: share of reference essays inside their own q1-q3 band is about 50% by construction;");
  console.log("   it is only a check that the distributions were computed (n =", prof.nEssays, "). Features:", PROFILE_FEATURES.join(", "));
  result.profileSanity = { status: "ok", n: prof.nEssays, note: "Expected near 50% by construction." };
}

writeFileSync(path.join(DATA, "benchmark-eval.json"), JSON.stringify(result, null, 2));
console.log("\nWrote data/benchmark-eval.json");
