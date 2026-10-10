/**
 * Builds data/benchmark.json from reference essays (data/reference-raw/*.txt) plus an AI-written checklist per theme.
 * Resumable: Gemini and embedding results are cached in data/cache/.
 * With no reference essays, only the checklist part is built.
 * Run: npm run build:benchmark
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BENCHMARK, EMBEDDING_DIMENSIONS, GEMINI_EMBEDDING_MODEL } from "../lib/config.ts";
import { assertNoLongPoints, extractedPointsResponseSchema, extractedPointsSchema, type Benchmark, type BenchmarkPoint, type ExtractedPoints, type QualityBasis } from "../lib/pipeline/benchmark.types.ts";
import { mergeThemePoints, type RawPoint } from "../lib/pipeline/cluster.ts";
import { loadAssets } from "../lib/pipeline/dataFiles.ts";
import { essayProfile } from "../lib/pipeline/profile.ts";
import { PROFILE_FEATURES } from "../lib/pipeline/benchmark.types.ts";
import { ReferenceError, parseReference } from "../lib/pipeline/reference.ts";
import { splitSentences } from "../lib/pipeline/sentences.ts";
import { distribution } from "../lib/pipeline/stats.ts";
import { normalize, roundVec } from "../lib/pipeline/vecmath.ts";
import { DATA, cacheWrite, embedCached, genValidated, pool, sha } from "./util.ts";

interface Theme { key: string; label: string; topicIds: string[] }
const themes: Theme[] = JSON.parse(readFileSync(path.join(DATA, "themes.json"), "utf8"));
const topics: { id: string; text: string; vec: number[] }[] = JSON.parse(readFileSync(path.join(DATA, "topics.embedded.json"), "utf8")).topics;

const validate = (raw: unknown): ExtractedPoints => extractedPointsSchema.parse(raw);

const POINT_RULES = `Each point: "point" is ONE sentence of at most 20 words, in your own words (never quote the essay); "type" is one of cause, effect, pakistan-context, global-comparison, data, counter-argument, rebuttal, way-forward, institution; "specifics" lists the concrete names, figures, laws or institutions involved (short strings, may be empty).`;

/* ---------- 1. reference essays ---------- */

interface EssayData {
  id: string;
  theme: string;
  qualityBasis: QualityBasis;
  points: { point: string; type: ExtractedPoints["points"][number]["type"]; vec: number[] }[];
  sentences: { text: string; vec: number[] }[];
}

async function loadReferenceEssays(): Promise<EssayData[]> {
  const dir = path.join(DATA, "reference-raw");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".txt")).sort() : [];
  const parsed = files.map((f) => {
    try {
      return { f, ...parseReference(readFileSync(path.join(dir, f), "utf8"), themes.map((t) => t.key)) };
    } catch (e) {
      throw new Error(`${f} is not valid: ${e instanceof ReferenceError ? e.problems.join("; ") : (e as Error).message}. Run npm run validate:reference.`);
    }
  });

  const out: EssayData[] = [];
  for (const p of parsed) {
    const id = p.f.replace(/\.txt$/, "");
    console.log(`Essay ${id} (${p.meta.theme})`);
    const ex = await genValidated(
      `bm-essay-${id}-${sha(p.text).slice(0, 10)}.json`,
      `Read this essay on "${p.meta.topic}" and list up to ${BENCHMARK.MAX_POINTS_PER_ESSAY} DISTINCT key points it makes. ${POINT_RULES}\n\nESSAY:\n${p.text}`,
      extractedPointsResponseSchema,
      validate,
    );
    const sentences = splitSentences(p.text).map((s) => s.text);
    const [pointVecs, sentVecs] = [await embedCached(ex.points.map((x) => x.point)), await embedCached(sentences)];
    out.push({
      id,
      theme: p.meta.theme,
      qualityBasis: p.meta.qualityBasis,
      points: ex.points.map((x, i) => ({ point: x.point, type: x.type, vec: pointVecs[i] })),
      sentences: sentences.map((text, i) => ({ text, vec: sentVecs[i] })),
    });
    // Intermediate data for eval-benchmark (cache only; never committed).
    cacheWrite(`bm-essaydata-${id}.json`, { id, theme: p.meta.theme, qualityBasis: p.meta.qualityBasis, points: out.at(-1)!.points, sentenceVecs: sentVecs });
  }
  return out;
}

