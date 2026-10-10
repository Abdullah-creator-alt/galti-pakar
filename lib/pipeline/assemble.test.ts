import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_STRONG, LINK_WEAK } from "./blendConfig.ts";
import { AssemblyError, assembleBundle, newReportId, type AssembleInput } from "./assemble.ts";
import { blendAnalysis } from "./blend.ts";
import type { BenchmarkResult } from "./benchmark.types.ts";
import { reportSchema } from "./schema.ts";
import { spanKey, parseExtras } from "../types.extras.ts";

const fx = JSON.parse(readFileSync("data/fixtures/essay1.json", "utf8"));
const NOW = new Date("2026-10-10T08:00:00.000Z");

async function input(over: Partial<AssembleInput> = {}): Promise<AssembleInput> {
  const blend = await blendAnalysis({ essay: fx.essay, topic: fx.topic, sentences: fx.sentences, structure: fx.structure, analysis: fx.analysis, examiner: fx.examiner, outlineVecs: fx.outlineVecs });
  const p5 = fx.essay.paragraphs.find((p: { id: string }) => p.id === "p5");
  return {
    id: "abc123DEF45",
    now: NOW,
    topic: fx.topic,
    pageCount: 3,
    essay: fx.essay,
    sentences: fx.sentences,
    blend,
    fixes: [1, 2, 3].map((n) => ({ rank: n as 1 | 2 | 3, title: `Fix ${n}`, body: "Body.", paragraphId: "p5" })),
    rewrite: { paragraphId: "p5", original: p5.text, improved: `${p5.text} extra`, removed: [], added: [" extra"] },
    rewriteExtras: { changeNotes: [{ what: "What", why: "Why" }], placeholders: ["[slot]"] },
    warnings: [],
    ...over,
  };
}
const bench = (over: Partial<BenchmarkResult> = {}): BenchmarkResult => ({
  status: "ok",
  theme: { key: "climate-water", label: "Climate, water and environment", similarity: 0.9 },
  profile: [],
  nProfileEssays: 5,
  disclaimers: ["Not marked scripts."],
  coverage: { basis: "reference", nReferences: 5, total: 4, covered: 1, coveredPoints: [], missing: [{ point: "Glacier melt.", type: "cause", madeByCount: 4, ofN: 5, origin: "reference", bestSimilarity: 0.4 }] },
  ...over,
});

test("header fields come from code: id, ISO time, computed word count, page count, isExample false", async () => {
  const { report } = assembleBundle(await input());
  assert.equal(report.id, "abc123DEF45");
  assert.equal(report.analysedAt, "2026-10-10T08:00:00.000Z");
  assert.equal(report.pageCount, 3);
  assert.equal(report.isExample, false);
  assert.equal(report.wordCount, fx.essay.paragraphs.reduce((n: number, p: { text: string }) => n + p.text.split(/\s+/).filter(Boolean).length, 0));
  assert.ok(reportSchema.safeParse(report).success);
  assert.match(newReportId(), /^[A-Za-z0-9_-]{10,}$/);
  assert.notEqual(newReportId(), newReportId());
});

test("trace: one entry per span, keyed by SpanKey, with plain steps, numbers, thresholds and linked passages", async () => {
  const { report, extras } = assembleBundle(await input());
  const spans = report.paragraphs.flatMap((p) => p.spans.map((s) => spanKey(p.id, s.start, s.end)));
  assert.deepEqual(Object.keys(extras.trace!).sort(), [...spans].sort(), "every span has a trace and nothing else does");

  const p5 = report.paragraphs.find((p) => p.id === "p5")!;
  const orphan = extras.trace![spanKey("p5", p5.spans[0].start, p5.spans[0].end)];
  assert.equal(orphan.ruleId, "off_topic_paragraph+orphan_claim");
  assert.equal(orphan.steps[0].stage, "read");
  assert.equal(orphan.steps.at(-1)!.stage, "verify");
  assert.ok(orphan.steps.some((s) => s.stage === "label" && /Labelled Claim/.test(s.text)));
  assert.ok(orphan.steps.some((s) => s.stage === "rule" && /below 90 for relevance.*scored 38/.test(s.text)));
  assert.ok(orphan.steps.every((s) => !/rule fired/i.test(s.text)));
  assert.equal(orphan.threshold, LINK_WEAK, "an orphan needs the weak threshold");
  assert.equal(orphan.similarity, 0);

  const p2 = report.paragraphs.find((p) => p.id === "p2")!;
  const weak = p2.spans.find((s) => s.tone === "weak")!;
  const wt = extras.trace![spanKey("p2", weak.start, weak.end)];
  assert.equal(wt.ruleId, "weak_link_claim");
  assert.equal(wt.threshold, LINK_STRONG, "a weak link needs the strong threshold to be supported");
  assert.ok(wt.similarity! >= LINK_WEAK && wt.similarity! < LINK_STRONG);
  const target = fx.sentences.find((s: { id: string }) => s.id === "p2-s2");
  assert.deepEqual(wt.linked, { paragraphId: "p2", start: target.start, end: target.end });
});

