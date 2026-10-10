import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bandForScore } from "../derive.ts";
import { analyzeEssayStructure } from "../structure/index.ts";
import { ESSAY_A, ESSAY_A_SPECS, mockComplete } from "../structure/testkit.ts";
import { blendAnalysis, confidenceFor, verdictFromScore } from "./blend.ts";
import type { BlendInput, SentenceLabelName, SentenceRef } from "./blend.types.ts";
import { CROSS_CHECK, LINK_STRONG, LINK_WEAK, VERDICT_THRESHOLDS } from "./blendConfig.ts";
import { buildRankedIssues } from "./coachInput.ts";
import type { SecondOpinion } from "./findings.types.ts";
import { reportPartsSchema } from "./schema.ts";
import { buildSentenceRefs, labelsFromStructure } from "./structureLabels.ts";
import { essayFrom } from "./testkit.ts";
import { crossChecks, recheckQuotes, verifySpans } from "./verifyFindings.ts";
import { normalize } from "./vecmath.ts";
import { buildSpans, colourSentences, decideLink, findRebuttals, linkClaims, paragraphRole, xrayStats, type SentenceInfo } from "./xray.ts";

const fixture = () => JSON.parse(readFileSync("data/fixtures/essay1.json", "utf8"));
const inputFrom = (fx: ReturnType<typeof fixture>, over: Partial<BlendInput> = {}): BlendInput => ({
  essay: fx.essay, topic: fx.topic, sentences: fx.sentences, structure: fx.structure, analysis: fx.analysis, examiner: fx.examiner, outlineVecs: fx.outlineVecs, ...over,
});

/* ---------- small hand-built sentence sets for the linking and colour tests ---------- */

/** Unit vector at an angle: cosine between two of them is cos(angle difference). */
const at = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0];
const cosToDeg = (c: number) => (Math.acos(c) * 180) / Math.PI;

interface Spec { p: number; label?: SentenceLabelName; deg?: number; level?: SentenceInfo["genericLevel"]; score?: number }
function infosFrom(specs: Spec[]): SentenceInfo[] {
  const counts = new Map<number, number>();
  return specs.map((s, i) => {
    const k = counts.get(s.p) ?? 0;
    counts.set(s.p, k + 1);
    const text = `Sentence number ${i + 1} text.`;
    const ref: SentenceRef = { id: `p${s.p + 1}-s${k + 1}`, paragraphId: `p${s.p + 1}`, start: 0, end: text.length, text, ...(s.deg !== undefined ? { vec: at(s.deg) } : {}) };
    return { ref, paragraphIndex: s.p, indexInParagraph: k, ...(s.label ? { label: { sentenceId: ref.id, label: s.label, source: "llm" as const, confidence: 0.9 } } : {}), ...(s.level ? { genericLevel: s.level, genericScore: s.score ?? 0.5 } : {}) };
  });
}
// angle differences that give cosines clearly above/below the thresholds
const STRONG_DEG = cosToDeg(0.9);
const WEAK_DEG = cosToDeg((LINK_STRONG + LINK_WEAK) / 2);
const FAR_DEG = 80;

test("linking: strong, weak and orphan from cosine thresholds", () => {
  const strong = linkClaims(infosFrom([{ p: 0, label: "Claim", deg: 0 }, { p: 0, label: "Evidence", deg: STRONG_DEG }]));
  assert.equal(strong[0].strength, "strong");
  assert.equal(strong[0].evidenceSentenceId, "p1-s2");
  assert.equal(strong[0].windowUsed, "same-paragraph");

  const weak = linkClaims(infosFrom([{ p: 0, label: "Claim", deg: 0 }, { p: 0, label: "Evidence", deg: WEAK_DEG }]));
  assert.equal(weak[0].strength, "weak");

  const orphan = linkClaims(infosFrom([{ p: 0, label: "Claim", deg: 0 }, { p: 0, label: "Evidence", deg: FAR_DEG }]));
  assert.equal(orphan[0].strength, "orphan");
  assert.equal(orphan[0].evidenceSentenceId, null);
  assert.ok(orphan[0].similarity > 0 && orphan[0].similarity < LINK_WEAK, "an orphan keeps the best similarity found");
});

