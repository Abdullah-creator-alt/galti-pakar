/**
 * Regenerates data/fixtures/essay1.json: a small hand-made essay (8 paragraphs) with deterministic fake vectors,
 * structure labels, drift, genericness and a fake examiner second opinion. No API key needed.
 * Deliberate cases: a strong link, a weak link, two orphan claims (one in a drifting paragraph), an unrebutted
 * counterclaim, a drifting paragraph (p5), a generic paragraph (p6), and an examiner that over-praises Evidence.
 * Run: node --no-warnings scripts/make-fixture.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { aggregate } from "../lib/pipeline/examiner.ts";
import { RUBRIC_KEYS, type RunResult } from "../lib/pipeline/findings.types.ts";
import { countTextWords } from "../lib/pipeline/sentences.ts";
import { normalize, roundVec } from "../lib/pipeline/vecmath.ts";
import { verifyDimension } from "../lib/pipeline/verifyQuotes.ts";
import type { RubricKey } from "../lib/types.ts";

type Label = "Lead" | "Position" | "Claim" | "Evidence" | "Counterclaim" | "Rebuttal" | "Conclusion" | "Other";
type Level = "generic" | "mixed" | "specific";
const AXES = { agri: 0, floods: 1, dev: 2, edu: 3, generic: 4, energy: 5, intro: 6, concl: 7, heat: 8 };
const DIM = 12;

/** Deterministic vector: weighted axes plus a tiny repeatable perturbation. */
function vec(w: Partial<Record<keyof typeof AXES, number>>, seed: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const [k, x] of Object.entries(w)) v[AXES[k as keyof typeof AXES]] += x as number;
  for (let i = 0; i < DIM; i++) v[i] += 0.01 * Math.sin(seed * 12.9898 + i * 78.233);
  return roundVec(normalize(v), 4);
}

interface S { text: string; label: Label; axes: Partial<Record<keyof typeof AXES, number>>; level: Level; score: number }
const P: { kind: "intro" | "body" | "conclusion"; relevance: number; s: S[] }[] = [
  { kind: "intro", relevance: 96, s: [
    { text: "Pakistan faces a growing climate emergency.", label: "Lead", axes: { intro: 1 }, level: "mixed", score: 0.5 },
    { text: "This essay argues that spending on adaptation is the central economic question of the decade.", label: "Position", axes: { intro: 1, dev: 0.3 }, level: "mixed", score: 0.45 },
  ] },
  { kind: "body", relevance: 97, s: [
    { text: "Agriculture is the first sector hit by warming.", label: "Claim", axes: { agri: 1 }, level: "mixed", score: 0.5 },
    { text: "Wheat yields in Punjab fell by about ten percent after the 2022 heatwave, according to the Economic Survey.", label: "Evidence", axes: { agri: 1 }, level: "specific", score: 0.05 },
    { text: "Heat also shortens the wheat sowing window.", label: "Claim", axes: { agri: 1, heat: 0.8 }, level: "mixed", score: 0.5 },
  ] },
  { kind: "body", relevance: 95, s: [
    { text: "Floods have damaged public finances badly.", label: "Claim", axes: { floods: 1 }, level: "mixed", score: 0.5 },
    { text: "Many people agree with this view.", label: "Other", axes: { generic: 1 }, level: "generic", score: 0.8 },
  ] },
  { kind: "body", relevance: 94, s: [
    { text: "Some argue that development must come before adaptation spending.", label: "Counterclaim", axes: { dev: 1 }, level: "mixed", score: 0.5 },
    { text: "This is a common opinion in many countries.", label: "Other", axes: { generic: 1 }, level: "generic", score: 0.7 },
  ] },
  { kind: "body", relevance: 38, s: [
    { text: "Education has been neglected for decades in Pakistan and the problem keeps growing.", label: "Claim", axes: { edu: 1 }, level: "mixed", score: 0.5 },
    { text: "Teachers are underpaid and syllabi are outdated in most public schools across the country.", label: "Other", axes: { edu: 1 }, level: "mixed", score: 0.5 },
    { text: "Many schools lack basic facilities such as classrooms, desks and clean drinking water.", label: "Other", axes: { edu: 1 }, level: "mixed", score: 0.5 },
  ] },
  { kind: "body", relevance: 91, s: [
    { text: "Throughout history great nations have risen through unity and hard work.", label: "Other", axes: { generic: 1 }, level: "generic", score: 0.95 },
    { text: "Every society faces challenges and Pakistan is no different.", label: "Other", axes: { generic: 1 }, level: "generic", score: 0.9 },
    { text: "Where there is a will there is a way.", label: "Other", axes: { generic: 1 }, level: "generic", score: 0.97 },
  ] },
  { kind: "body", relevance: 96, s: [
    { text: "Solar power can cut the fuel import bill.", label: "Claim", axes: { energy: 1 }, level: "mixed", score: 0.5 },
    { text: "Pakistan spent about 17 billion dollars on fuel imports in 2022, according to the State Bank of Pakistan.", label: "Evidence", axes: { energy: 1 }, level: "specific", score: 0.08 },
  ] },
  { kind: "conclusion", relevance: 97, s: [
    { text: "In conclusion, spending on adaptation protects growth.", label: "Conclusion", axes: { concl: 1 }, level: "mixed", score: 0.5 },
    { text: "The time to act is now.", label: "Other", axes: { generic: 1 }, level: "generic", score: 0.85 },
  ] },
];

