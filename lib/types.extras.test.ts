import test from "node:test";
import assert from "node:assert/strict";
import { mockBundle, mockExtras } from "./mock-extras.ts";
import { parseBundle, parseExtras, parseSpanKey, spanKey } from "./types.extras.ts";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

test("SpanKey: generated from a paragraph id and offsets, and parsed back", () => {
  assert.equal(spanKey("p3", 120, 198), "p3:120-198");
  assert.deepEqual(parseSpanKey("p3:120-198"), { paragraphId: "p3", start: 120, end: 198 });
  assert.deepEqual(parseSpanKey("para-1:0-5"), { paragraphId: "para-1", start: 0, end: 5 });
  for (const bad of ["p3", "p3:5-5", "p3:9-2", ":1-2", "p3:a-b", "", "p3:1-2-3x"]) assert.equal(parseSpanKey(bad), null, bad);
  for (const p of mockBundle.report.paragraphs) for (const s of p.spans) assert.deepEqual(parseSpanKey(spanKey(p.id, s.start, s.end)), { paragraphId: p.id, start: s.start, end: s.end });
});

test("mock extras are valid, complete, and every trace key points at a real span", () => {
  const parsed = parseExtras(clone(mockExtras));
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(mockExtras).sort(), "nothing was dropped");
  assert.ok(Object.keys(parsed.trace!).length >= 3);
  const spans = new Set(mockBundle.report.paragraphs.flatMap((p) => p.spans.map((s) => spanKey(p.id, s.start, s.end))));
  for (const k of Object.keys(parsed.trace!)) assert.ok(spans.has(k as never), `trace key ${k} is a real span`);
  const s = parsed.claimMap!.links.map((l) => l.strength);
  for (const want of ["strong", "weak", "orphan", "unrebutted"]) assert.ok(s.includes(want as never), want);
  assert.equal(parsed.conflicts!.length, 1);
  assert.equal(parsed.benchmark!.status, "ok");
  assert.equal(parsed.rewriteExtras!.placeholders.length, 1);
  assert.ok(mockBundle.report.rewrite.improved.includes(parsed.rewriteExtras!.placeholders[0]), "the slot is in the model paragraph");
  assert.equal(parseBundle(clone(mockBundle)).ok, true);
});

test("parseExtras never throws and returns {} for junk", () => {
  for (const junk of [undefined, null, 5, "x", [], [1, 2], true, () => 1, { trace: 5, claimMap: "no", conflicts: {}, verification: [], transcription: null, rewriteExtras: 3, benchmark: [], warnings: 9 }]) {
    assert.doesNotThrow(() => parseExtras(junk));
    assert.deepEqual(parseExtras(junk), {}, JSON.stringify(junk));
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.deepEqual(parseExtras(cyclic), {});
});

test("bad parts are dropped one by one and good parts survive", () => {
  const good = clone(mockExtras);
  const mixed = {
    ...good,
    trace: { ...good.trace, "not a key": { ruleId: "x", steps: [] }, "p1:9-3": { ruleId: "y", steps: [] }, "p1:1-2": "garbage" },
    claimMap: { links: [...good.claimMap!.links, { id: "bad", kind: "claim", claim: { paragraphId: "p1", start: 5, end: 2 }, strength: "strong" }, { id: "bad2", kind: "oops", claim: { paragraphId: "p1", start: 0, end: 4 }, strength: "strong" }, 7], summary: "nope" },
    conflicts: [...good.conflicts!, { id: "x" }, null],
    verification: { ...good.verification, spansDropped: "many", examinerAgreementRate: 4, quotesVerified: -3 },
    transcription: { legibility: "terrible", uncertain: [] },
    benchmark: { ...good.benchmark, coverage: { ...good.benchmark!.coverage, missing: [...good.benchmark!.coverage!.missing, { point: 5 }] }, profile: [{ label: "x" }, ...good.benchmark!.profile!] },
    warnings: ["ok", 5, null, "also ok"],
  };
  const p = parseExtras(mixed);
  assert.equal(Object.keys(p.trace!).length, Object.keys(good.trace!).length, "only valid, well-formed trace keys remain");
  assert.equal(p.claimMap!.links.length, 4, "invalid links dropped");
  assert.deepEqual(p.claimMap!.summary, { claimsTotal: 3, strong: 1, weak: 1, orphan: 1, unrebutted: 1 }, "a malformed summary is recomputed from valid links");
  assert.equal(p.conflicts!.length, 1);
  assert.equal(p.verification!.spansDropped, undefined, "a bad number is dropped");
  assert.equal(p.verification!.examinerAgreementRate, undefined, "a rate above 1 is dropped");
  assert.equal(p.verification!.quotesVerified, undefined, "a negative count is dropped");
  assert.equal(p.verification!.spansProposed, 17, "its neighbours survive");
  assert.equal(p.transcription, undefined, "an invalid legibility drops the whole field");
  assert.equal(p.benchmark!.coverage!.missing.length, 3);
  assert.equal(p.benchmark!.profile!.length, 3);
  assert.deepEqual(p.warnings, ["ok", "also ok"]);
});

test("a malformed link target is dropped, the link kept", () => {
  const p = parseExtras({ claimMap: { links: [{ id: "a", kind: "claim", claim: { paragraphId: "p1", start: 0, end: 9 }, evidence: { paragraphId: "p1", start: 8, end: 3 }, strength: "weak" }] } });
  assert.equal(p.claimMap!.links[0].evidence, undefined);
  assert.equal(p.claimMap!.links[0].strength, "weak");
  const t = parseExtras({ trace: { "p1:0-9": { ruleId: "r", steps: [{ stage: "read", text: "ok" }, { stage: "bogus", text: "no" }], linked: { paragraphId: "p2" }, similarity: "high" } } });
  assert.deepEqual(t.trace!["p1:0-9"].steps, [{ stage: "read", text: "ok" }]);
  assert.equal(t.trace!["p1:0-9"].linked, undefined);
  assert.equal(t.trace!["p1:0-9"].similarity, undefined);
});

test("long strings are truncated, extra keys are stripped", () => {
  const p = parseExtras({ warnings: ["x".repeat(5000)], evil: { a: 1 }, conflicts: [{ id: "i", dimension: "d", examinerSays: "e", measuredSays: "m", __proto__: { polluted: true } }] });
  assert.equal(p.warnings![0].length, 600);
  assert.ok(!("evil" in p));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("parseBundle: strict on the report, lenient on extras, and empty extras are omitted", () => {
  const ok = parseBundle({ report: clone(mockBundle.report), extras: { trace: 5, warnings: ["hi"] } });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.bundle.extras, { warnings: ["hi"] });
  const none = parseBundle({ report: clone(mockBundle.report), extras: "junk" });
  assert.ok(none.ok && none.bundle.extras === undefined);
  assert.equal(parseBundle({ report: { id: "x" } }).ok, false);
  assert.equal(parseBundle(null).ok, false);
  assert.equal(parseBundle("str").ok, false);
  const badSpan = clone(mockBundle.report);
  badSpan.paragraphs[0].spans[0].end = 99999;
  assert.equal(parseBundle({ report: badSpan }).ok, false, "a span outside its paragraph fails the report schema");
});