test("claim map: claims and counterclaims, offsets paragraph-relative, summary from the X-Ray", async () => {
  const { extras, report } = assembleBundle(await input());
  const m = extras.claimMap!;
  assert.deepEqual(m.summary, { claimsTotal: 5, strong: 2, weak: 1, orphan: 2, unrebutted: 1 });
  const claims = m.links.filter((l) => l.kind === "claim");
  assert.equal(claims.length, 5, "Position sentences are not claims");
  assert.deepEqual(claims.map((l) => l.strength).sort(), ["orphan", "orphan", "strong", "strong", "weak"]);
  const counter = m.links.find((l) => l.kind === "counterclaim")!;
  assert.equal(counter.strength, "unrebutted");
  assert.equal(counter.evidence, undefined);
  for (const l of m.links)
    for (const r of [l.claim, l.evidence].filter(Boolean)) {
      const p = report.paragraphs.find((x) => x.id === r!.paragraphId)!;
      assert.ok(r!.start >= 0 && r!.end > r!.start && r!.end <= p.text.length);
    }
  assert.ok(claims.find((l) => l.strength === "strong")!.evidence);
  assert.equal(new Set(m.links.map((l) => l.id)).size, m.links.length, "ids are unique");
});

test("conflicts, verification, transcription and rewrite extras are mapped from their sources", async () => {
  const i = await input();
  const { extras } = assembleBundle(i);
  assert.deepEqual(extras.conflicts!.map((c) => c.id).sort(), ["evidence_praised_but_orphans", "score_gap:evidence"]);
  assert.ok(extras.conflicts!.every((c) => c.dimension && c.examinerSays && c.measuredSays));
  const v = extras.verification!;
  assert.equal(v.spansProposed, i.blend.metrics.spansProposed);
  assert.equal(v.spansDropped, 0);
  assert.equal(v.quotesProposed, 14);
  assert.equal(v.quotesVerified, 14);
  assert.equal(v.conflictsFound, 2);
  assert.equal(v.examinerAgreementRate, 1);
  assert.equal(v.labelAgreementRate, 0.82);
  assert.deepEqual(extras.transcription, { legibility: "good", uncertain: [] });
  assert.deepEqual(extras.rewriteExtras, { changeNotes: [{ what: "What", why: "Why" }], placeholders: ["[slot]"] });
  const withUncertain = assembleBundle(await input({ essay: { ...fx.essay, legibility: "fair", uncertain: [{ paragraphId: "p2", word: "Punjab", guess: "Punjab" }] } }));
  assert.equal(withUncertain.extras.transcription?.legibility, "fair");
  assert.equal(withUncertain.extras.transcription?.uncertain.length, 1);
});

test("benchmark: mapped for ok and partial, neutral profile rows dropped, omitted when unavailable or absent", async () => {
  const profile = [
    { feature: "specifics", label: "Details", value: 3, refMedian: 4, refQ1: 3.5, refQ3: 5, position: "below" as const, betterDirection: "higher" as const, note: "n" },
    { feature: "meanSentenceLength", label: "Sentence length", value: 20, refMedian: 18, refQ1: 15, refQ3: 22, position: "within" as const, betterDirection: "neutral" as const, note: "n" },
  ];
  const ok = assembleBundle(await input({ benchmark: bench({ profile }) })).extras.benchmark!;
  assert.equal(ok.status, "ok");
  assert.equal(ok.themeLabel, "Climate, water and environment");
  assert.equal(ok.nReferences, 5);
  assert.deepEqual(ok.coverage, { covered: 1, total: 4, basis: "reference", missing: [{ point: "Glacier melt.", madeByCount: 4, ofN: 5 }] });
  assert.deepEqual(ok.profile!.map((p) => p.label), ["Details"], "only higher or lower rows fit the contract");
  assert.deepEqual(ok.disclaimers, ["Not marked scripts."]);
  assert.equal(assembleBundle(await input({ benchmark: bench({ status: "partial" }) })).extras.benchmark?.status, "partial");
  assert.equal(assembleBundle(await input({ benchmark: bench({ status: "unavailable" }) })).extras.benchmark, undefined);
  assert.equal(assembleBundle(await input()).extras.benchmark, undefined);
});