const outline = [
  { text: "Intro: climate emergency", axes: { intro: 1 } },
  { text: "Agriculture and wheat", axes: { agri: 1 } },
  { text: "Floods and finance", axes: { floods: 1 } },
  { text: "Energy and solar", axes: { energy: 1 } },
  { text: "Conclusion", axes: { concl: 1 } },
];

let seed = 1;
const paragraphs = P.map((p, pi) => {
  let text = "";
  const sentences = p.s.map((s, si) => {
    const start = text.length ? text.length + 1 : 0;
    text = text.length ? `${text} ${s.text}` : s.text;
    return { id: `p${pi + 1}-s${si + 1}`, paragraphId: `p${pi + 1}`, start, end: start + s.text.length, text: s.text, vec: vec(s.axes, seed++), meta: s };
  });
  return { id: `p${pi + 1}`, kind: p.kind, text, pageIndex: 0, relevance: p.relevance, sentences };
});

const essay = {
  outline: outline.map((o) => o.text),
  paragraphs: paragraphs.map(({ id, kind, text, pageIndex }) => ({ id, kind, text, pageIndex })),
  uncertain: [],
  legibility: "good",
  warnings: [],
  wordCount: paragraphs.reduce((n, p) => n + countTextWords(p.text), 0),
};
const sentences = paragraphs.flatMap((p) => p.sentences.map(({ meta: _m, ...s }) => s));
const structure = {
  labelAgreementRate: 0.82,
  sentences: paragraphs.flatMap((p, pi) => p.sentences.filter((s) => s.meta.label !== "Other").map((s, k) => ({ sentenceId: s.id, label: s.meta.label, source: (k + pi) % 2 ? "consensus" : "llm", confidence: 0.8 }))),
};
const analysis = {
  paragraphs: paragraphs.map((p) => {
    const scores = p.sentences.map((s) => s.meta.score);
    return {
      id: p.id, relevance: p.relevance, rawSimilarity: 0.8, driftFlag: p.relevance < 90,
      avgGenericScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      sentences: p.sentences.map((s) => ({ start: s.start, end: s.end, genericScore: s.meta.score, level: s.meta.level, signals: null, reasonCodes: s.meta.level === "generic" ? ["no concrete detail"] : [] })),
    };
  }),
  genericShare: sentences.filter((s) => P.flatMap((p) => p.s).find((x) => x.text === s.text)!.level === "generic").length / sentences.length,
  specificityPer100Words: 4.2,
  driftingParagraphIds: ["p5"],
  embedTextCount: 0,
  unassessedSentences: 0,
};

/* Fake examiner second opinion, built with the real verification and aggregation code. */
const sources = [...essay.paragraphs.map((p) => ({ id: p.id, text: p.text })), { id: "outline", text: essay.outline.join("\n") }];
const dim = (score: number, reason: string, quote: string | null, absence = false) => ({ score, reason, quotes: quote ? [quote] : [], absence });
const runSpecs: Record<RubricKey, [ReturnType<typeof dim>, ReturnType<typeof dim>]> = {
  thesis: [dim(7.5, "Clear position stated early.", "spending on adaptation is the central economic question of the decade"), dim(7.5, "The thesis is explicit.", "This essay argues that spending on adaptation")],
  outline: [dim(6, "Outline matches most of the essay.", "Agriculture and wheat"), dim(6.5, "Outline is brief but relevant.", "Floods and finance")],
  argument: [dim(7, "Claims connect to the position.", "Agriculture is the first sector hit by warming"), dim(7, "Reasoned claims.", "Solar power can cut the fuel import bill")],
  evidence: [dim(8, "Specific figures in two paragraphs.", "Wheat yields in Punjab fell by about ten percent"), dim(8.5, "Good use of sources.", "17 billion dollars on fuel imports in 2022")],
  "counter-argument": [dim(5, "Opposing view raised, not answered.", "development must come before adaptation spending"), dim(5.5, "A counterclaim appears.", "Some argue that development")],
  coherence: [dim(7.5, "Transitions are mostly clear.", "In conclusion, spending on adaptation protects growth"), dim(7, "Reads as one line of thought.", "The time to act is now")],
  language: [dim(6.5, "Clear but with stock phrasing.", "Throughout history great nations have risen through unity and hard work"), dim(7, "Controlled language.", "Every society faces challenges")],
};
const run = (i: 0 | 1): RunResult => ({
  index: i + 1,
  model: "fixture",
  dimensions: Object.fromEntries(RUBRIC_KEYS.map((k) => [k, verifyDimension(k, runSpecs[k][i], sources, {})])) as RunResult["dimensions"],
});
const examiner = aggregate([run(0), run(1)], essay, 0);

const out = { topic: "Climate change and Pakistan's economic future", essay, sentences, structure, analysis, examiner, outlineVecs: outline.map((o, i) => vec(o.axes, 100 + i)) };
const file = path.join(process.cwd(), "data", "fixtures", "essay1.json");
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`Wrote ${file}: ${paragraphs.length} paragraphs, ${sentences.length} sentences, ${essay.wordCount} words.`);