test("linking: evidence before the claim, and the adjacent-paragraph window", () => {
  const before = linkClaims(infosFrom([{ p: 0, label: "Evidence", deg: STRONG_DEG }, { p: 0, label: "Claim", deg: 0 }]));
  assert.equal(before[0].strength, "strong");
  assert.equal(before[0].evidenceSentenceId, "p1-s1");

  const adjacent = linkClaims(infosFrom([{ p: 0, label: "Claim", deg: 0 }, { p: 1, label: "Evidence", deg: 1 }]));
  assert.equal(adjacent[0].strength, "weak", "an adjacent paragraph can only make a weak link, however close");
  assert.equal(adjacent[0].windowUsed, "adjacent-paragraph");

  const twoAway = linkClaims(infosFrom([{ p: 0, label: "Claim", deg: 0 }, { p: 2, label: "Evidence", deg: 1 }]));
  assert.equal(twoAway[0].strength, "orphan", "two paragraphs away is outside the window");
});

test("linking: next sentence counts as weak support only when no Evidence is labelled nearby", () => {
  const next = linkClaims(infosFrom([{ p: 0, label: "Claim", deg: 0 }, { p: 0, deg: FAR_DEG, level: "specific", score: 0.05 }]));
  assert.equal(next[0].strength, "weak");
  assert.equal(next[0].windowUsed, "next-sentence-specific");
  const notSpecific = linkClaims(infosFrom([{ p: 0, label: "Claim", deg: 0 }, { p: 0, deg: FAR_DEG, level: "mixed" }]));
  assert.equal(notSpecific[0].strength, "orphan");
  const hasEvidence = linkClaims(infosFrom([{ p: 0, label: "Claim", deg: 0 }, { p: 0, deg: FAR_DEG, level: "specific" }, { p: 0, label: "Evidence", deg: FAR_DEG }]));
  assert.equal(hasEvidence[0].windowUsed, "none", "an Evidence label nearby, however dissimilar, disables the fallback");
});

test("decideLink is pure and respects custom thresholds", () => {
  const cands = [{ id: "a", vec: at(10), sameParagraph: true }];
  assert.equal(decideLink(at(0), cands, { strong: 0.9, weak: 0.8 }).strength, "strong");
  assert.equal(decideLink(at(0), cands, { strong: 0.99, weak: 0.8 }).strength, "weak");
  assert.equal(decideLink(at(0), cands, { strong: 0.99, weak: 0.99 }).strength, "orphan");
  assert.equal(decideLink(undefined, cands).strength, "orphan");
});

test("counterclaim rebuttal window: same paragraph within 4 sentences, or the next paragraph", () => {
  const ok = findRebuttals(infosFrom([{ p: 0, label: "Counterclaim" }, { p: 0 }, { p: 0, label: "Rebuttal" }]));
  assert.equal(ok[0].status, "rebutted");
  const nextPara = findRebuttals(infosFrom([{ p: 0, label: "Counterclaim" }, { p: 1, label: "Rebuttal" }]));
  assert.equal(nextPara[0].status, "rebutted");
  const tooFar = findRebuttals(infosFrom([{ p: 0, label: "Counterclaim" }, { p: 2, label: "Rebuttal" }]));
  assert.equal(tooFar[0].status, "unrebutted");
  const tooMany = findRebuttals(infosFrom([{ p: 0, label: "Counterclaim" }, { p: 0 }, { p: 0 }, { p: 0 }, { p: 0 }, { p: 0, label: "Rebuttal" }]));
  assert.equal(tooMany[0].status, "unrebutted");
  const before = findRebuttals(infosFrom([{ p: 0, label: "Rebuttal" }, { p: 0, label: "Counterclaim" }]));
  assert.equal(before[0].status, "unrebutted", "a rebuttal must come after the counterclaim");
});

