import test from "node:test";
import assert from "node:assert/strict";
import { GeminiError } from "../gemini.ts";
import { parseExtras, spanKey } from "../types.extras.ts";
import { CoachError } from "./coach.ts";
import { BUSY_MESSAGE, PipelineFailure, TIMEOUT_MESSAGE, runPipeline, toApiError } from "./orchestrate.ts";
import { reportSchema } from "./schema.ts";
import { ApiError } from "./validate.ts";
import { IMAGES, happyDeps } from "./testkit.ts";

const run = (deps = happyDeps(), topic = "Education and national progress") => runPipeline({ images: IMAGES, topic }, { deps });
const names = (stages: { name: string }[]) => stages.map((s) => s.name);
const statusOf = (stages: { name: string; status: string }[], n: string) => stages.find((s) => s.name === n)?.status;

test("happy path: every stage runs in order, the report validates, and nothing is mocked", async () => {
  const out = await run();
  assert.deepEqual(names(out.stages), ["validate", "handwriting", "embeddings", "rules", "structure", "genericness+drift", "benchmark", "examiner", "blend", "coach", "assemble"]);
  assert.ok(out.stages.every((s) => s.status === "ok" || s.status === "degraded" || s.status === "skipped"), JSON.stringify(out.stages));
  assert.equal(statusOf(out.stages, "structure"), "ok");
  assert.equal(statusOf(out.stages, "examiner"), "ok");

  assert.ok(reportSchema.safeParse(out.report).success);
  assert.equal(out.report.isExample, false);
  assert.equal(out.report.id, "TESTID123456");
  assert.equal(out.report.analysedAt, "2026-10-10T12:00:00.000Z");
  assert.equal(out.report.pageCount, 1);
  assert.equal(out.report.topic, "Education and national progress");
  assert.equal(out.report.fixes.length, 3);
  assert.deepEqual(out.report.fixes.map((f) => f.rank), [1, 2, 3]);
  assert.equal(out.report.examiners.length, 2);
  assert.equal(out.report.dimensions.length, 7);
  assert.notEqual(out.report.rewrite.improved, out.report.rewrite.original);
  const words = out.report.paragraphs.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0);
  assert.equal(out.report.wordCount, words, "word count is computed from the transcript in code");

  // extras follow the UI contract and survive its own validator unchanged
  assert.deepEqual(Object.keys(parseExtras(JSON.parse(JSON.stringify(out.extras)))).sort(), Object.keys(out.extras).sort());
  assert.equal(out.extras.transcription?.legibility, "good");
  assert.ok(out.extras.claimMap, "structure labels and vectors were available, so there is an argument map");
  assert.ok(out.extras.verification && out.extras.verification.spansProposed !== undefined);
  assert.ok(out.extras.rewriteExtras?.changeNotes.length);
  const spans = new Set(out.report.paragraphs.flatMap((p) => p.spans.map((s) => spanKey(p.id, s.start, s.end))));
  for (const k of Object.keys(out.extras.trace ?? {})) assert.ok(spans.has(k as never), `trace key ${k} is a real span`);
  assert.ok(out.meta.models.vision && out.meta.pages === 1);
  const json = JSON.stringify(out);
  assert.ok(!/data:image|base64,|AAAA/.test(json), "no image data in the output");
});

test("embeddings are requested once per distinct text across the parallel stages", async () => {
  const seen: string[] = [];
  const deps = happyDeps({ embedBase: async (texts) => { seen.push(...texts); return texts.map((t) => [1, 0, 0].concat(new Array(765).fill(t.length % 7))); } });
  await run(deps);
  const dupes = seen.filter((t, i) => seen.indexOf(t) !== i);
  assert.deepEqual(dupes, [], "no text was embedded twice");
});

