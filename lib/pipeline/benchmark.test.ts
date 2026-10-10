import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BENCHMARK } from "../config.ts";
import { assertNoLongPoints, benchmarkSchema, PROFILE_FEATURES, type Benchmark, type BenchmarkPoint } from "./benchmark.types.ts";
import { benchmarkEssay, coverageOf, pointsToUse } from "./benchmark.ts";
import { clusterPoints, mergeThemePoints, type RawPoint } from "./cluster.ts";
import type { Assets } from "./dataFiles.ts";
import { FEATURE_NAMES } from "./features.ts";
import type { GenericnessModel } from "./genericness.ts";
import { position, profileNote } from "./profile.ts";
import { ReferenceError, parseReference } from "./reference.ts";
import { normalize } from "./vecmath.ts";

const KEYS = ["governance", "climate-water"];
const essayText = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
const fm = (over: Record<string, string | null> = {}) => {
  const f: Record<string, string | null> = { title: "T", topic: "Water", theme: "climate-water", source: "self-written: A", permission: "own", quality_basis: "self-written", ...over };
  return `---\n${Object.entries(f).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n${essayText}`;
};

test("front matter parses and validates", () => {
  const r = parseReference(fm(), KEYS);
  assert.equal(r.meta.theme, "climate-water");
  assert.equal(r.meta.qualityBasis, "self-written");
  assert.equal(r.text.split(" ").length, 200);
  assert.doesNotThrow(() => parseReference(fm({ permission: "openly-licensed:CC-BY-4.0" }), KEYS));
});

test("reference intake rejects missing permission or quality_basis, bad values and bad structure", () => {
  const problems = (raw: string) => { try { parseReference(raw, KEYS); } catch (e) { return (e as ReferenceError).problems; } return []; };
  assert.deepEqual(problems(fm({ permission: null })), ["missing permission"]);
  assert.deepEqual(problems(fm({ quality_basis: null })), ["missing quality_basis"]);
  assert.match(problems(fm({ permission: "maybe" }))[0], /invalid permission/);
  assert.match(problems(fm({ quality_basis: "vibes" }))[0], /invalid quality_basis/);
  assert.match(problems(fm({ theme: "cricket" }))[0], /unknown theme/);
  assert.match(problems("no front matter at all")[0], /missing front matter/);
  assert.match(problems(fm().replace(essayText, "too short"))[0], /shorter than 150 words/);
  assert.equal(problems(fm({ permission: null, quality_basis: null })).length, 2, "reports every problem");
});

const v = (...x: number[]) => normalize(x);
const rp = (point: string, vec: number[], essayId: string, qualityBasis: RawPoint["qualityBasis"] = "self-written"): RawPoint => ({ point, type: "cause", vec, essayId, qualityBasis });

test("clustering merges near-duplicates across essays and counts distinct essays", () => {
  const pts = [
    rp("Floods damage crops", v(1, 0.05, 0), "e1"),
    rp("Flooding destroys harvests", v(1, 0.1, 0), "e2", "academy-sample"),
    rp("Floods ruin farmland", v(1, 0, 0.05), "e3"),
    rp("Debt limits spending", v(0, 1, 0), "e1"),
    rp("Debt crowds out budgets", v(0, 1, 0.02), "e2"),
    rp("Solar power is growing", v(0, 0, 1), "e1"),
  ];
  const merged = mergeThemePoints(pts, 3, 0.85);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((m) => m.madeByCount), [3, 2, 1], "sorted by madeByCount desc");
  assert.ok(merged.every((m) => m.ofN === 3 && m.origin === "reference"));
  assert.deepEqual(merged[0].sourceQualityBases, ["academy-sample", "self-written"]);
  assert.ok(["Floods damage crops", "Flooding destroys harvests", "Floods ruin farmland"].includes(merged[0].point));
  assert.ok(merged[0].centroid.every((x) => Number.isFinite(x)));
});

test("points from the same essay are never merged, and a high threshold keeps everything apart", () => {
  const same = [rp("A", v(1, 0), "e1"), rp("B", v(1, 0.01), "e1")];
  assert.equal(clusterPoints(same, 0.85).length, 2);
  const diff = [rp("A", v(1, 0), "e1"), rp("B", v(1, 0.3), "e2")];
  assert.equal(clusterPoints(diff, 0.99).length, 2);
  assert.equal(clusterPoints(diff, 0.9).length, 1);
});

const bp = (point: string, vec: number[], madeBy: number | null, origin: BenchmarkPoint["origin"] = "reference"): BenchmarkPoint => ({
  point, type: "cause", origin, madeByCount: madeBy, ofN: madeBy === null ? null : 5, sourceQualityBases: [], centroid: vec,
});