function colourize(specs: Spec[], relevance: Record<string, number> = {}) {
  const infos = infosFrom(specs);
  const links = linkClaims(infos);
  const counters = findRebuttals(infos);
  const rel = new Map(Object.entries(relevance));
  const colours = colourSentences(infos, { structureAvailable: true, linksAvailable: true, links, counters, relevance: rel, driftThreshold: 90, thresholds: { strong: LINK_STRONG, weak: LINK_WEAK } });
  return { infos, links, colours, stats: xrayStats(links, counters) };
}

test("colour precedence: red beats amber beats green, up to two reasons, with real numbers in the text", () => {
  // An orphan claim in a drifting paragraph: both red rules fire.
  const { colours } = colourize([{ p: 0, label: "Claim", deg: 0 }], { p1: 38 });
  assert.equal(colours[0].tone, "offtopic");
  assert.deepEqual(colours[0].ruleIds, ["off_topic_paragraph", "orphan_claim"]);
  assert.match(colours[0].reasons[0], /relevance 38, threshold 90/);
  assert.match(colours[0].reasons[1], /best match 0\.00, needs 0\.76/);

  // A strong claim that is also generic: amber beats green.
  const mixed = colourize([{ p: 0, label: "Claim", deg: 0, level: "generic", score: 0.9 }, { p: 0, label: "Evidence", deg: STRONG_DEG }], { p1: 97 });
  assert.equal(mixed.colours[0].tone, "weak");
  assert.deepEqual(mixed.colours[0].ruleIds, ["generic_sentence", "strong_link_claim"]);

  // A red sentence does not also get the generic amber rule.
  const red = colourize([{ p: 0, label: "Claim", deg: 0, level: "generic", score: 0.9 }], { p1: 97 });
  assert.deepEqual(red.colours[0].ruleIds, ["orphan_claim"]);
});

test("colour rules: green needs a strong link and an on-topic paragraph; weak link is amber; specific evidence is green", () => {
  const strongOn = colourize([{ p: 0, label: "Claim", deg: 0 }, { p: 0, label: "Evidence", deg: STRONG_DEG }], { p1: 97 });
  assert.deepEqual(strongOn.colours.map((c) => c.tone), ["strong", "strong"], "both the claim and its evidence sentence");
  assert.match(strongOn.colours[0].reasons[0], /match 0\.9\d, needs 0\.82/);

  const strongUnknown = colourize([{ p: 0, label: "Claim", deg: 0 }, { p: 0, label: "Evidence", deg: STRONG_DEG }]);
  assert.equal(strongUnknown.colours[0].tone, null, "relevance unknown: on-topic cannot be confirmed, so no green");

  const weak = colourize([{ p: 0, label: "Claim", deg: 0 }, { p: 0, label: "Evidence", deg: WEAK_DEG }], { p1: 97 });
  assert.equal(weak.colours[0].tone, "weak");
  assert.match(weak.colours[0].reasons[0], /only weakly linked to p1-s2 \(match 0\.\d\d, strong needs 0\.82\)/);

  const spec = colourize([{ p: 0, label: "Evidence", deg: 0, level: "specific", score: 0.05 }]);
  assert.equal(spec.colours[0].tone, "strong");
  const gen = colourize([{ p: 0, label: "Evidence", deg: 0, level: "generic", score: 0.9 }]);
  assert.equal(gen.colours[0].tone, "weak");
  assert.deepEqual(gen.colours[0].ruleIds, ["generic_evidence"]);
  const none = colourize([{ p: 0, label: "Other", level: "mixed" }]);
  assert.equal(none.colours[0].tone, null);

  const counter = colourize([{ p: 0, label: "Counterclaim" }]);
  assert.equal(counter.colours[0].tone, "offtopic");
  assert.deepEqual(counter.colours[0].ruleIds, ["unrebutted_counterclaim"]);
});

