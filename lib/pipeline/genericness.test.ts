import test from "node:test";
import assert from "node:assert/strict";
import { cosine, mean, normalize, percentileRank, std } from "./vecmath.ts";
import { splitSentences } from "./sentences.ts";
import { countEntityTokens, countNumbers, FEATURE_NAMES, sentenceFeatures } from "./features.ts";
import { hasCliche } from "./cliches.ts";
import { countPakistanTerms } from "./pakistanTerms.ts";
import { auc, evaluate, predictProba, seededShuffle, trainLogReg } from "./logreg.ts";
import { relevance } from "./drift.ts";
import { analyseGenericnessAndDrift, toSpans } from "./analyse.ts";
import type { Assets } from "./dataFiles.ts";
import type { GenericnessModel } from "./genericness.ts";

/** Deterministic fake embedding: a 16-d vector from character codes, L2-normalised. */
function fakeVec(text: string): number[] {
  const v = new Array<number>(16).fill(0);
  for (let i = 0; i < text.length; i++) v[(text.charCodeAt(i) * 7 + i) % 16] += 1 + (text.charCodeAt(i) % 5);
  return normalize(v);
}
const fakeEmbed = async (texts: string[]) => texts.map(fakeVec);

test("vecmath", () => {
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosine([1, 2, 3], [2, 4, 6]) - 1) < 1e-12);
  const n = normalize([3, 4]);
  assert.ok(Math.abs(n[0] - 0.6) < 1e-12 && Math.abs(n[1] - 0.8) < 1e-12);
  assert.deepEqual(normalize([0, 0]), [0, 0]);
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.ok(Math.abs(std([2, 4, 4, 4, 5, 5, 7, 9]) - 2) < 1e-12);
  assert.equal(percentileRank(5, [1, 2, 3, 4, 5]), 90); // 4 below, 1 tie counted half, of 5
  assert.equal(percentileRank(10, [1, 2, 3]), 100);
  assert.equal(percentileRank(0, [1, 2, 3]), 0);
});

test("sentence splitter returns exact offsets and respects abbreviations and decimals", () => {
  const text = "Mr. Khan met Dr. Ali in the U.S. last year. The GDP grew 3.5% in 2020! Is e.g. this fine? Yes.";
  const spans = splitSentences(text);
  for (const s of spans) assert.equal(text.slice(s.start, s.end), s.text);
  assert.deepEqual(spans.map((s) => s.text), [
    "Mr. Khan met Dr. Ali in the U.S. last year.",
    "The GDP grew 3.5% in 2020!",
    "Is e.g. this fine?",
    "Yes.",
  ]);
  assert.deepEqual(splitSentences("  Single sentence with no end  ").map((s) => s.text), ["Single sentence with no end"]);
  assert.deepEqual(splitSentences(""), []);
});

test("feature counters", () => {
  assert.equal(countNumbers("In 2020 GDP grew 3.5% and 1,200 schools opened, the 18th time."), 4);
  assert.equal(countEntityTokens("The State Bank of Pakistan raised rates in Karachi."), 4); // State Bank Pakistan Karachi (The is initial; Bank/State both capitalised)
  assert.equal(hasCliche("In today's modern world, people face problems."), true);
  assert.equal(hasCliche("The NFC Award redistributes revenue."), false);
  assert.equal(countPakistanTerms("The NFC Award and the 18th Amendment shaped the IMF programme."), 3);
  assert.equal(countPakistanTerms("The IMF met in new york."), 1, "short acronyms are case-sensitive");
  assert.equal(countPakistanTerms("the imf met"), 0);
});

test("sentenceFeatures has the named layout and sensible values", () => {
  const bank = [fakeVec("education is the key to success"), fakeVec("youth is the future")];
  const topics = ["water", "tax", "terrorism", "media"].map(fakeVec);
  const text = "The IMF approved 3 billion dollars for Pakistan in 2023.";
  const f = sentenceFeatures(fakeVec(text), text, bank, topics);
  assert.equal(f.length, FEATURE_NAMES.length);
  assert.ok(f[0] >= f[1] - 1e-12, "top1 >= mean of top3");
  assert.ok(f[3] > 0 && f[4] > 0 && f[5] >= 1 && f[6] === 10 && f[7] === 0);
  const g = sentenceFeatures(fakeVec("In today's modern world life is hard."), "In today's modern world life is hard.", bank, topics);
  assert.equal(g[7], 1);
  assert.equal(g[3], 0);
});

test("logistic regression separates a toy set and AUC is right", () => {
  const X: number[][] = [];
  const y: number[] = [];
  const rnd = seededShuffle(Array.from({ length: 40 }, (_, i) => i), 7);
  for (const i of rnd) {
    const label = i % 2;
    X.push([label ? 2 + (i % 5) * 0.1 : -2 - (i % 5) * 0.1, (i % 3) * 0.01]);
    y.push(label);
  }
  const m = trainLogReg(X, y, { epochs: 1500 });
  const ev = evaluate(m, X, y);
  assert.equal(ev.accuracy, 1);
  assert.equal(ev.auc, 1);
  assert.ok(predictProba(m, [3, 0]) > 0.9 && predictProba(m, [-3, 0]) < 0.1);
  assert.ok(m.weights[0] > 0);
  assert.equal(auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]), 0.75);
  assert.deepEqual(seededShuffle([1, 2, 3, 4, 5], 1), seededShuffle([1, 2, 3, 4, 5], 1), "deterministic");
});