test("coverage: covered vs missing, ordering by madeByCount, nulls last, listing capped", () => {
  const points = [bp("alpha", v(1, 0, 0), 2), bp("beta", v(0, 1, 0), 5), bp("gamma", v(0, 0, 1), 4), bp("delta", v(1, 1, 1), null, "llm-checklist")];
  const sentences = [v(1, 0, 0), v(0.05, 0, 1)]; // covers alpha and gamma
  const c = coverageOf(points, sentences, 0.62);
  assert.equal(c.total, 4);
  assert.equal(c.covered, 2);
  assert.deepEqual(c.coveredPoints.map((p) => p.point), ["gamma", "alpha"]);
  assert.deepEqual(c.missing.map((p) => p.point), ["beta", "delta"], "5 before null");
  assert.ok(c.missing[0].bestSimilarity < 0.62);
  const many = Array.from({ length: 12 }, (_, i) => bp(`p${i}`, v(0, 1, 0), i + 1));
  assert.equal(coverageOf(many, [v(1, 0, 0)], 0.62).missing.length, BENCHMARK.MAX_LISTED);
});

test("point selection: checklist below 3 essays, reference with enough, mixed in between", () => {
  const mk = (n: number, refs: number): Benchmark["themes"][number] => ({
    key: "t", label: "T", centroid: [1, 0, 0], nEssays: n,
    points: [...Array.from({ length: refs }, (_, i) => bp(`r${i}`, v(1, i + 1, 0), 3)), bp("c1", v(0, 0, 1), null, "llm-checklist")],
  });
  assert.equal(pointsToUse(mk(2, 10)).basis, "llm-checklist");
  assert.equal(pointsToUse(mk(5, 10)).basis, "reference");
  assert.equal(pointsToUse(mk(3, 3)).basis, "mixed");
  assert.equal(pointsToUse(mk(5, 0)).basis, "llm-checklist");
});

test("profile position bands and notes", () => {
  const d = { n: 10, median: 5, q1: 4, q3: 6, min: 2, max: 9 };
  assert.equal(position(3.9, d), "below");
  assert.equal(position(4, d), "within");
  assert.equal(position(6, d), "within");
  assert.equal(position(6.1, d), "above");
  assert.match(profileNote("specifics", "below", d), /Below.*Reference essays usually score higher here/);
  assert.doesNotMatch(profileNote("specifics", "above", d), /usually score/);
  assert.match(profileNote("cliches", "above", d), /usually score lower/);
  assert.match(profileNote("meanSentenceLength", "above", d), /Neither direction is better/);
  assert.match(profileNote("genericShare", "within", d), /Within the middle half/);
});

function fakeBenchmark(nEssays: number): Benchmark {
  const dist = { n: nEssays, median: 0.5, q1: 0.3, q3: 0.7, min: 0.1, max: 0.9 };
  return {
    meta: { builtAt: "x", nEssays, countsByQualityBasis: nEssays ? { "self-written": nEssays } : {}, countsByTheme: {}, embedding: { model: "m", dimensions: 3 }, clusterThreshold: 0.85 },
    themes: [
      { key: "climate-water", label: "Climate", centroid: v(1, 0, 0), nEssays, points: [bp("Floods hurt farms", v(1, 0.1, 0), null, "llm-checklist"), bp("Debt rises", v(0, 1, 0), null, "llm-checklist")] },
      { key: "economy", label: "Economy", centroid: v(0, 1, 0), nEssays: 0, points: [bp("Taxes are low", v(0, 1, 0.1), null, "llm-checklist")] },
    ],
    profile: { nEssays, features: nEssays ? Object.fromEntries(PROFILE_FEATURES.map((f) => [f, dist])) : {} },
  };
}
const fakeAssets = (): Assets => ({
  topics: [{ id: "t", theme: "x", text: "x", vec: v(1, 0, 0) }],
  bankVecs: [v(0, 0, 1)],
  model: {
    featureNames: [...FEATURE_NAMES], means: new Array(8).fill(0), stds: new Array(8).fill(1), weights: new Array(8).fill(0), bias: 0,
    metrics: { train: { accuracy: 1, precision: 1, recall: 1, auc: 1, n: 1 }, test: { accuracy: 1, precision: 1, recall: 1, auc: 1, n: 1 } },
    trainedOn: { train: 1, test: 1, bank: 1 }, synthetic: true,
    reasonThresholds: { top1BankSim: 0.9, universalityMargin: 1 }, levelThresholds: { generic: 0.65, specific: 0.35 },
  },
});
const input = { topic: "Floods", topicVec: v(1, 0, 0), sentences: [{ text: "Floods hurt the farms of Punjab badly.", vec: v(1, 0.1, 0) }, { text: "Other sentence here.", vec: v(0.9, 0.2, 0) }] };