test("spans never overlap and merge adjacent sentences only for identical tone and rule", () => {
  const specs: Spec[] = [{ p: 0, label: "Other", level: "generic", score: 0.9 }, { p: 0, label: "Other", level: "generic", score: 0.8 }, { p: 0, label: "Other", level: "mixed" }, { p: 0, label: "Other", level: "generic", score: 0.7 }, { p: 1, label: "Other", level: "generic", score: 0.7 }];
  const { infos, colours } = colourize(specs);
  // give the sentences real, consecutive offsets so slices can be checked
  let pos = 0;
  infos.forEach((i) => { if (i.indexInParagraph === 0) pos = 0; i.ref.start = pos; i.ref.end = pos + 10; pos += 11; });
  const spans = buildSpans(colours);
  assert.equal(spans.length, 3, "sentences 1+2 merge; 4 stands alone (mixed 3 breaks the run); paragraph 2 never merges across paragraphs");
  assert.deepEqual(spans[0].trace.sentenceIds, ["p1-s1", "p1-s2"]);
  assert.match(spans[0].reason, /same finding in 1 more adjacent sentence/);
  for (let k = 1; k < spans.length; k++) if (spans[k].paragraphId === spans[k - 1].paragraphId) assert.ok(spans[k].start >= spans[k - 1].end);
});

test("verification drops a deliberately corrupted span, and counts and explains it", () => {
  const fx = fixture();
  const paragraphs = fx.essay.paragraphs.map((p: { id: string; text: string }) => ({ id: p.id, text: p.text }));
  const refs: SentenceRef[] = fx.sentences;
  const colours = colourSentences(
    refs.map((ref, i) => ({ ref, paragraphIndex: Number(ref.paragraphId.slice(1)) - 1, indexInParagraph: i, genericLevel: "generic" as const, genericScore: 0.9 })),
    { structureAvailable: false, linksAvailable: false, links: [], counters: [], relevance: new Map(), driftThreshold: 90, thresholds: { strong: LINK_STRONG, weak: LINK_WEAK } },
  );
  const spans = buildSpans(colours);
  assert.equal(verifySpans(spans, paragraphs, refs).dropped.length, 0, "clean spans pass");

  const bad = structuredClone(spans);
  bad[0].end = 99999; // outside the paragraph
  bad[1].tone = "loud" as never; // not an allowed tone
  bad[2].reason = "  "; // empty reason
  bad[3].start += 1; // no longer matches its sentence
  const r = verifySpans(bad, paragraphs, refs);
  assert.equal(r.dropped.length, 4);
  assert.equal(r.valid.length, spans.length - 4);
  assert.match(r.dropped.map((d) => d.why).join("|"), /outside the paragraph.*not allowed.*empty reason.*does not match/);
  assert.ok(r.valid.every((s) => paragraphs.find((p: { id: string }) => p.id === s.paragraphId)!.text.slice(s.start, s.end).length > 0));

  const overlap = structuredClone(spans.slice(0, 1));
  overlap.push({ ...overlap[0] });
  assert.equal(verifySpans(overlap, paragraphs, refs).dropped.length, 1, "an overlapping duplicate is dropped");
});

test("re-check of examiner quotes catches offsets that no longer resolve", () => {
  const fx = fixture();
  const ex: SecondOpinion = structuredClone(fx.examiner);
  const sources = [...fx.essay.paragraphs.map((p: { id: string; text: string }) => ({ id: p.id, text: p.text })), { id: "outline", text: fx.essay.outline.join("\n") }];
  assert.equal(recheckQuotes(ex, sources).failed, 0);
  ex.dimensions[0].verifiedQuotes[0].start += 3;
  const r = recheckQuotes(ex, sources);
  assert.equal(r.failed, 1);
  assert.equal(r.valid.get("thesis")!.length, ex.dimensions[0].verifiedQuotes.length - 1);
});

/* ---------- cross-checks ---------- */

function examinerWith(scores: Partial<Record<string, number>>, absence: Partial<Record<string, boolean>> = {}): SecondOpinion {
  const ex: SecondOpinion = structuredClone(fixture().examiner);
  for (const d of ex.dimensions) if (scores[d.key] !== undefined) d.medianScore = scores[d.key]!;
  for (const r of ex.runs) for (const [k, v] of Object.entries(absence)) (r.dimensions as Record<string, { absence: boolean }>)[k].absence = v!;
  return ex;
}
const stats = (orphan: number, total: number) => ({ claimsTotal: total, claimsStrong: total - orphan, claimsWeak: 0, claimsOrphan: orphan, claimsLinkedShare: 1 - orphan / total, orphanShare: orphan / total, unrebuttedCount: 0, counterclaims: 0 });
const base = { outOf: 10, structureAvailable: true, hasCounterLabel: true, stats: stats(0, 5), driftingParagraphs: 0 };
const types = (c: ReturnType<typeof crossChecks>) => c.map((x) => x.type);

