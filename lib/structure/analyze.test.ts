import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEssayStructure } from "./analyze.ts";
import { STRUCTURE_SCHEMA_VERSION } from "./config.ts";
import { normalizeEssay } from "./normalize.ts";
import { structureAnalysisSchema } from "./schema.ts";
import type { CompleteFn } from "./extract.ts";
import { ESSAY_A, ESSAY_A_SPECS, mockComplete, rawElements } from "./testkit.ts";

const NOW = () => new Date("2026-01-01T00:00:00Z");
const never: CompleteFn = async () => {
  throw new Error("model must not be called");
};

test("end to end: a clean essay produces a validated, schema-conformant analysis", async () => {
  const out = await analyzeEssayStructure({ text: ESSAY_A, topic: "Education in Pakistan" }, { complete: mockComplete(ESSAY_A_SPECS), now: NOW });
  assert.ok(out.ok);
  if (!out.ok) return;
  const r = out.result;
  assert.equal(r.schemaVersion, STRUCTURE_SCHEMA_VERSION);
  assert.equal(r.analysisMetadata.confidenceCalibration, "uncalibrated_heuristic");
  assert.equal(r.essayMetadata.sentenceCount, 7);
  assert.equal(r.argumentElements.length, 7);
  assert.equal(r.analysisMetadata.integrity.passed, true);
  assert.ok(r.analysisMetadata.integrity.checks > 20);
  assert.equal(r.analysisMetadata.linking.method, "rule_based");
  assert.equal(r.analysisMetadata.profile, null);
  assert.ok(structureAnalysisSchema.safeParse(r).success);
  assert.ok(r.argumentLinks.every((l) => l.status === "candidate"));
  for (const e of r.argumentElements) assert.equal(ESSAY_A.slice(e.start, e.end), e.text);
  assert.deepEqual(r.structuralFindings.filter((f) => f.type !== "uncertain_classification"), []);
});

test("is deterministic for the same essay and model output", async () => {
  const run = () => analyzeEssayStructure({ text: ESSAY_A }, { complete: mockComplete(ESSAY_A_SPECS), now: NOW });
  assert.deepEqual(await run(), await run());
});

test("imperfect parsed text with odd punctuation still analyses and keeps exact offsets", async () => {
  const text = "  water   is vital!!  but  nobody cares...\r\n\r\n\r\n   secondly , we waste it .  \r\n";
  const n = normalizeEssay(text);
  const out = await analyzeEssayStructure({ text }, { complete: mockComplete([{ s: n.sentences[0].id, role: "claim", conf: 0.6 }]), now: NOW });
  assert.ok(out.ok);
  if (!out.ok) return;
  for (const s of out.result.sentences) assert.equal(text.slice(s.start, s.end), s.text);
  assert.ok(out.result.analysisMetadata.warnings.length > 0);
});

test("empty and punctuation-only input fail before calling the model", async () => {
  for (const text of ["", "   \n\t ", "...!!!"]) {
    const out = await analyzeEssayStructure({ text }, { complete: never });
    assert.ok(!out.ok && out.error.code === "empty_input", JSON.stringify(text));
  }
  const bad = await analyzeEssayStructure({ text: 42 } as never, { complete: never });
  assert.ok(!bad.ok && bad.error.code === "invalid_input");
  const big = await analyzeEssayStructure({ text: "Word. ".repeat(10_000) }, { complete: never });
  assert.ok(!big.ok && big.error.code === "input_too_large");
});

test("provider failures become typed errors; retryability follows the status", async () => {
  const boom = (status?: number): CompleteFn => async () => {
    throw Object.assign(new Error("upstream down"), status ? { status } : {});
  };
  const a = await analyzeEssayStructure({ text: ESSAY_A }, { complete: boom(503) });
  assert.ok(!a.ok && a.error.code === "provider_error" && a.error.retryable);
  const b = await analyzeEssayStructure({ text: ESSAY_A }, { complete: boom(400) });
  assert.ok(!b.ok && b.error.code === "provider_error" && !b.error.retryable);
});

test("invalid model JSON is retried once, then fails explicitly; no report is invented", async () => {
  let calls = 0;
  const out = await analyzeEssayStructure({ text: ESSAY_A }, { complete: async () => (calls++, "Sorry, I cannot do that.") });
  assert.ok(!out.ok && out.error.code === "model_output_invalid");
  assert.equal(calls, 2);
});