test("relevance ranks the essay topic against the bank", () => {
  const topic = normalize([1, 0, 0, 0]);
  const bank = [normalize([0, 1, 0, 0]), normalize([0, 0, 1, 0]), normalize([0.2, 0, 0, 1])];
  const onTopic = relevance(normalize([0.9, 0.1, 0, 0]), topic, bank);
  assert.ok(onTopic.relevance >= 87, `on-topic relevance ${onTopic.relevance}`);
  assert.ok(onTopic.rawSimilarity > 0.9);
  const off = relevance(normalize([0, 0.1, 0.9, 0]), topic, bank); // closest to a bank topic, not the essay topic
  assert.ok(off.relevance <= 40, `off-topic relevance ${off.relevance}`);
});

function fakeAssets(): Assets {
  const model: GenericnessModel = {
    featureNames: [...FEATURE_NAMES],
    means: new Array(8).fill(0),
    stds: new Array(8).fill(1),
    weights: [0, 0, 0, 0, 0, 0, 0, 6], // only the cliché flag drives the score
    bias: -2,
    metrics: { train: { accuracy: 1, precision: 1, recall: 1, auc: 1, n: 1 }, test: { accuracy: 1, precision: 1, recall: 1, auc: 1, n: 1 } },
    trainedOn: { train: 1, test: 1, bank: 1 },
    synthetic: true,
    reasonThresholds: { top1BankSim: 0.5, universalityMargin: 1 },
    levelThresholds: { generic: 0.65, specific: 0.35 },
  };
  return {
    topics: ["water scarcity", "tax reform", "terrorism"].map((text, i) => ({ id: `t${i}`, theme: "x", text, vec: fakeVec(text) })),
    bankVecs: [fakeVec("in today's modern world")],
    model,
  };
}

test("analyseGenericnessAndDrift: shape, offsets, spans and call counting (mocked embeddings)", async () => {
  const paragraphs = [
    { id: "p1", text: "In today's modern world water is vital. The IMF approved 3 billion dollars in 2023. Many people think so." },
    { id: "p2", text: "Cricket is popular." },
  ];
  let calls = 0;
  const a = await analyseGenericnessAndDrift("water scarcity", paragraphs, {
    assets: fakeAssets(),
    embed: async (t) => (calls++, fakeEmbed(t)),
  });
  assert.equal(calls, 1, "one embed call covers topic, paragraphs and sentences");
  assert.equal(a.embedTextCount, 1 + 2 + 4);
  assert.equal(a.paragraphs.length, 2);
  const p1 = a.paragraphs[0];
  assert.equal(p1.sentences.length, 3);
  for (const s of p1.sentences) assert.ok(paragraphs[0].text.slice(s.start, s.end).length > 0);
  assert.equal(p1.sentences[0].level, "generic");
  assert.equal(p1.sentences[1].level, "specific");
  assert.ok(p1.sentences[0].reasonCodes.includes("cliché phrase"));
  assert.ok(p1.sentences[1].reasonCodes.includes("concrete figures"));
  assert.ok(a.genericShare > 0 && a.genericShare < 1);
  assert.ok(a.specificityPer100Words > 0);
  assert.deepEqual(a.driftingParagraphIds, a.paragraphs.filter((p) => p.driftFlag).map((p) => p.id));

  const spans = toSpans(p1);
  assert.ok(spans.every((s) => s.tone === "weak" || s.tone === "strong"));
  assert.ok(spans.every((s) => s.reason.length > 0 && s.end > s.start));
  assert.equal(spans.find((s) => s.tone === "weak")?.reason.startsWith("Generic:"), true);
});

test("analyse throws a clear error if embeddings come back short", async () => {
  await assert.rejects(
    analyseGenericnessAndDrift("t", [{ id: "p1", text: "One sentence." }], { assets: fakeAssets(), embed: async () => [] }),
    /Embedding returned 0 vectors/,
  );
});

test("essays over the embedding budget keep the longest sentences and mark the rest unassessed", async () => {
  const sentences = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} ${"word ".repeat(i + 1)}ends here.`);
  const paragraphs = [{ id: "p1", text: sentences.slice(0, 6).join(" ") }, { id: "p2", text: sentences.slice(6).join(" ") }];
  let sent = 0;
  const a = await analyseGenericnessAndDrift("water", paragraphs, {
    assets: fakeAssets(),
    embedBudget: 1 + 2 + 5, // topic + 2 paragraphs + room for 5 sentences
    embed: async (t) => ((sent = t.length), fakeEmbed(t)),
  });
  assert.equal(sent, 8, "never embeds more than the budget");
  assert.equal(a.embedTextCount, 8);
  assert.equal(a.unassessedSentences, 7);
  const levels = a.paragraphs.flatMap((p) => p.sentences.map((s) => s.level));
  assert.equal(levels.filter((l) => l === "unassessed").length, 7);
  // The 5 longest sentences are the last 5 of p2.
  assert.ok(a.paragraphs[1].sentences.slice(1).every((s) => s.level !== "unassessed"));
  assert.ok(a.paragraphs[0].sentences.every((s) => s.level === "unassessed" && s.genericScore === null && s.signals === null));
  assert.equal(a.paragraphs[0].avgGenericScore, null);
  assert.equal(toSpans(a.paragraphs[0]).length, 0, "unassessed sentences are never highlighted");
});

test("rate-limit hint is parsed from Gemini 429 messages", async () => {
  const { parseRetryHint } = await import("./embed.ts");
  assert.equal(parseRetryHint("quota exceeded. Please retry in 41.597081876s."), 41.597081876);
  assert.ok(Number.isNaN(parseRetryHint("something else")));
});