/* ---------- 2. checklist per theme ---------- */

async function checklist(theme: Theme): Promise<BenchmarkPoint[]> {
  const samples = theme.topicIds.slice(0, 4).map((id) => topics.find((t) => t.id === id)!.text);
  const ex = await genValidated(
    `bm-checklist-${theme.key}.json`,
    `You are a CSS (Pakistan Central Superior Services) English Essay examiner. List 10 to 12 key points an examiner would expect a strong essay on the theme "${theme.label}" to make, specific to Pakistan. Example topics under this theme: ${samples.join("; ")}. Cover a mix of causes, effects, Pakistan context, data, institutions, counter-arguments and ways forward. ${POINT_RULES}`,
    extractedPointsResponseSchema,
    validate,
  );
  const vecs = await embedCached(ex.points.map((x) => x.point));
  return ex.points.map((x, i) => ({
    point: x.point,
    type: x.type,
    origin: "llm-checklist" as const,
    madeByCount: null,
    ofN: null,
    sourceQualityBases: [],
    centroid: vecs[i],
  }));
}

/* ---------- main ---------- */

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set (see .env.example).");
  const assets = loadAssets();
  const essays = await loadReferenceEssays();
  console.log(essays.length ? `${essays.length} reference essay(s) loaded.` : "No reference essays found: building the AI checklist only. Reference coverage is unavailable.");

  const checklists = await pool(themes, 2, (t) => checklist(t));

  const outThemes: Benchmark["themes"] = themes.map((theme, ti) => {
    const mine = essays.filter((e) => e.theme === theme.key);
    const raw: RawPoint[] = mine.flatMap((e) => e.points.map((p) => ({ point: p.point, type: p.type, vec: p.vec, essayId: e.id, qualityBasis: e.qualityBasis })));
    const merged = raw.length ? mergeThemePoints(raw, mine.length, BENCHMARK.CLUSTER_THRESHOLD) : [];
    const topicVecs = theme.topicIds.map((id) => normalize(topics.find((t) => t.id === id)!.vec));
    const essayVecs = mine.map((e) => normalize(e.sentences[0].vec.map((_, i) => e.sentences.reduce((s, x) => s + x.vec[i], 0))));
    const all = [...topicVecs, ...essayVecs];
    const centroid = normalize(all[0].map((_, i) => all.reduce((s, v) => s + v[i], 0)));
    return { key: theme.key, label: theme.label, centroid: roundVec(centroid), nEssays: mine.length, points: [...merged, ...checklists[ti]] };
  });

  const features: Benchmark["profile"]["features"] = {};
  if (essays.length) {
    const profiles = essays.map((e) => essayProfile(e.sentences, { topicVecs: assets.topics.map((t) => t.vec), bankVecs: assets.bankVecs, model: assets.model }));
    for (const f of PROFILE_FEATURES) features[f] = distribution(profiles.map((p) => p[f]));
  }

  const countsBy = <K extends string>(key: (e: EssayData) => K) => essays.reduce<Record<string, number>>((m, e) => ((m[key(e)] = (m[key(e)] ?? 0) + 1), m), {});
  const benchmark: Benchmark = {
    meta: {
      builtAt: new Date().toISOString(),
      nEssays: essays.length,
      countsByQualityBasis: countsBy((e) => e.qualityBasis),
      countsByTheme: Object.fromEntries(themes.map((t) => [t.key, essays.filter((e) => e.theme === t.key).length])),
      embedding: { model: GEMINI_EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS },
      clusterThreshold: BENCHMARK.CLUSTER_THRESHOLD,
    },
    themes: outThemes,
    profile: { nEssays: essays.length, features },
  };
  assertNoLongPoints(benchmark);
  const json = JSON.stringify(benchmark);
  writeFileSync(path.join(DATA, "benchmark.json"), json);
  const pts = outThemes.flatMap((t) => t.points);
  console.log(`Wrote data/benchmark.json (${(json.length / 1024).toFixed(0)} KB): ${outThemes.length} themes, ${pts.filter((p) => p.origin === "reference").length} reference points, ${pts.filter((p) => p.origin === "llm-checklist").length} checklist points.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
