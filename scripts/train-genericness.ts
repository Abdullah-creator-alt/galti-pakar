/**
 * Trains the genericness logistic regression from data/sentences.embedded.json.
 * Run: npm run train:genericness   (no API key needed)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FEATURE_NAMES, sentenceFeatures } from "../lib/pipeline/features.ts";
import type { GenericnessModel } from "../lib/pipeline/genericness.ts";
import { evaluate, trainLogReg } from "../lib/pipeline/logreg.ts";
import { median } from "../lib/pipeline/stats.ts";

const DATA = path.join(process.cwd(), "data");
const read = (f: string) => JSON.parse(readFileSync(path.join(DATA, f), "utf8"));

interface Row { text: string; label: number; vec: number[] }
const sentences = read("sentences.embedded.json") as { train: Row[]; test: Row[] };
const topicVecs: number[][] = read("topics.embedded.json").topics.map((t: { vec: number[] }) => t.vec);
const bank: number[][] = read("generic-bank.embedded.json").items.map((i: { vec: number[] }) => i.vec);

const featurize = (rows: Row[]) => rows.map((r) => sentenceFeatures(r.vec, r.text, bank, topicVecs));
const Xtr = featurize(sentences.train);
const ytr = sentences.train.map((r) => r.label);
const Xte = featurize(sentences.test);
const yte = sentences.test.map((r) => r.label);

const model = trainLogReg(Xtr, ytr, { epochs: 3000, learningRate: 0.1, l2: 0.01 });
const train = evaluate(model, Xtr, ytr);
const test = evaluate(model, Xte, yte);

const fmt = (m: typeof train) =>
  `accuracy ${(m.accuracy * 100).toFixed(1)}%  precision ${(m.precision * 100).toFixed(1)}%  recall ${(m.recall * 100).toFixed(1)}%  AUC ${m.auc.toFixed(3)}  (n=${m.n})`;
console.log("Train:", fmt(train));
console.log("Test: ", fmt(test));
console.log("\nWeights (on standardised features; positive = more generic):");
FEATURE_NAMES.forEach((n, j) => console.log(`  ${n.padEnd(20)} ${model.weights[j].toFixed(3).padStart(8)}   (mean ${model.means[j].toFixed(2)}, sd ${model.stds[j].toFixed(2)})`));
console.log(`  ${"bias".padEnd(20)} ${model.bias.toFixed(3).padStart(8)}`);

// Reason-code cut-offs come from the generic class in the training data.
const genericTrain = Xtr.filter((_, i) => ytr[i] === 1);
const out: GenericnessModel = {
  featureNames: [...FEATURE_NAMES],
  means: model.means,
  stds: model.stds,
  weights: model.weights,
  bias: model.bias,
  metrics: { train, test },
  trainedOn: { train: Xtr.length, test: Xte.length, bank: bank.length },
  synthetic: true,
  reasonThresholds: {
    top1BankSim: median(genericTrain.map((x) => x[0])),
    universalityMargin: median(genericTrain.map((x) => x[2])),
  },
  levelThresholds: { generic: 0.65, specific: 0.35 },
};
writeFileSync(path.join(DATA, "genericness-model.json"), JSON.stringify(out, null, 2));
console.log("\nWrote data/genericness-model.json", out.reasonThresholds);
