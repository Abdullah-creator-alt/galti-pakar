import { countCliches } from "./cliches.ts";
import type { Distribution, ProfileFeature, ProfileRow } from "./benchmark.types.ts";
import { countEntityTokens, countNumbers, sentenceFeatures, type FeatureVector } from "./features.ts";
import { genericnessScore, levelFor, type GenericnessModel } from "./genericness.ts";
import { countPakistanTerms } from "./pakistanTerms.ts";
import { countTextWords } from "./sentences.ts";
import { mean } from "./vecmath.ts";

export interface ProfileAssets {
  topicVecs: number[][];
  bankVecs: number[][];
  model: GenericnessModel;
}

export interface ProfileSentence {
  text: string;
  vec: number[];
  features?: FeatureVector;
}

export const PROFILE_META: Record<ProfileFeature, { label: string; better: "higher" | "lower" | "neutral"; decimals: number }> = {
  specifics: { label: "Concrete details per 100 words", better: "higher", decimals: 1 },
  cliches: { label: "Clichés per 100 words", better: "lower", decimals: 2 },
  meanGenericness: { label: "Average genericness (0 to 1)", better: "lower", decimals: 2 },
  genericShare: { label: "Share of generic sentences", better: "lower", decimals: 2 },
  meanSentenceLength: { label: "Average sentence length (words)", better: "neutral", decimals: 1 },
  typeTokenRatio: { label: "Vocabulary variety (first 1000 words)", better: "neutral", decimals: 2 },
};

/** Type-token ratio over the first 1000 words (a fixed window, so essay length does not change the denominator). */
export function typeTokenRatio(text: string, window = 1000): number {
  const tokens = (text.toLowerCase().match(/[a-z']+/g) ?? []).slice(0, window);
  return tokens.length ? new Set(tokens).size / tokens.length : 0;
}

/**
 * Per-100-word style features of one essay, from its sentences and their embeddings.
 * Raw word count is never a feature.
 */
export function essayProfile(sentences: ProfileSentence[], assets: ProfileAssets): Record<ProfileFeature, number> {
  if (sentences.length === 0) throw new Error("essayProfile needs at least one sentence.");
  const words = sentences.reduce((n, s) => n + countTextWords(s.text), 0);
  const per100 = (x: number) => (words ? (x / words) * 100 : 0);

  let details = 0;
  let cliches = 0;
  const scores: number[] = [];
  for (const s of sentences) {
    details += countNumbers(s.text) + countEntityTokens(s.text) + countPakistanTerms(s.text);
    cliches += countCliches(s.text);
    const f = s.features ?? sentenceFeatures(s.vec, s.text, assets.bankVecs, assets.topicVecs);
    scores.push(genericnessScore(f, assets.model));
  }
  return {
    specifics: per100(details),
    cliches: per100(cliches),
    meanGenericness: mean(scores),
    genericShare: scores.filter((x) => levelFor(x, assets.model.levelThresholds) === "generic").length / scores.length,
    meanSentenceLength: words / sentences.length,
    typeTokenRatio: typeTokenRatio(sentences.map((s) => s.text).join(" ")),
  };
}

export function position(value: number, d: Distribution): "below" | "within" | "above" {
  return value < d.q1 ? "below" : value > d.q3 ? "above" : "within";
}

/** Plain-language note built only from the numbers. */
export function profileNote(feature: ProfileFeature, pos: "below" | "within" | "above", d: Distribution): string {
  const meta = PROFILE_META[feature];
  const f = (x: number) => x.toFixed(meta.decimals);
  const range = `${f(d.q1)} to ${f(d.q3)}`;
  if (pos === "within") return `Within the middle half of reference essays (${range}).`;
  const side = pos === "below" ? "Below" : "Above";
  const base = `${side} the middle half of reference essays (${range}, median ${f(d.median)}).`;
  if (meta.better === "neutral") return `${base} Neither direction is better by itself.`;
  const favourable = (pos === "above") === (meta.better === "higher");
  return favourable ? base : `${base} Reference essays usually score ${meta.better} here.`;
}

export function profileRows(values: Record<ProfileFeature, number>, dists: Record<string, Distribution>, features: readonly ProfileFeature[]): ProfileRow[] {
  const rows: ProfileRow[] = [];
  for (const feature of features) {
    const d = dists[feature];
    if (!d || d.n === 0) continue;
    const pos = position(values[feature], d);
    rows.push({
      feature,
      label: PROFILE_META[feature].label,
      value: Math.round(values[feature] * 1000) / 1000,
      refMedian: d.median,
      refQ1: d.q1,
      refQ3: d.q3,
      position: pos,
      betterDirection: PROFILE_META[feature].better,
      note: profileNote(feature, pos, d),
    });
  }
  return rows;
}
