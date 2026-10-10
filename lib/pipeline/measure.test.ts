import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEssayStructure } from "../structure/index.ts";
import { ESSAY_A, ESSAY_A_SPECS, mockComplete } from "../structure/testkit.ts";
import { measureEssay, type MeasureDeps } from "./measure.ts";
import { essayFrom } from "./testkit.ts";
import { absenceConflict } from "./verifyQuotes.ts";
import { splitSentences } from "./sentences.ts";
import type { EssayAnalysis } from "./analyse.ts";
import type { BenchmarkResult } from "./benchmark.types.ts";

const essay = essayFrom(ESSAY_A);
const TOPIC = "Education in Pakistan";

const analysisFor = (): EssayAnalysis => ({
  paragraphs: essay.paragraphs.map((p) => ({ id: p.id, relevance: 95, rawSimilarity: 0.8, driftFlag: false, sentences: [], avgGenericScore: 0.3 })),
  genericShare: 0,
  specificityPer100Words: 2,
  driftingParagraphIds: [],
  embedTextCount: 0,
  unassessedSentences: 0,
});
const benchmarkOk = { status: "ok", coverage: { basis: "reference", nReferences: 3, total: 2, covered: 1, missing: [{ point: "teacher training" }], coveredPoints: [] }, profile: [], nProfileEssays: 3, disclaimers: [] } as unknown as BenchmarkResult;

/** Fake stages that really use the shared embed, as the real ones do. */
function fakes(over: MeasureDeps = {}): MeasureDeps {
  return {
    embed: async (texts) => texts.map((t) => [t.length, 1]),
    structure: (input) => analyzeEssayStructure(input, { complete: mockComplete(ESSAY_A_SPECS) }),
    analyse: async (topic, paragraphs, deps) => {
      await deps.embed!([topic, ...paragraphs.map((p) => p.text), ...paragraphs.flatMap((p) => splitSentences(p.text).map((s) => s.text))]);
      return analysisFor();
    },
    benchmark: async () => benchmarkOk,
    ...over,
  };
}

test("all stages succeed and their findings merge into one MeasuredFindings", async () => {
  const r = await measureEssay(essay, TOPIC, fakes());
  assert.deepEqual([r.structure.status, r.analysis.status, r.benchmark.status], ["ok", "ok", "ok"]);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(Object.keys(r.findings).sort(), ["benchmark", "drift", "genericness", "links", "rules", "structure"]);
  assert.deepEqual(r.findings.benchmark!.missingPoints, ["teacher training"]);
  assert.ok(r.structure.value!.argumentElements.length > 0, "the full structure analysis is returned alongside");
  assert.ok(absenceConflict("counter-argument", r.findings));
});

test("the three stages run concurrently, not one after another", async () => {
  let started = 0;
  let release!: () => void;
  const allStarted = new Promise<void>((res) => (release = res));
  const gate = async () => {
    if (++started === 3) release();
    await allStarted; // would never resolve if a stage waited for another to finish first
  };
  const r = await measureEssay(
    essay,
    TOPIC,
    fakes({
      structure: async (input) => (await gate(), analyzeEssayStructure(input, { complete: mockComplete(ESSAY_A_SPECS) })),
      analyse: async () => (await gate(), analysisFor()),
      benchmark: async () => (await gate(), benchmarkOk),
      timeoutsMs: { structure: 2000, analysis: 2000, benchmark: 2000 },
    }),
  );
  assert.equal(started, 3);
  assert.deepEqual([r.structure.status, r.analysis.status, r.benchmark.status], ["ok", "ok", "ok"]);
});

test("a structure failure is reported and the other findings survive", async () => {
  const r = await measureEssay(essay, TOPIC, fakes({ structure: async () => ({ ok: false, error: { code: "provider_error", message: "quota", retryable: true } }) }));
  assert.equal(r.structure.status, "failed");
  assert.match(r.warnings.join(" "), /Structure analysis unavailable: provider_error: quota/);
  assert.ok(r.findings.drift && r.findings.benchmark);
  assert.equal(r.findings.structure, undefined);
  assert.equal(absenceConflict("counter-argument", r.findings), null);
});

test("a thrown error in one stage does not stop the others", async () => {
  const r = await measureEssay(essay, TOPIC, fakes({ analyse: async () => { throw new Error("embedding quota"); } }));
  assert.equal(r.analysis.status, "failed");
  assert.match(r.warnings.join(" "), /Genericness and drift unavailable: embedding quota/);
  assert.ok(r.findings.structure && r.findings.benchmark);
  assert.equal(r.findings.drift, undefined);
});

test("a stage that never finishes is abandoned at its time limit", async () => {
  const r = await measureEssay(essay, TOPIC, fakes({ structure: () => new Promise(() => {}), timeoutsMs: { structure: 40 } }));
  assert.equal(r.structure.status, "failed");
  assert.match(r.structure.error!, /did not finish within/);
  assert.ok(r.findings.drift && r.findings.benchmark);
});

test("an unavailable benchmark adds a warning but no benchmark findings", async () => {
  const r = await measureEssay(essay, TOPIC, fakes({ benchmark: async () => ({ status: "unavailable", reason: "no reference data", profile: [], nProfileEssays: 0, disclaimers: [] }) as BenchmarkResult }));
  assert.equal(r.benchmark.status, "ok");
  assert.equal(r.findings.benchmark, undefined);
  assert.match(r.warnings.join(" "), /Benchmark unavailable: no reference data/);
});

test("stages that embed the same sentences share one request per text", async () => {
  const sent: string[] = [];
  const r = await measureEssay(
    essay,
    TOPIC,
    fakes({
      embed: async (texts) => (sent.push(...texts), texts.map((t) => [t.length, 1])),
      benchmark: async (input) => (assert.equal(input.sentences.every((s) => s.vec), true), benchmarkOk),
    }),
  );
  assert.equal(new Set(sent).size, sent.length, "no text was sent twice");
  assert.ok(r.embedding.requestedTexts > r.embedding.embeddedTexts, "the second stage reused the first stage's vectors");
});

test("structure is never run with semantic similarity (no embedding cost in the pipeline)", async () => {
  let received: unknown;
  await measureEssay(essay, TOPIC, fakes({ structure: async (input) => ((received = input), analyzeEssayStructure(input, { complete: mockComplete(ESSAY_A_SPECS) })) }));
  assert.equal((received as { useSemanticSimilarity?: boolean }).useSemanticSimilarity, undefined);
  assert.equal((received as { topic: string }).topic, TOPIC);
});