test("each cross-check fires on a crafted case and stays quiet on a clean one", () => {
  const clean = crossChecks({ ...base, examiner: examinerWith({ evidence: 8, coherence: 8 }) });
  assert.deepEqual(clean, [], "a clean essay with a happy examiner has no conflicts");

  const ev = crossChecks({ ...base, examiner: examinerWith({ evidence: 7 }), stats: stats(2, 5) });
  assert.deepEqual(types(ev), ["evidence_praised_but_orphans"]);
  assert.equal(ev[0].numbers.orphanShare, 0.4);
  assert.deepEqual(types(crossChecks({ ...base, examiner: examinerWith({ evidence: 6.5 }), stats: stats(2, 5) })), [], "examiner below the praise line");
  assert.deepEqual(types(crossChecks({ ...base, examiner: examinerWith({ evidence: 9 }), stats: stats(1, 5) })), [], "orphan share below 0.4");

  const co = crossChecks({ ...base, examiner: examinerWith({ coherence: 7.5 }), driftingParagraphs: 2 });
  assert.deepEqual(types(co), ["coherence_praised_but_drift"]);
  assert.deepEqual(types(crossChecks({ ...base, examiner: examinerWith({ coherence: 7.5 }), driftingParagraphs: 1 })), []);

  const absentFound = crossChecks({ ...base, examiner: examinerWith({ "counter-argument": 2 }, { "counter-argument": true }), hasCounterLabel: true });
  assert.deepEqual(types(absentFound), ["counter_absent_but_found"]);
  const presentNone = crossChecks({ ...base, examiner: examinerWith({ "counter-argument": 6 }), hasCounterLabel: false });
  assert.deepEqual(types(presentNone), ["counter_present_but_none"]);
  assert.deepEqual(types(crossChecks({ ...base, examiner: examinerWith({ "counter-argument": 2 }, { "counter-argument": true }), hasCounterLabel: false })), [], "absent and none found agree");
  assert.deepEqual(types(crossChecks({ ...base, examiner: examinerWith({ "counter-argument": 6 }), hasCounterLabel: false, structureAvailable: false })), [], "no labels, no check");

  const lab = crossChecks({ ...base, labelAgreementRate: CROSS_CHECK.LABEL_AGREEMENT_FLOOR - 0.01 });
  assert.deepEqual(types(lab), ["structure_label_disagreement"]);
  assert.deepEqual(types(crossChecks({ ...base, labelAgreementRate: CROSS_CHECK.LABEL_AGREEMENT_FLOOR })), []);
});

/* ---------- blend and score ---------- */

test("full blend on the fixture: invariants, score math, bands, verdict, schema", async () => {
  const fx = fixture();
  const r = await blendAnalysis(inputFrom(fx));
  assert.ok(reportPartsSchema.safeParse(r.reportParts).success);
  assert.equal(r.reportParts.dimensions.length, 7);
  for (const d of r.reportParts.dimensions) {
    assert.equal(d.band, bandForScore(d.score, d.outOf), `${d.key}: band comes from the score`);
    const t = r.dimensionTrace.find((x) => x.key === d.key)!;
    assert.equal(t.mode, "blended");
    assert.equal(d.score, Math.round((t.weightMeasured * t.measured! + (1 - t.weightMeasured) * t.examiner!) * 10) / 10, `${d.key}: w * measured + (1 - w) * examiner`);
  }
  const mean = r.reportParts.dimensions.reduce((s, d) => s + d.score, 0) / 7;
  assert.equal(r.reportParts.overallScore, Math.round(mean * 10) / 10, "equal weights");
  assert.equal(r.reportParts.verdict, verdictFromScore(r.reportParts.overallScore, 10));
  assert.equal(r.reportParts.examiners.length, 2);
  assert.equal(r.metrics.spansDropped, 0);
  assert.equal(r.metrics.claimsTotal, 5);
  assert.equal(r.metrics.conflictsByType.evidence_praised_but_orphans, 1);
  assert.ok(r.conflicts.some((c) => c.type === "score_gap" && c.dimension === "evidence"), "measured 5.5 vs examiner 8.5 is a 3-point gap");
  // every span text slices to real paragraph text, in order and without overlap
  for (const p of r.reportParts.paragraphs) {
    let last = -1;
    for (const s of p.spans) {
      assert.ok(s.start >= last && s.end <= p.text.length && s.reason.length > 0);
      last = s.end;
    }
  }
  assert.equal(r.reportParts.paragraphs.find((p) => p.id === "p5")!.relevance, 38);
  assert.equal(r.trace.length, r.reportParts.paragraphs.reduce((n, p) => n + p.spans.length, 0));
  assert.ok(r.trace.every((t) => t.chain[0] === "read from the transcript" && t.chain.at(-1)!.startsWith("rule fired")));
});