test("benchmarkEssay with only a checklist is partial, never claims references, and states limits", async () => {
  const r = await benchmarkEssay(input, { benchmark: fakeBenchmark(0), assets: fakeAssets() });
  assert.equal(r.status, "partial");
  assert.match(r.reason ?? "", /No reference essays/);
  assert.equal(r.theme?.key, "climate-water");
  assert.equal(r.coverage?.basis, "llm-checklist");
  assert.equal(r.coverage?.nReferences, 0);
  assert.equal(r.coverage?.covered, 1);
  assert.equal(r.coverage?.missing[0].point, "Debt rises");
  assert.deepEqual(r.profile, []);
  assert.ok(r.disclaimers.some((d) => /AI model/.test(d)) && r.disclaimers.some((d) => /does not affect your score/.test(d)) && r.disclaimers.some((d) => /not marked exam scripts/.test(d)));
});

test("benchmarkEssay with a few reference essays adds the profile and the indicative-only note", async () => {
  const r = await benchmarkEssay(input, { benchmark: fakeBenchmark(5), assets: fakeAssets() });
  assert.equal(r.status, "ok");
  assert.equal(r.profile.length, PROFILE_FEATURES.length);
  assert.ok(r.profile.every((p) => ["below", "within", "above"].includes(p.position)));
  assert.equal(r.nProfileEssays, 5);
  assert.ok(r.disclaimers.some((d) => /Indicative only/.test(d)));
  const big = await benchmarkEssay(input, { benchmark: fakeBenchmark(BENCHMARK.INDICATIVE_BELOW), assets: fakeAssets() });
  assert.ok(!big.disclaimers.some((d) => /Indicative only/.test(d)));
});

test("benchmarkEssay skips coverage when no theme matches, and reports unavailable instead of faking", async () => {
  const off = await benchmarkEssay({ ...input, topicVec: v(0, 0, 1), sentences: [{ text: "Unrelated.", vec: v(0, 0, 1) }] }, { benchmark: fakeBenchmark(0), assets: fakeAssets() });
  assert.equal(off.status, "partial");
  assert.equal(off.coverage, undefined);
  assert.match(off.reason ?? "", /does not clearly match/);
  assert.equal((await benchmarkEssay({ ...input, sentences: [] }, { benchmark: fakeBenchmark(0) })).status, "unavailable");
  assert.equal((await benchmarkEssay(input, { benchmark: { ...fakeBenchmark(0), themes: [] } })).status, "unavailable");
});

test("benchmarkEssay embeds only missing sentence vectors, in one batch", async () => {
  let calls = 0;
  let sent: string[] = [];
  const r = await benchmarkEssay(
    { ...input, sentences: [{ text: "has vec", vec: v(1, 0, 0) }, { text: "needs vec" }, { text: "needs vec too" }] },
    { benchmark: fakeBenchmark(0), assets: fakeAssets(), embed: async (t) => ((calls++, (sent = t)), t.map(() => v(1, 0.1, 0))) },
  );
  assert.equal(calls, 1);
  assert.deepEqual(sent, ["needs vec", "needs vec too"]);
  assert.equal(r.theme?.key, "climate-water");
});

test("stored points are paraphrases: no point may exceed the word limit", () => {
  const long = Array.from({ length: BENCHMARK.MAX_POINT_WORDS + 1 }, () => "word").join(" ");
  const bad = fakeBenchmark(0);
  bad.themes[0].points.push(bp(long, v(1, 0, 0), null, "llm-checklist"));
  assert.throws(() => assertNoLongPoints(bad), /too long/);
  assert.equal(benchmarkSchema.safeParse(bad).success, false);
  assert.doesNotThrow(() => assertNoLongPoints(fakeBenchmark(0)));
});

test("data/benchmark.json (if built) is valid, has no long points and contains no essay text", () => {
  const p = path.join(process.cwd(), "data", "benchmark.json");
  if (!existsSync(p)) return;
  const raw = readFileSync(p, "utf8");
  const b = benchmarkSchema.parse(JSON.parse(raw));
  assertNoLongPoints(b);
  assert.ok(!/"text"\s*:/.test(raw), "benchmark.json must not store essay text");
  assert.ok(raw.length < 3 * 1024 * 1024, "benchmark.json should stay small");
  assert.ok(b.themes.every((t) => t.points.every((pt) => pt.centroid.length === b.meta.embedding.dimensions)));
});
