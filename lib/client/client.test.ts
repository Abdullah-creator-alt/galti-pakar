import test from "node:test";
import assert from "node:assert/strict";
import { COMPRESS_STEPS, MAX_TOTAL_BYTES, fitDimensions, fitToBudget, formatBytes } from "./compressImages.ts";
import { excerptOf, sliceRef } from "./excerpts.ts";
import { apiErrorMessage, makeId, parseAnalyzeResponse, UNEXPECTED_FORMAT } from "./response.ts";
import { clearSubmission, setSubmission, startAnalysis } from "./analysisStore.ts";
import { mockBundle } from "../mock-extras.ts";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/* ---------- compression ---------- */

test("fitDimensions: longest side capped, aspect kept, never enlarged", () => {
  assert.deepEqual(fitDimensions(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitDimensions(3000, 4000, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(fitDimensions(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(fitDimensions(1600, 1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(fitDimensions(10, 5000, 1200), { width: 2, height: 1200 });
  assert.deepEqual(fitDimensions(0, 0, 1600), { width: 1, height: 1 });
});

test("size-budget loop: first step fits, so nothing is re-encoded", async () => {
  const calls: number[] = [];
  const r = await fitToBudget(3, async (p, step) => (calls.push(step.maxSide), { size: 1_000_000, p }), { budget: 3_800_000 });
  assert.ok(r.ok);
  assert.equal(r.stepIndex, 0);
  assert.equal(r.total, 3_000_000);
  assert.deepEqual(calls, [1600, 1600, 1600]);
  assert.deepEqual(r.items.map((i) => i.p), [0, 1, 2], "page order kept");
});

test("size-budget loop: re-encodes ALL pages at the next step until the total fits", async () => {
  const sizes: Record<number, number> = { 1600: 2_000_000, 1400: 1_500_000, 1200: 1_000_000 };
  const calls: string[] = [];
  const r = await fitToBudget(3, async (p, step) => (calls.push(`${step.maxSide}/${step.quality}:${p}`), { size: sizes[step.maxSide], p }), {});
  assert.ok(r.ok);
  assert.equal(r.stepIndex, 2, "needed the smallest step");
  assert.equal(r.total, 3_000_000);
  assert.deepEqual(calls.filter((c) => c.startsWith("1600")).length, 3);
  assert.deepEqual(calls.filter((c) => c.startsWith("1400")).length, 3);
  assert.deepEqual(calls.filter((c) => c.startsWith("1200/0.6")).length, 3);
  assert.deepEqual(r.items.map((i) => i.p), [0, 1, 2]);
  assert.deepEqual(COMPRESS_STEPS.map((s) => [s.maxSide, s.quality]), [[1600, 0.8], [1400, 0.7], [1200, 0.6]]);
});

test("size-budget loop: reports failure when even the smallest step is too big", async () => {
  const r = await fitToBudget(12, async () => ({ size: 600_000 }), {});
  assert.equal(r.ok, false);
  assert.equal(r.total, 7_200_000);
  assert.equal(r.stepIndex, 2);
  // exactly at the budget still fits
  const edge = await fitToBudget(2, async () => ({ size: MAX_TOTAL_BYTES / 2 }), {});
  assert.ok(edge.ok);
  const over = await fitToBudget(2, async () => ({ size: MAX_TOTAL_BYTES / 2 + 1 }), {});
  assert.equal(over.ok, false);
});

test("size-budget loop reports progress and handles an empty list", async () => {
  const seen: [number, number][] = [];
  await fitToBudget(2, async () => ({ size: 5_000_000 }), { onProgress: (d, t) => seen.push([d, t]) });
  assert.deepEqual(seen[0], [0, 6]);
  assert.equal(seen.length, 6);
  const empty = await fitToBudget(0, async () => ({ size: 1 }), {});
  assert.ok(empty.ok);
  assert.equal(empty.total, 0);
});

test("formatBytes", () => {
  assert.equal(formatBytes(2_160_000), "2.2 MB");
  assert.equal(formatBytes(640_000), "640 KB");
  assert.equal(formatBytes(10), "1 KB");
});

/* ---------- excerpts ---------- */

const report = { paragraphs: [{ id: "p1", text: "Water is the lifeblood of Pakistan and its farmers depend on it every single day of the year, in every province." }] } as never;

test("excerpt slicing: exact text, truncation at 20 words, and null for any out-of-range offset", () => {
  assert.equal(sliceRef(report, { paragraphId: "p1", start: 0, end: 8 }), "Water is");
  const e = excerptOf(report, { paragraphId: "p1", start: 0, end: 112 })!;
  assert.equal(e.truncated, true);
  assert.equal(e.short.split(" ").length, 20, "20 words, the last carrying the ellipsis");
  assert.ok(e.short.endsWith("..."));
  assert.equal(e.full.length, 112 - 0);
  assert.equal(excerptOf(report, { paragraphId: "p1", start: 0, end: 8 })!.truncated, false);
  for (const bad of [
    { paragraphId: "p1", start: -1, end: 5 }, { paragraphId: "p1", start: 0, end: 9999 }, { paragraphId: "p1", start: 5, end: 5 },
    { paragraphId: "p1", start: 9, end: 2 }, { paragraphId: "nope", start: 0, end: 5 }, { paragraphId: "p1", start: 0.5, end: 5 }, { paragraphId: "p1", start: 3, end: Number.NaN },
  ]) {
    assert.equal(sliceRef(report, bad), null, JSON.stringify(bad));
    assert.equal(excerptOf(report, bad), null);
  }
  assert.equal(sliceRef({ paragraphs: [{ id: "p", text: "   " }] } as never, { paragraphId: "p", start: 0, end: 3 }), null, "whitespace only is never shown");
});

test("every claim-map passage in the mock extras slices to real text", () => {
  for (const l of mockBundle.extras!.claimMap!.links) {
    assert.ok(excerptOf(mockBundle.report, l.claim), l.id);
    if (l.evidence) assert.ok(excerptOf(mockBundle.report, l.evidence), l.id);
  }
});

/* ---------- response tolerance ---------- */

test("response shapes: a bundle, a bare report, and an API error are all handled", () => {
  const rep = clone(mockBundle.report);
  const asBundle = parseAnalyzeResponse({ report: rep, extras: { warnings: ["w"] } });
  assert.ok(asBundle.ok);
  if (asBundle.ok) assert.deepEqual(asBundle.bundle.extras, { warnings: ["w"] });

  const bare = parseAnalyzeResponse(clone(rep));
  assert.ok(bare.ok);
  if (bare.ok) assert.equal(bare.bundle.extras, undefined);

  const err = parseAnalyzeResponse({ error: { message: "Add at least one photo of your essay." } });
  assert.deepEqual(err, { ok: false, message: "Add at least one photo of your essay." });
  assert.equal(apiErrorMessage({ error: { message: 5 } }), null);
  assert.equal(apiErrorMessage({ error: "x" }), null);
  assert.equal(apiErrorMessage(null), null);
});

test("response: a missing id is generated, bad data gives a plain message and never throws", () => {
  const noId = clone(mockBundle.report) as unknown as Record<string, unknown>;
  delete noId.id;
  const r = parseAnalyzeResponse(noId, () => "an-fixed");
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.bundle.report.id, "an-fixed");
  const blank = parseAnalyzeResponse({ report: { ...clone(mockBundle.report), id: "  " } }, () => "an-blank");
  assert.ok(blank.ok && blank.bundle.report.id === "an-blank");
  assert.match(makeId(1000, 0.5), /^an-[a-z0-9]+$/);

  for (const junk of [null, undefined, 5, "html", [], {}, { hello: 1 }, { report: "x" }, { report: { id: "a" } }]) {
    const x = parseAnalyzeResponse(junk);
    assert.equal(x.ok, false);
    if (!x.ok) assert.equal(x.message, UNEXPECTED_FORMAT);
  }
  const badExtras = parseAnalyzeResponse({ report: clone(mockBundle.report), extras: { trace: 5, claimMap: [] } });
  assert.ok(badExtras.ok, "bad extras never fail the report");
});

/* ---------- the in-flight request ---------- */

const file = (name: string) => new File([new Uint8Array(10)], name, { type: "image/jpeg" });
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("startAnalysis: sends topic and images in order, shares one request, and returns a bundle", async () => {
  setSubmission({ topic: "Water", files: [file("page-1.jpg"), file("page-2.jpg")] });
  let calls = 0;
  let form: FormData | undefined;
  const fetchFn = (async (_url: string, init: RequestInit) => {
    calls++;
    form = init.body as FormData;
    return jsonResponse({ report: clone(mockBundle.report) });
  }) as unknown as typeof fetch;
  const a = startAnalysis({ fetchFn });
  const b = startAnalysis({ fetchFn });
  assert.equal(a, b, "a second call while running returns the same promise");
  const r = await a;
  assert.ok(r.ok);
  assert.equal(calls, 1);
  assert.equal(form!.get("topic"), "Water");
  assert.deepEqual(form!.getAll("images").map((f) => (f as File).name), ["page-1.jpg", "page-2.jpg"]);
  const again = await startAnalysis({ fetchFn, force: true });
  assert.ok(again.ok);
  assert.equal(calls, 2, "Try again resubmits the same files");
  clearSubmission();
});

test("startAnalysis: API messages, platform errors, network failures, timeouts and missing photos", async () => {
  setSubmission({ topic: "Water", files: [file("a.jpg")] });
  const api = await startAnalysis({ force: true, fetchFn: (async () => jsonResponse({ error: { message: "Add the essay topic before analysing." } }, 400)) as unknown as typeof fetch });
  assert.deepEqual(api, { ok: false, kind: "api", message: "Add the essay topic before analysing.", status: 400 });

  const html = await startAnalysis({ force: true, fetchFn: (async () => new Response("<html>Request Entity Too Large</html>", { status: 413 })) as unknown as typeof fetch });
  assert.equal(html.ok, false);
  if (!html.ok) assert.match(html.message, /too large.*fewer pages/);

  const gateway = await startAnalysis({ force: true, fetchFn: (async () => new Response("", { status: 504 })) as unknown as typeof fetch });
  assert.ok(!gateway.ok && gateway.kind === "timeout");

  const down = await startAnalysis({ force: true, fetchFn: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
  assert.ok(!down.ok && down.kind === "network");

  const slow = await startAnalysis({ force: true, timeoutMs: 20, fetchFn: ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch });
  assert.ok(!slow.ok && slow.kind === "timeout");

  const unreadable = await startAnalysis({ force: true, fetchFn: (async () => jsonResponse({ nonsense: true })) as unknown as typeof fetch });
  assert.ok(!unreadable.ok && unreadable.kind === "unreadable");

  clearSubmission();
  const none = await startAnalysis({ force: true });
  assert.ok(!none.ok && none.kind === "no-photos");
});

/* ---------- status wording ---------- */

import { claimSummaryLine, linkChip, rangeSentence, similarityText, spanStatus } from "./status.ts";

test("highlight status is always named in words: by rule id, then by reason cues, then by tone", () => {
  assert.equal(spanStatus("offtopic", "x", { ruleId: "orphan_claim" }).label, "No evidence found");
  assert.equal(spanStatus("weak", "x", { ruleId: "weak_link_claim" }).label, "Weakly linked");
  assert.equal(spanStatus("offtopic", "x", { ruleId: "unrebutted_counterclaim" }).label, "Rebuttal missing");
  assert.equal(spanStatus("offtopic", "x", { ruleId: "off_topic_paragraph+orphan_claim" }).label, "Off-topic", "first of several rules wins");
  assert.equal(spanStatus("weak", "x", { ruleId: "generic_evidence" }).label, "Generic wording");
  assert.equal(spanStatus("strong", "x", { ruleId: "specific_evidence" }).label, "Specific evidence");
  assert.equal(spanStatus("strong", "x", { ruleId: "something_new" }).label, "Strong", "an unknown rule falls back to the tone");
  assert.equal(spanStatus("offtopic", "Claim in paragraph 3 has no linked evidence (best match 0.31)").label, "No evidence found");
  assert.equal(spanStatus("weak", "Claim is only weakly linked to p2-s2").label, "Weakly linked");
  assert.equal(spanStatus("weak", "Reads as generic (score 0.9)").label, "Generic wording");
  assert.equal(spanStatus("offtopic", "Paragraph 5 drifts from the topic").label, "Off-topic");
  assert.equal(spanStatus("strong", "Claim is backed by evidence in p2-s2").label, "Claim linked to evidence");
  assert.equal(spanStatus("weak", "Names the event but gives no figure.").label, "Weak or generic");
  assert.equal(spanStatus("offtopic", "A separate problem.").label, "Off-topic or unsupported");
  assert.equal(spanStatus("strong", "A clear, arguable position.").label, "Strong");
});

test("similarity text, claim summary line and link chips", () => {
  assert.equal(similarityText({ similarity: 0.31, threshold: 0.45 }), "similarity 0.31, needs 0.45");
  assert.equal(similarityText({ similarity: 0.5 }), "similarity 0.50");
  assert.equal(similarityText({ threshold: 0.45 }), null);
  assert.equal(claimSummaryLine({ claimsTotal: 6, strong: 3, weak: 1, orphan: 2, unrebutted: 0 }), "6 claims: 3 supported, 1 weak, 2 without evidence");
  assert.equal(claimSummaryLine({ claimsTotal: 1, strong: 1, weak: 0, orphan: 0, unrebutted: 1 }), "1 claim: 1 supported, 0 weak, 0 without evidence; 1 opposing view not answered");
  assert.deepEqual(linkChip("claim", "strong"), { label: "Supported", tone: "good" });
  assert.deepEqual(linkChip("claim", "weak"), { label: "Weak link", tone: "flag" });
  assert.deepEqual(linkChip("claim", "orphan"), { label: "No evidence found", tone: "alert" });
  assert.deepEqual(linkChip("counterclaim", "unrebutted"), { label: "Rebuttal missing", tone: "alert" });
  assert.deepEqual(linkChip("counterclaim", "strong"), { label: "Answered", tone: "good" });
});

test("range sentence describes position without a score", () => {
  assert.match(rangeSentence("Details", 3.1, 3.8, 5.6, "below"), /yours is 3\.1, which is below the typical range \(3\.8 to 5\.6\)/);
  assert.match(rangeSentence("Details", 4.2, 3.8, 5.6, "within"), /inside the typical range/);
  assert.match(rangeSentence("Clichés", 0.34, 0.05, 0.3, "above"), /which is above the typical range \(0\.05 to 0\.30\)/);
});

/* ---------- integration helpers ---------- */

import { FRIENDLY, failureFor, parseRetryAfter } from "./analysisStore.ts";
import { driftUnmeasured, isDegraded, parseDebug, sameText } from "./status.ts";

test("degraded-analysis detection recognises the backend's real warning wording", () => {
  for (const w of [
    "Topic-drift and genericness analysis was unavailable for this essay.",
    "The AI examiner's opinion was unavailable; scores use the measurements only.",
    "Structure labels were unavailable, so the argument map and some scores are limited.",
    "The fixes were written from templates because the AI coach was unavailable.",
    "A model paragraph could not be written this time, so the paragraph shown under Before and after is your own, unchanged.",
    "Claim-to-evidence linking was skipped because the sentence comparison was unavailable.",
    "2 argument-map row(s) were left out because they did not match your essay text.",
  ]) assert.equal(isDegraded([w]), true, w);
  for (const w of ["Essay length 178 words is outside the expected 1800-3500 (warning only; scores are unchanged)", "Handwriting note: page 2 is slightly skewed."]) assert.equal(isDegraded([w]), false, w);
  assert.equal(isDegraded(undefined), false);
  assert.equal(isDegraded([]), false);
});

test("unmeasured drift is detected from the backend's warning", () => {
  assert.equal(driftUnmeasured(["Topic relevance could not be measured, so every paragraph is shown as on topic and the drift chart is not meaningful."]), true);
  assert.equal(driftUnmeasured(["Something else."]), false);
  assert.equal(driftUnmeasured(undefined), false);
});

test("identical paragraphs are detected after whitespace normalisation", () => {
  assert.equal(sameText("Water is vital.  It is.", "Water is vital. It is."), true);
  assert.equal(sameText(" a\nb ", "a b"), true);
  assert.equal(sameText("a b", "a c"), false);
});

test("debug field is parsed defensively", () => {
  assert.deepEqual(parseDebug({ stages: [{ name: "handwriting", status: "ok", ms: 8545, note: "n" }, { name: 5 }, null, { name: "x", status: "ok", ms: "slow" }] }), { stages: [{ name: "handwriting", status: "ok", ms: 8545, note: "n" }] });
  for (const bad of [undefined, null, 5, {}, { stages: "x" }, { stages: [] }, { stages: [{}] }]) assert.equal(parseDebug(bad), undefined);
  // Usage per model is kept when complete, dropped when a field is missing.
  const u = { calls: 2, failed: 0, inputTokens: 10, outputTokens: 3, thinkingTokens: 0, embeddedTexts: 0 };
  const d = parseDebug({ stages: [{ name: "x", status: "ok", ms: 1 }], meta: { totalMs: 900, usage: { "gemini-3.6-flash": u, broken: { calls: 1 } } } });
  assert.deepEqual(d?.usage, [{ model: "gemini-3.6-flash", ...u }]);
  assert.equal(d?.totalMs, 900);
});

test("friendly error mapping: API message wins, otherwise a plain sentence per status; Retry-After only on 503", () => {
  assert.match(FRIENDLY[413], /fewer pages/);
  assert.match(FRIENDLY[422], /brighter, flatter photo/);
  assert.match(FRIENDLY[503], /busy.*about a minute/);
  assert.match(FRIENDLY[504], /too long/);
  assert.equal(failureFor(422, null).message, FRIENDLY[422]);
  assert.equal(failureFor(422, "Custom message.").message, "Custom message.");
  assert.equal(failureFor(504, null).kind, "timeout");
  assert.deepEqual(failureFor(503, null, "45"), { ok: false, kind: "api", message: FRIENDLY[503], status: 503, retryAfterSec: 45 });
  assert.equal(failureFor(500, null, "45").retryAfterSec, undefined);
  assert.match(failureFor(500, null).message, /Something went wrong/);
  assert.equal(parseRetryAfter("60"), 60);
  assert.equal(parseRetryAfter("1.2"), 2);
  assert.equal(parseRetryAfter("99999"), 600);
  for (const bad of [null, undefined, "", "soon", "-5", "0", "Wed, 21 Oct 2026 07:28:00 GMT"]) assert.equal(parseRetryAfter(bad), undefined, String(bad));
});

test("startAnalysis reads Retry-After on a 503, and sends x-debug only when asked", async () => {
  setSubmission({ topic: "Water", files: [file("a.jpg")] });
  const busy = await startAnalysis({ force: true, fetchFn: (async () => new Response(JSON.stringify({ error: { message: "The AI service is busy. Please try again in a minute." } }), { status: 503, headers: { "retry-after": "60", "content-type": "application/json" } })) as unknown as typeof fetch });
  assert.ok(!busy.ok);
  if (!busy.ok) { assert.equal(busy.retryAfterSec, 60); assert.equal(busy.status, 503); assert.match(busy.message, /busy/); }

  const seen: (HeadersInit | undefined)[] = [];
  const ok = (async (_u: string, init: RequestInit) => (seen.push(init.headers), jsonResponse({ report: clone(mockBundle.report), debug: { stages: [{ name: "handwriting", status: "ok", ms: 5 }] } }))) as unknown as typeof fetch;
  const plain = await startAnalysis({ force: true, fetchFn: ok });
  const withDebug = await startAnalysis({ force: true, fetchFn: ok, debug: true });
  assert.equal(seen[0], undefined, "no debug header by default");
  assert.deepEqual(seen[1], { "x-debug": "1" });
  assert.ok(plain.ok && withDebug.ok);
  if (withDebug.ok) assert.deepEqual(withDebug.debug, { stages: [{ name: "handwriting", status: "ok", ms: 5 }] });
  clearSubmission();
});

test("the request timeout is raised to about 115 seconds", async () => {
  const { ANALYZE_TIMEOUT_MS } = await import("./analysisStore.ts");
  assert.equal(ANALYZE_TIMEOUT_MS, 115_000);
});