test("fallbacks: examiner-only, measured-only, and no data", async () => {
  const fx = fixture();
  const examinerOnly = await blendAnalysis(inputFrom(fx, { structure: undefined, analysis: undefined, outlineVecs: undefined }));
  const t = examinerOnly.dimensionTrace;
  assert.equal(t.find((x) => x.key === "language")!.mode, "blended", "language still has measured cliche/repetition/variety signals");
  for (const k of ["thesis", "argument", "evidence", "counter-argument", "coherence"] as const) {
    const d = t.find((x) => x.key === k)!;
    assert.equal(d.mode, "examiner-only", k);
    assert.ok(d.flags.includes("examiner-only"));
    assert.equal(d.final, d.examiner);
  }

  const measuredOnly = await blendAnalysis(inputFrom(fx, { examiner: undefined }));
  assert.ok(measuredOnly.dimensionTrace.every((x) => x.mode === "measured-only" && x.flags.includes("measured-only")));
  assert.deepEqual(measuredOnly.reportParts.examiners, []);
  assert.ok(measuredOnly.warnings.some((w) => /examiner second opinion unavailable/.test(w)));
  for (const d of measuredOnly.dimensionTrace) assert.equal(d.final, Math.round(d.measured! * 10) / 10);

  const nothing = await blendAnalysis({ essay: fx.essay, topic: fx.topic, sentences: fx.sentences });
  const none = nothing.dimensionTrace.filter((x) => x.flags.includes("no-data"));
  assert.ok(none.length >= 3, "dimensions with no source are flagged, not invented");
  assert.ok(nothing.warnings.some((w) => /No data for/.test(w)));
  assert.ok(nothing.reportParts.dimensions.filter((d) => /Not assessed|Low confidence/.test(d.note ?? "")).length >= 3);
});

test("band and verdict boundaries", () => {
  assert.equal(verdictFromScore(7, 10), "competitive");
  assert.equal(verdictFromScore(6.9, 10), "borderline");
  assert.equal(verdictFromScore(5, 10), "borderline");
  assert.equal(verdictFromScore(4.9, 10), "below-pass");
  for (let s = 0; s <= 10; s += 0.1) assert.equal(verdictFromScore(s, 10), bandForScore(s, 10), `score ${s.toFixed(1)}`);
  assert.deepEqual({ ...VERDICT_THRESHOLDS }, { competitive: 0.7, borderline: 0.5 });
});

test("confidence drops with missing sources, unverified evidence, disagreement and conflicts", () => {
  assert.equal(confidenceFor({ sources: 2, unverified: false, runsDisagree: false, conflicts: 0 }).level, "high");
  assert.equal(confidenceFor({ sources: 1, unverified: false, runsDisagree: false, conflicts: 0 }).level, "medium");
  assert.equal(confidenceFor({ sources: 2, unverified: true, runsDisagree: false, conflicts: 0 }).level, "medium");
  assert.equal(confidenceFor({ sources: 2, unverified: true, runsDisagree: true, conflicts: 0 }).level, "low");
  assert.equal(confidenceFor({ sources: 2, unverified: false, runsDisagree: false, conflicts: 1, lowReason: "no outline" }).level, "low");
  assert.equal(confidenceFor({ sources: 0, unverified: false, runsDisagree: false, conflicts: 0 }).level, "low");
});

