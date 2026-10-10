import { FEATURE_NAMES, featureRecord, type FeatureName, type FeatureVector } from "./features.ts";
import { predictProba, type LogReg, type Metrics } from "./logreg.ts";

/** "unassessed": the sentence was not embedded (essay over the embedding budget). */
export type GenericLevel = "generic" | "mixed" | "specific" | "unassessed";

export interface GenericnessModel extends LogReg {
  featureNames: string[];
  metrics: { train: Metrics; test: Metrics };
  trainedOn: { train: number; test: number; bank: number };
  synthetic: true;
  /** Data-driven cut-offs for reason codes, learned from the generic class. */
  reasonThresholds: { top1BankSim: number; universalityMargin: number };
  levelThresholds: { generic: number; specific: number };
}

export function checkModelFeatures(model: GenericnessModel): void {
  const same = model.featureNames.length === FEATURE_NAMES.length && FEATURE_NAMES.every((n, i) => model.featureNames[i] === n);
  if (!same) throw new Error("data/genericness-model.json was trained with different features. Run: npm run train:genericness");
}

/** sigmoid(w . standardized features + b), 0 (specific) to 1 (generic). */
export function genericnessScore(features: FeatureVector, model: LogReg): number {
  return predictProba(model, features);
}

export function levelFor(score: number, t: GenericnessModel["levelThresholds"]): GenericLevel {
  return score >= t.generic ? "generic" : score <= t.specific ? "specific" : "mixed";
}

export const REASON = {
  filler: "matches known filler",
  anyTopic: "fits any topic",
  noDetail: "no concrete detail",
  cliche: "cliché phrase",
  figures: "concrete figures",
  entities: "named people or institutions",
  pakistan: "Pakistan-specific terms",
} as const;

export function reasonCodes(features: FeatureVector, level: GenericLevel, th: GenericnessModel["reasonThresholds"]): string[] {
  const f = featureRecord(features);
  const codes: string[] = [];
  if (level === "specific") {
    if (f.numbersPer20 > 0) codes.push(REASON.figures);
    if (f.entitiesPer20 > 0) codes.push(REASON.entities);
    if (f.pakistanTerms > 0) codes.push(REASON.pakistan);
    return codes;
  }
  if (f.top1BankSim >= th.top1BankSim) codes.push(REASON.filler);
  if (f.universalityMargin <= th.universalityMargin) codes.push(REASON.anyTopic);
  if (f.numbersPer20 === 0 && f.entitiesPer20 === 0 && f.pakistanTerms === 0) codes.push(REASON.noDetail);
  if (f.clicheHit > 0) codes.push(REASON.cliche);
  return codes;
}

/** Plain-sentence reason for the UI, built only from reason codes. */
export function reasonText(level: GenericLevel, codes: string[]): string {
  if (level === "specific") return codes.length ? `Concrete detail: ${codes.join(", ")}.` : "Specific to this topic.";
  if (level === "generic") return codes.length ? `Generic: ${codes.join(", ")}.` : "Reads as generic filler.";
  return "";
}

export function signalsOf(features: FeatureVector): Record<FeatureName, number> {
  return featureRecord(features);
}
