/**
 * Evaluates topic-drift detection on the synthetic on-topic/off-topic paragraphs.
 * Run: npm run eval:drift   (no API key needed)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DRIFT_THRESHOLD } from "../lib/config.ts";
import { relevance } from "../lib/pipeline/drift.ts";
import { auc } from "../lib/pipeline/logreg.ts";
import { mockReport } from "../lib/mock.ts";
import { cosine } from "../lib/pipeline/vecmath.ts";

const DATA = path.join(process.cwd(), "data");
const read = (f: string) => JSON.parse(readFileSync(path.join(DATA, f), "utf8"));

const topics: { id: string; vec: number[] }[] = read("topics.embedded.json").topics;
const items: { topicId: string; onTopic: boolean; text: string; vec: number[] }[] = read("drift-set.json").items;

// The essay topic is excluded from the bank, as it would be at runtime for a user-typed topic.
const scored = items.map((it) => {
  const topic = topics.find((t) => t.id === it.topicId)!;
  const bank = topics.filter((t) => t.id !== it.topicId).map((t) => t.vec);
  const r = relevance(it.vec, topic.vec, bank);
  return { onTopic: it.onTopic, relevance: r.relevance, raw: r.rawSimilarity };
});

const labels = scored.map((s) => (s.onTopic ? 1 : 0));
const accAt = (th: number) => scored.filter((s) => (s.relevance >= th) === s.onTopic).length / scored.length;
const detail = (th: number) => {
  const off = scored.filter((s) => !s.onTopic);
  const on = scored.filter((s) => s.onTopic);
  return {
    threshold: th,
    accuracy: accAt(th),
    offTopicCaught: off.filter((s) => s.relevance < th).length / off.length,
    onTopicKept: on.filter((s) => s.relevance >= th).length / on.length,
  };
};

let best = { th: 0, acc: -1 };
for (let th = 0; th <= 100; th += 1) {
  const a = accAt(th);
  // Prefer the lowest threshold reaching the best accuracy, to flag as little on-topic writing as possible.
  if (a > best.acc + 1e-9) best = { th, acc: a };
}

const result = {
  synthetic: true,
  n: scored.length,
  uiThreshold: { configured: DRIFT_THRESHOLD, mockReport: mockReport.driftThreshold, ...detail(DRIFT_THRESHOLD) },
  recommended: detail(best.th),
  auc: { percentileRelevance: auc(scored.map((s) => s.relevance), labels), rawCosine: auc(scored.map((s) => s.raw), labels) },
  meanRelevance: {
    onTopic: scored.filter((s) => s.onTopic).reduce((a, s) => a + s.relevance, 0) / scored.filter((s) => s.onTopic).length,
    offTopic: scored.filter((s) => !s.onTopic).reduce((a, s) => a + s.relevance, 0) / scored.filter((s) => !s.onTopic).length,
  },
  meanRawCosine: {
    onTopic: scored.filter((s) => s.onTopic).reduce((a, s) => a + s.raw, 0) / scored.filter((s) => s.onTopic).length,
    offTopic: scored.filter((s) => !s.onTopic).reduce((a, s) => a + s.raw, 0) / scored.filter((s) => !s.onTopic).length,
  },
};
void cosine;
writeFileSync(path.join(DATA, "drift-eval.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
