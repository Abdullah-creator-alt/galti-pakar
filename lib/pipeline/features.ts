import { hasCliche } from "./cliches.ts";
import { countPakistanTerms } from "./pakistanTerms.ts";
import { countTextWords } from "./sentences.ts";
import { cosine, mean, std, topK } from "./vecmath.ts";

export const FEATURE_NAMES = [
  "top1BankSim",
  "top3BankSim",
  "universalityMargin",
  "numbersPer20",
  "entitiesPer20",
  "pakistanTerms",
  "lengthWords",
  "clicheHit",
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureVector = number[];

/** Numbers, years and percentages. */
export function countNumbers(text: string): number {
  return (text.match(/\b\d[\d,]*(\.\d+)?%?|\d+(st|nd|rd|th)\b|\b(percent|per cent)\b/gi) ?? []).length;
}

/** Capitalised words that do not start a sentence. */
export function countEntityTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  let n = 0;
  words.forEach((w, i) => {
    if (i === 0) return;
    const prev = words[i - 1];
    if (/[.!?]["')\]]*$/.test(prev) && !/^[A-Z]\.$/.test(prev)) return; // sentence-initial
    const bare = w.replace(/^[("'‘“]+|[.,;:!?)"'’”]+$/g, "");
    if (/^[A-Z][A-Za-z-]*$/.test(bare) && bare !== "I") n++;
  });
  return n;
}

/** Universality: how much better the best-fitting topic fits than the average topic, in standard deviations. Low means it fits any topic. */
export function universalityMargin(sentenceVec: number[], topicVecs: number[][]): number {
  const sims = topicVecs.map((t) => cosine(sentenceVec, t));
  const s = std(sims);
  return s === 0 ? 0 : (Math.max(...sims) - mean(sims)) / s;
}

/**
 * Numeric features for one sentence. Vectors must be L2-normalised.
 * Order matches FEATURE_NAMES.
 */
export function sentenceFeatures(sentenceVec: number[], sentenceText: string, bankVecs: number[][], topicVecs: number[][]): FeatureVector {
  const bankSims = bankVecs.map((b) => cosine(sentenceVec, b));
  const top = topK(bankSims, 3);
  const words = Math.max(countTextWords(sentenceText), 1);
  const per20 = 20 / words;
  return [
    top[0] ?? 0,
    mean(top),
    universalityMargin(sentenceVec, topicVecs),
    countNumbers(sentenceText) * per20,
    countEntityTokens(sentenceText) * per20,
    countPakistanTerms(sentenceText),
    words,
    hasCliche(sentenceText) ? 1 : 0,
  ];
}

export function featureRecord(f: FeatureVector): Record<FeatureName, number> {
  return Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, f[i]])) as Record<FeatureName, number>;
}