test("a retry can recover from one bad response and reports the attempts", async () => {
  let calls = 0;
  const good = JSON.stringify({ elements: rawElements(ESSAY_A_SPECS) });
  const out = await analyzeEssayStructure({ text: ESSAY_A }, { complete: async (req) => (calls++ === 0 ? "{ nope" : (assert.match(req.prompt, /previous answer was rejected/), good)) });
  assert.ok(out.ok);
  if (out.ok) assert.equal(out.result.analysisMetadata.extractor.attempts, 2);
});

test("fabricated sentence ids and bad elements are rejected individually, valid ones kept", async () => {
  const response = JSON.stringify({
    elements: [
      { sentenceIds: ["s2"], role: "thesis", confidence: 0.9 },
      { sentenceIds: ["s99"], role: "claim", confidence: 0.9 },
      { sentenceIds: ["s3"], role: "wizard", confidence: 0.9 },
      { sentenceIds: ["s3"], role: "claim", confidence: 7 },
      { sentenceIds: ["s3", "s5"], role: "claim", confidence: 0.9 },
      { sentenceIds: ["s2", "s3"], role: "claim", confidence: 0.9 },
      { sentenceIds: ["s1", "s3"], role: "claim", confidence: 0.9 },
      { role: "claim" },
      { sentenceIds: ["s2"], role: "claim", confidence: 0.4 },
      { sentenceIds: ["s3"], role: "claim", confidence: 0.8 },
    ],
  });
  const out = await analyzeEssayStructure({ text: ESSAY_A }, { complete: async () => response, now: NOW });
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.deepEqual(out.result.argumentElements.map((e) => e.sentenceIds), [["s2"], ["s3"]]);
  const codes = out.result.analysisMetadata.rejectedElements.map((r) => r.code);
  for (const c of ["unknown_sentence_id", "invalid_role", "invalid_confidence", "non_contiguous_span", "cross_paragraph_span", "malformed_element", "overlapping_element"])
    assert.ok(codes.includes(c), c);
});

test("a response where every element is fabricated is a failure, not an empty report", async () => {
  const out = await analyzeEssayStructure({ text: ESSAY_A }, { complete: async () => JSON.stringify({ elements: [{ sentenceIds: ["s50"], role: "claim", confidence: 0.9 }] }) });
  assert.ok(!out.ok && out.error.code === "model_output_invalid");
});

test("a model that labels nothing yields missing-thesis and missing-conclusion observations", async () => {
  const out = await analyzeEssayStructure({ text: ESSAY_A }, { complete: async () => JSON.stringify({ elements: [] }), now: NOW });
  assert.ok(out.ok);
  if (out.ok) assert.deepEqual(out.result.structuralFindings.map((f) => f.type), ["missing_thesis", "missing_conclusion"]);
});

test("model output cannot alter essay text: element text always comes from the source", async () => {
  const out = await analyzeEssayStructure(
    { text: ESSAY_A },
    { complete: async () => JSON.stringify({ elements: [{ sentenceIds: ["s2"], role: "thesis", confidence: 0.9, text: "REWRITTEN" }] }) },
  );
  assert.ok(out.ok);
  if (out.ok) assert.ok(!out.result.argumentElements[0].text.includes("REWRITTEN"));
});

test("multi-sentence elements span adjacent sentences and keep exact text", async () => {
  const out = await analyzeEssayStructure({ text: ESSAY_A }, { complete: mockComplete([{ s: ["s3", "s4"], role: "claim" }]) });
  assert.ok(out.ok);
  if (out.ok) {
    const e = out.result.argumentElements[0];
    assert.equal(ESSAY_A.slice(e.start, e.end), e.text);
    assert.ok(e.text.startsWith("Investment") && e.text.endsWith("sharply."));
  }
});

test("semantic similarity: used when an embedder is supplied, falls back with a warning when it fails or is absent", async () => {
  const input = { text: ESSAY_A, useSemanticSimilarity: true };
  const complete = mockComplete(ESSAY_A_SPECS);
  const ok = await analyzeEssayStructure(input, { complete, embed: async (t) => t.map((_, i) => [1, i * 0.01]) });
  assert.ok(ok.ok && ok.result.analysisMetadata.linking.embeddingUsed);
  const failed = await analyzeEssayStructure(input, { complete, embed: async () => { throw new Error("quota"); } });
  assert.ok(failed.ok && !failed.result.analysisMetadata.linking.embeddingUsed);
  if (failed.ok) assert.ok(failed.result.analysisMetadata.warnings.some((w) => w.code === "semantic_failed"));
  const absent = await analyzeEssayStructure(input, { complete });
  assert.ok(absent.ok);
  if (absent.ok) assert.ok(absent.result.analysisMetadata.warnings.some((w) => w.code === "semantic_unavailable"));
});