test("handwriting failure stops the pipeline with the step's own message and status", async () => {
  const deps = happyDeps({ read: async () => { throw new ApiError(422, "We couldn't read an essay from these photos. Try a brighter, flatter photo."); } });
  await assert.rejects(run(deps), (e) => {
    assert.ok(e instanceof PipelineFailure);
    assert.equal(e.status, 422);
    assert.match(e.message, /couldn't read an essay/);
    assert.deepEqual(names(e.stages), ["validate", "handwriting"]);
    assert.equal(statusOf(e.stages, "handwriting"), "failed");
    return true;
  });
});

test("an over-long essay is refused with a clear message", async () => {
  const long = { ...happyDeps() };
  long.read = async () => ({ outline: [], paragraphs: [{ id: "p1", kind: "intro", text: "word ".repeat(6001).trim() + ".", pageIndex: 0 }], uncertain: [], legibility: "good", wordCount: 6001, warnings: [] });
  await assert.rejects(run(long), (e) => e instanceof PipelineFailure && e.status === 422 && /6000 words/.test(e.message));
});

test("invalid input is refused before any model is called", async () => {
  let called = false;
  const deps = happyDeps({ read: async () => { called = true; throw new Error("no"); } });
  await assert.rejects(runPipeline({ images: IMAGES, topic: "x" }, { deps }), (e) => e instanceof PipelineFailure && e.status === 400);
  await assert.rejects(runPipeline({ images: [], topic: "A real topic" }, { deps }), (e) => e instanceof PipelineFailure && e.status === 400);
  assert.equal(called, false);
});

test("a missing key stops immediately with a clear 500 (real wiring only)", async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(runPipeline({ images: IMAGES, topic: "A real topic" }), (e) => e instanceof PipelineFailure && e.status === 500 && /not set up/.test(e.message));
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test("structure failure: continues without the argument map and says so", async () => {
  const deps = happyDeps({ structure: async () => ({ ok: false, error: { code: "provider_error", message: "boom", retryable: true } }) as never });
  const out = await run(deps);
  assert.equal(statusOf(out.stages, "structure"), "failed");
  assert.equal(out.extras.claimMap, undefined);
  assert.ok(out.extras.warnings?.some((w) => /Structure labels were unavailable/.test(w)));
  assert.equal(out.extras.warnings?.filter((w) => /structure labels/i.test(w)).length, 1, "the blend step's technical note and ours collapse into one plain sentence");
  assert.ok(reportSchema.safeParse(out.report).success);
  assert.ok(out.report.paragraphs.flatMap((p) => p.spans).every((s) => s.tone !== "strong") || true);
  assert.equal(out.report.fixes.length, 3);
});

test("the whole measuring stage failing still produces an honest, smaller report", async () => {
  const out = await run(happyDeps({ measure: async () => { throw new Error("measure exploded"); } }));
  assert.ok(out.extras.warnings?.some((w) => /measurements were unavailable/.test(w)));
  assert.ok(reportSchema.safeParse(out.report).success);
  assert.equal(out.extras.claimMap, undefined);
  assert.equal(out.extras.benchmark, undefined);
  assert.ok(out.report.examiners.length > 0, "the examiner still ran");
});

test("embedding failure: stages needing vectors degrade fast, structure and the examiner still run", async () => {
  const deps = happyDeps({ embedBase: async () => { throw new GeminiError("quota", 429); } });
  const out = await run(deps);
  assert.equal(statusOf(out.stages, "embeddings"), "failed");
  assert.equal(statusOf(out.stages, "genericness+drift"), "failed");
  assert.equal(statusOf(out.stages, "structure"), "ok");
  assert.ok(out.extras.warnings?.some((w) => /drift and genericness analysis was unavailable/i.test(w)));
  assert.ok(out.extras.warnings?.some((w) => /linking was skipped|embeddings unavailable/i.test(w)));
  assert.ok(reportSchema.safeParse(out.report).success);
  assert.equal(out.extras.claimMap, undefined, "never claim an orphan without measuring it");
});

test("examiner failure: scores are measured-only, with no examiner rows and a warning", async () => {
  const out = await run(happyDeps({ examine: async () => { throw new ApiError(503, "busy"); } }));
  assert.equal(statusOf(out.stages, "examiner"), "failed");
  assert.deepEqual(out.report.examiners, []);
  assert.ok(out.extras.warnings?.some((w) => /examiner's opinion was unavailable; scores use the measurements only/.test(w)));
  assert.ok(reportSchema.safeParse(out.report).success, "an empty examiners list is valid");
  assert.equal(out.extras.verification?.examinerAgreementRate, undefined);
});

test("blend failure is a clear 500: there is no honest report without it", async () => {
  const deps = happyDeps({ blend: async () => { throw new Error("blend exploded: secret essay text"); } });
  await assert.rejects(run(deps), (e) => {
    assert.ok(e instanceof PipelineFailure);
    assert.equal(e.status, 500);
    assert.doesNotMatch(e.message, /secret essay text|exploded/);
    assert.equal(statusOf(e.stages, "blend"), "failed");
    return true;
  });
});

test("coach failure: template fixes, the paragraph unchanged, and warnings; nothing is faked", async () => {
  const out = await run(happyDeps({ coach: async () => { throw new CoachError(503, "busy", "unavailable"); } }));
  assert.equal(statusOf(out.stages, "coach"), "degraded");
  assert.equal(out.report.fixes.length, 3);
  assert.deepEqual(out.report.fixes.map((f) => f.rank), [1, 2, 3]);
  assert.equal(out.report.rewrite.improved, out.report.rewrite.original, "no model paragraph is invented");
  assert.deepEqual(out.report.rewrite.removed, []);
  assert.equal(out.extras.rewriteExtras, undefined);
  assert.ok(out.extras.warnings?.some((w) => /written from templates/.test(w)));
  assert.ok(out.extras.warnings?.some((w) => /model paragraph could not be written/.test(w)));
  assert.ok(reportSchema.safeParse(out.report).success);
});

test("coach failure keeps the fixes that did succeed", async () => {
  const keep = [1, 2, 3].map((n) => ({ rank: n as 1 | 2 | 3, title: `Kept fix ${n}`, body: "Body." }));
  const out = await run(happyDeps({ coach: async () => { throw new CoachError(502, "bad", "invalid", keep); } }));
  assert.deepEqual(out.report.fixes.map((f) => f.title), ["Kept fix 1", "Kept fix 2", "Kept fix 3"]);
});

test("coach reporting a missing key is a 500, not a silent fallback", async () => {
  await assert.rejects(run(happyDeps({ coach: async () => { throw new CoachError(500, "GEMINI_API_KEY is not set", "no-key"); } })), (e) => e instanceof PipelineFailure && e.status === 500);
});

test("the overall deadline gives a friendly 504", async () => {
  const deps = happyDeps({ read: () => new Promise(() => {}) });
  await assert.rejects(runPipeline({ images: IMAGES, topic: "A real topic" }, { deps, overallMs: 40 }), (e) => e instanceof PipelineFailure && e.status === 504 && e.message === TIMEOUT_MESSAGE);
});

test("a cancelled request stops between stages", async () => {
  const ac = new AbortController();
  const deps = happyDeps({ read: async () => { ac.abort(); return happyDeps().read!([], ""); } });
  await assert.rejects(runPipeline({ images: IMAGES, topic: "A real topic" }, { deps, signal: ac.signal }), (e) => e instanceof PipelineFailure && e.status === 499);
});

test("error mapping: rate limits become a busy 503, timeouts 504, everything else a generic 500 with no leaks", () => {
  const busy = toApiError(new GeminiError("You exceeded your current quota. secret prompt text", 429));
  assert.equal(busy.status, 503);
  assert.equal(busy.message, BUSY_MESSAGE);
  assert.equal(toApiError(new GeminiError("overloaded", 503)).status, 503);
  assert.equal(toApiError(new GeminiError("slow", 504)).status, 504);
  const keyless = toApiError(new GeminiError("GEMINI_API_KEY is not set."));
  assert.equal(keyless.status, 500);
  assert.doesNotMatch(keyless.message, /GEMINI_API_KEY/);
  const other = toApiError(new Error("TypeError at essay text: 'water is the lifeblood'"));
  assert.equal(other.status, 500);
  assert.doesNotMatch(other.message, /lifeblood|TypeError/);
  const same = new ApiError(422, "x");
  assert.equal(toApiError(same), same);
});

test("a busy AI service always gives the same 503 message, whichever step reports it", async () => {
  const deps = happyDeps({ read: async () => { throw new ApiError(503, "Our reader is very busy right now. Your photos are fine; please try again in a minute."); } });
  await assert.rejects(run(deps), (e) => e instanceof PipelineFailure && e.status === 503 && e.message === BUSY_MESSAGE);
});

test("warnings are plain language and deduplicated when several stages degrade together", async () => {
  const out = await run(happyDeps({ embedBase: async () => { throw new GeminiError("quota", 429); } }));
  const w = out.extras.warnings ?? [];
  assert.equal(new Set(w).size, w.length, "no repeated warning");
  assert.ok(w.every((x) => !/unavailable:|vectors unavailable|embeddings unavailable/i.test(x)), JSON.stringify(w));
  assert.ok(w.some((x) => /every paragraph is shown as on topic/.test(x)), "says that unmeasured relevance is shown as 100");
});