test("outline: a missing outline is a low-confidence flag, not a verdict on the candidate", async () => {
  const fx = fixture();
  const essay = { ...fx.essay, outline: [] };
  const r = await blendAnalysis(inputFrom(fx, { essay, outlineVecs: undefined }));
  const o = r.dimensionTrace.find((x) => x.key === "outline")!;
  assert.equal(o.measured, 2, "OUTLINE_MISSING_FRACTION 0.2 of the scale");
  assert.equal(o.confidence, "low");
  assert.match(r.reportParts.dimensions.find((d) => d.key === "outline")!.note ?? "", /Low confidence: .*reading problem/);
});

/* ---------- hand-off ---------- */

test("ranked issues sort by severity x weight x count, and the weakest paragraph is chosen by code", async () => {
  const r = await blendAnalysis(inputFrom(fixture()));
  const impacts = r.rankedIssues.map((i) => i.impact);
  assert.deepEqual(impacts, [...impacts].sort((a, b) => b - a));
  assert.equal(r.rankedIssues[0].type, "drift");
  assert.equal(r.rankedIssues[0].paragraphId, "p5");
  assert.equal(r.rankedIssues[0].impact, 9, "severity 3 x weight 1 x 3 sentences");
  assert.equal(r.weakestParagraphId, "p5", "drift 9 + orphan claim 3");
  const generic = r.rankedIssues.find((i) => i.type === "generic" && i.paragraphId === "p6")!;
  assert.equal(generic.count, 3);
  assert.equal(generic.sentences.length, 3);
  assert.ok(generic.sentences.every((s) => s.text.length > 0));
  assert.ok(!r.rankedIssues.some((i) => i.type === "generic" && i.paragraphId === "p5"), "red sentences are not also counted as generic");
});

test("ranked issues include essay-level gaps with no paragraph", () => {
  const infos = infosFrom([{ p: 0, label: "Claim", deg: 0 }]);
  const colours = colourize([{ p: 0, label: "Claim", deg: 0 }]).colours;
  const out = buildRankedIssues(colours, [{ type: "missing_counter", message: "x" }, { type: "no_position", message: "y" }], ["p1"]);
  assert.deepEqual(out.issues.map((i) => i.type), ["missing_counter", "no_position", "orphan_claim"], "all three tie on impact 3, so they sort by id");
  const essayLevel = out.issues.filter((i) => i.paragraphId === null);
  assert.equal(essayLevel.length, 2);
  assert.equal(out.weakestParagraphId, "p1", "essay-level issues never decide the weakest paragraph");
  assert.equal(infos.length, 1);
});

/* ---------- degradation, embedding and adapters ---------- */

test("without structure labels: no crash, a warning, and only drift and genericness spans", async () => {
  const r = await blendAnalysis(inputFrom(fixture(), { structure: undefined }));
  assert.ok(r.warnings.includes("structure labels unavailable: X-Ray limited"));
  assert.equal(r.xray, null);
  assert.deepEqual(r.links, []);
  assert.deepEqual(r.counters, []);
  const spans = r.reportParts.paragraphs.flatMap((p) => p.spans);
  assert.ok(spans.length > 0);
  const rules = new Set(r.trace.flatMap((t) => t.ruleIds));
  assert.deepEqual([...rules].sort(), ["generic_sentence", "off_topic_paragraph"]);
  assert.ok(!spans.some((s) => s.tone === "strong"), "no green without labels");
  assert.ok(!r.rankedIssues.some((i) => ["orphan_claim", "missing_counter", "no_position"].includes(i.type)));
  assert.equal(r.dimensionTrace.find((x) => x.key === "argument")!.measured, null);
  assert.ok(r.reportParts.paragraphs.every((p) => p.role));
});