test("warnings: stage notes plus step notes, deduplicated, capped and truncated", async () => {
  const many = Array.from({ length: 40 }, (_, i) => `Note ${i}`);
  const { extras } = assembleBundle(await input({ warnings: ["Topic-drift analysis was unavailable for this essay.", "Topic-drift analysis was unavailable for this essay.", "x".repeat(2000), ...many] }));
  assert.equal(extras.warnings!.filter((w) => /Topic-drift/.test(w)).length, 1);
  assert.ok(extras.warnings!.length <= 20);
  assert.ok(extras.warnings!.every((w) => w.length <= 300));
});

test("an invalid report is an error, never a silent repair", async () => {
  const i = await input();
  assert.throws(() => assembleBundle({ ...i, fixes: i.fixes.slice(0, 2) }), AssemblyError);
  assert.throws(() => assembleBundle({ ...i, rewrite: { ...i.rewrite, paragraphId: "p99" } }), AssemblyError);
  assert.throws(() => assembleBundle({ ...i, rewrite: { ...i.rewrite, removed: ["not in the original"] } }), AssemblyError);
});

test("out-of-range extras are dropped with a warning while the report stands", async () => {
  const i = await input();
  // Corrupt a sentence reference so claim-map rows and a trace link point outside their paragraph.
  const bad = i.sentences.map((s) => (s.id === "p2-s2" ? { ...s, end: 99999 } : s));
  const { report, extras } = assembleBundle({ ...i, sentences: bad });
  assert.ok(reportSchema.safeParse(report).success);
  assert.ok(extras.claimMap!.links.length < 6, "links pointing at the bad sentence were dropped");
  assert.ok(extras.warnings!.some((w) => /argument-map row\(s\) were left out/.test(w)));
  assert.deepEqual(Object.keys(parseExtras(JSON.parse(JSON.stringify(extras)))).sort(), Object.keys(extras).sort());
});

test("without an examiner the report has no examiner rows and no agreement rate", async () => {
  const blend = await blendAnalysis({ essay: fx.essay, topic: fx.topic, sentences: fx.sentences, structure: fx.structure, analysis: fx.analysis, outlineVecs: fx.outlineVecs });
  const { report, extras } = assembleBundle(await input({ blend }));
  assert.deepEqual(report.examiners, []);
  assert.equal(extras.verification?.examinerAgreementRate, undefined);
  assert.equal(extras.verification?.quotesProposed, 0);
});

test("more rewrites: kept only for real, different paragraphs whose original is the transcript text; the contract parses them", async () => {
  const text = (id: string) => fx.essay.paragraphs.find((p: { id: string }) => p.id === id).text as string;
  const good = { rewrite: { paragraphId: "p2", original: text("p2"), improved: `${text("p2")} extra`, removed: [], added: [" extra"] }, changeNotes: [{ what: "W", why: "Y" }], placeholders: [] };
  const sameAsMain = { ...good, rewrite: { ...good.rewrite, paragraphId: "p5", original: text("p5") } };
  const unknown = { ...good, rewrite: { ...good.rewrite, paragraphId: "p99" } };
  const edited = { ...good, rewrite: { ...good.rewrite, paragraphId: "p3", original: "Not the transcript text." } };
  const { extras } = assembleBundle(await input({ moreRewrites: [good, sameAsMain, unknown, edited] }));
  assert.deepEqual(extras.moreRewrites?.map((m) => m.paragraphId), ["p2"]);
  assert.equal(assembleBundle(await input()).extras.moreRewrites, undefined, "omitted when there are none");
  // The UI contract: valid ones survive, unchanged or out-of-text ones are dropped, never an error.
  const ok = { paragraphId: "p2", original: "A b c.", improved: "A b d.", removed: ["c"], added: ["d"], changeNotes: [], placeholders: [] };
  const parsed = parseExtras({ moreRewrites: [ok, { ...ok, improved: ok.original }, { ...ok, added: ["zzz"] }, { paragraphId: "p3" }, 7] });
  assert.deepEqual(parsed.moreRewrites?.map((m) => m.paragraphId), ["p2"]);
  assert.equal(parseExtras({ moreRewrites: [ok, ok, ok, ok] }).moreRewrites?.length, 2, "at most two further paragraphs");
});