test("drift missing: relevance defaults to 100 with a warning and no drift spans", async () => {
  const r = await blendAnalysis(inputFrom(fixture(), { analysis: undefined }));
  assert.ok(r.warnings.some((w) => /relevance unavailable/.test(w)));
  assert.ok(r.reportParts.paragraphs.every((p) => p.relevance === 100));
  assert.ok(!r.trace.some((t) => t.ruleIds.includes("off_topic_paragraph")));
  assert.ok(!r.trace.some((t) => t.ruleIds.includes("strong_link_claim")), "green needs a confirmed on-topic paragraph");
});

test("missing vectors are embedded once, in one batch, only for what linking needs", async () => {
  const fx = fixture();
  const sentences: SentenceRef[] = fx.sentences.map((s: SentenceRef) => ({ ...s, vec: undefined }));
  const byText = new Map<string, number[]>((fx.sentences as SentenceRef[]).map((s) => [s.text, s.vec!]));
  const outlineVec = new Map<string, number[]>((fx.essay.outline as string[]).map((t, i) => [t, fx.outlineVecs[i]]));
  let calls = 0;
  let sent: string[] = [];
  const r = await blendAnalysis(inputFrom(fx, { sentences, outlineVecs: undefined }), {
    embed: async (texts) => { calls++; sent = texts; return texts.map((t) => byText.get(t) ?? outlineVec.get(t) ?? normalize([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])); },
  });
  assert.equal(calls, 1);
  assert.ok(sent.length < sentences.length + fx.essay.outline.length + fx.essay.paragraphs.length, "not every sentence is embedded");
  assert.ok(!sent.includes("Pakistan faces a growing climate emergency."), "a Lead sentence needs no vector");
  assert.equal(r.xray!.claimsTotal, 5);
  assert.equal(r.xray!.claimsOrphan, 2);

  const noEmbed = await blendAnalysis(inputFrom(fx, { sentences, outlineVecs: undefined }));
  assert.ok(noEmbed.warnings.some((w) => /embeddings unavailable/.test(w)));
  assert.ok(noEmbed.warnings.some((w) => /linking skipped/.test(w)));
  assert.equal(noEmbed.xray, null);
  assert.ok(!noEmbed.trace.some((t) => t.ruleIds.includes("orphan_claim")), "never call a claim an orphan without measuring it");
});

test("paragraph role mapping", () => {
  assert.equal(paragraphRole(["Lead", "Position"], "intro"), "position");
  assert.equal(paragraphRole(["Conclusion", "Other"], "conclusion"), "conclusion");
  assert.equal(paragraphRole(["Claim", "Evidence", "Counterclaim"], "body"), "counter-argument");
  assert.equal(paragraphRole(["Claim", "Evidence", "Evidence"], "body"), "evidence");
  assert.equal(paragraphRole(["Claim", "Evidence", "Claim"], "body"), "claim");
  assert.equal(paragraphRole(["Other"], "body"), "claim", "fallback by kind");
  assert.equal(paragraphRole([], "intro"), "position");
  assert.equal(paragraphRole([], "conclusion"), "conclusion");
});

test("adapter: structure module roles become X-Ray labels on our sentence ids", async () => {
  const essay = essayFrom(ESSAY_A);
  const refs = buildSentenceRefs(essay);
  const out = await analyzeEssayStructure({ text: ESSAY_A }, { complete: mockComplete(ESSAY_A_SPECS) });
  assert.ok(out.ok);
  if (!out.ok) return;
  const { sentences, warnings } = labelsFromStructure(out.result, essay, refs);
  assert.deepEqual(warnings, []);
  const label = (id: string) => sentences.find((s) => s.sentenceId === id)?.label;
  assert.equal(label("p1-s1"), "Other", "premise maps to Other");
  assert.equal(label("p1-s2"), "Position");
  assert.equal(label("p2-s1"), "Claim");
  assert.equal(label("p2-s2"), "Evidence");
  assert.equal(label("p2-s3"), "Counterclaim");
  assert.equal(label("p2-s4"), "Rebuttal");
  assert.equal(label("p3-s1"), "Conclusion");
  assert.ok(sentences.every((s) => s.source === "llm"));

  const mismatched = essayFrom("One paragraph only.");
  assert.deepEqual(labelsFromStructure(out.result, mismatched, buildSentenceRefs(mismatched)).sentences, []);
});
