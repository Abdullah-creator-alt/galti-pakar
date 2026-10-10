/** Measured signal per rubric dimension, on the same 0..outOf scale as the examiner. Each says how it was computed. */
import type { RubricKey } from "../types.ts";
import type { EssayAnalysis } from "./analyse.ts";
import { SIGNALS } from "./blendConfig.ts";
import type { CounterResult, XRayStats } from "./blend.types.ts";
import { countCliches } from "./cliches.ts";
import { countTextWords } from "./sentences.ts";
import type { TranscribedEssay } from "./transcribe.types.ts";
import { cosine, mean, std } from "./vecmath.ts";
import type { SentenceInfo } from "./xray.ts";

export interface MeasuredSignal {
  value: number | null;
  components: Record<string, number>;
  explanation: string;
  /** Set when the signal itself may be unreliable (for example no outline transcribed). */
  lowConfidenceReason?: string;
}

export interface MeasuredContext {
  essay: Pick<TranscribedEssay, "paragraphs" | "outline">;
  outOf: number;
  infos: SentenceInfo[];
  analysis?: EssayAnalysis;
  structureAvailable: boolean;
  linksAvailable: boolean;
  stats: XRayStats | null;
  counters: CounterResult[];
  relevance: Map<string, number>;
  driftThreshold: number;
  outlineVecs?: number[][];
  paragraphVecs?: (number[] | undefined)[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const none = (why: string): MeasuredSignal => ({ value: null, components: {}, explanation: why });
const STOP = new Set("that this with have from they were been their which would there about these those into than then them when what will your more also some such only over very much many most other because while where being could should might must".split(" "));

function thesis(c: MeasuredContext): MeasuredSignal {
  const posInfos = c.infos.filter((i) => i.label?.label === "Position");
  const introIdx = Math.max(c.essay.paragraphs.findIndex((p) => p.kind === "intro"), 0);
  const presence = !c.structureAvailable ? undefined : posInfos.some((i) => i.paragraphIndex === introIdx) ? 1 : posInfos.length ? 0.5 : 0;
  const pIdx = posInfos.length ? posInfos[0].paragraphIndex : introIdx;
  const rel = c.relevance.get(c.essay.paragraphs[pIdx]?.id ?? "");
  const relFrac = rel === undefined ? undefined : rel / 100;
  if (presence === undefined && relFrac === undefined) return none("Needs structure labels or the drift result.");
  const w = SIGNALS.THESIS_RELEVANCE_WEIGHT;
  const value = presence !== undefined && relFrac !== undefined ? w * relFrac + (1 - w) * presence : (presence ?? relFrac)!;
  return {
    value: value * c.outOf,
    components: { ...(relFrac !== undefined ? { relevance: r2(relFrac) } : {}), ...(presence !== undefined ? { positionPresence: presence } : {}) },
    explanation: `${presence === 1 ? "A position sentence is in the introduction" : presence === 0.5 ? "A position sentence appears, but not in the introduction" : presence === 0 ? "No position sentence was found" : "Position not checked (no structure labels)"}${relFrac !== undefined ? `; its paragraph's relevance to the topic is ${Math.round(rel!)}` : ""}.`,
  };
}

function outline(c: MeasuredContext): MeasuredSignal {
  const lines = c.essay.outline;
  if (lines.length === 0) {
    return {
      value: SIGNALS.OUTLINE_MISSING_FRACTION * c.outOf,
      components: { outlineLines: 0 },
      explanation: "No outline was transcribed.",
      lowConfidenceReason: "no outline was transcribed; this may be a reading problem, not the candidate's",
    };
  }
  const lv = c.outlineVecs;
  const pv = (c.paragraphVecs ?? []).filter((v): v is number[] => !!v);
  if (!lv || lv.length !== lines.length || pv.length === 0) return none("Outline vectors unavailable.");
  const th = SIGNALS.OUTLINE_MATCH_SIM;
  const linesMatched = lines.filter((_, i) => Math.max(...pv.map((p) => cosine(lv[i], p))) >= th).length / lines.length;
  const bodyIdx = c.essay.paragraphs.map((p, i) => (p.kind === "body" ? i : -1)).filter((i) => i >= 0);
  const body = (bodyIdx.length ? bodyIdx : c.essay.paragraphs.map((_, i) => i)).map((i) => c.paragraphVecs?.[i]).filter((v): v is number[] => !!v);
  const parasMatched = body.length ? body.filter((p) => Math.max(...lv.map((l) => cosine(l, p))) >= th).length / body.length : 0;
  return {
    value: ((linesMatched + parasMatched) / 2) * c.outOf,
    components: { outlineLines: lines.length, linesMatched: r2(linesMatched), paragraphsMatched: r2(parasMatched) },
    explanation: `${Math.round(linesMatched * 100)}% of outline lines match a paragraph and ${Math.round(parasMatched * 100)}% of body paragraphs match an outline line (cosine at least ${th}).`,
  };
}

function argument(c: MeasuredContext): MeasuredSignal {
  if (!c.linksAvailable || !c.stats) return none("Needs structure labels and sentence vectors.");
  if (c.stats.claimsTotal === 0) return { value: 0, components: { claims: 0 }, explanation: "No claims were labelled." };
  const s = c.stats;
  return {
    value: s.claimsLinkedShare * c.outOf,
    components: { claims: s.claimsTotal, strong: s.claimsStrong, weak: s.claimsWeak, orphan: s.claimsOrphan, linkedShare: r2(s.claimsLinkedShare) },
    explanation: `${s.claimsStrong} strong, ${s.claimsWeak} weak and ${s.claimsOrphan} orphan out of ${s.claimsTotal} claims.`,
  };
}

function evidence(c: MeasuredContext): MeasuredSignal {
  const spec = c.analysis ? Math.min(1, c.analysis.specificityPer100Words / SIGNALS.SPECIFICITY_FULL) : undefined;
  const strong = c.linksAvailable && c.stats && c.stats.claimsTotal > 0 ? c.stats.claimsStrong / c.stats.claimsTotal : undefined;
  if (spec === undefined && strong === undefined) return none("Needs genericness results or claim links.");
  const w = SIGNALS.EVIDENCE_SPECIFICITY_WEIGHT;
  const v = spec !== undefined && strong !== undefined ? w * spec + (1 - w) * strong : (spec ?? strong)!;
  return {
    value: v * c.outOf,
    components: { ...(spec !== undefined ? { specificity: r2(spec), detailsPer100Words: r2(c.analysis!.specificityPer100Words) } : {}), ...(strong !== undefined ? { strongLinkShare: r2(strong) } : {}) },
    explanation: `${c.analysis ? `${c.analysis.specificityPer100Words.toFixed(1)} concrete details per 100 words (full credit at ${SIGNALS.SPECIFICITY_FULL})` : "specificity unavailable"}${strong !== undefined ? `; ${Math.round(strong * 100)}% of claims strongly linked to evidence` : ""}.`,
  };
}

function counter(c: MeasuredContext): MeasuredSignal {
  if (!c.structureAvailable) return none("Needs structure labels.");
  if (c.counters.length === 0) return { value: 0, components: { counterclaims: 0 }, explanation: "No counterclaim was found." };
  const rebutted = c.counters.filter((x) => x.status === "rebutted").length;
  const v = rebutted === 0 ? 0.5 : 0.5 + 0.5 * (rebutted / c.counters.length);
  return {
    value: v * c.outOf,
    components: { counterclaims: c.counters.length, rebutted },
    explanation: rebutted === 0 ? `${c.counters.length} opposing view(s) raised, none answered.` : `${rebutted} of ${c.counters.length} opposing view(s) answered.`,
  };
}

function coherence(c: MeasuredContext): MeasuredSignal {
  const rels = c.essay.paragraphs.map((p) => c.relevance.get(p.id)).filter((x): x is number => x !== undefined);
  if (rels.length === 0) return none("Needs the drift result.");
  const share = rels.filter((r) => r >= c.driftThreshold).length / rels.length;
  const meanRel = mean(rels) / 100;
  const w = SIGNALS.COHERENCE_SHARE_WEIGHT;
  return {
    value: (w * share + (1 - w) * meanRel) * c.outOf,
    components: { onTopicShare: r2(share), meanRelevance: r2(meanRel) },
    explanation: `${Math.round(share * 100)}% of paragraphs are on topic; mean relevance ${Math.round(meanRel * 100)}.`,
  };
}

function language(c: MeasuredContext): MeasuredSignal {
  const sentences = c.infos.map((i) => i.ref.text);
  const words = sentences.reduce((n, s) => n + countTextWords(s), 0);
  if (words === 0) return none("No text.");
  const clicheRate = (sentences.reduce((n, s) => n + countCliches(s), 0) / words) * 100;
  const clicheScore = 1 - Math.min(1, clicheRate / SIGNALS.CLICHE_RATE_ZERO);
  const tokens = (sentences.join(" ").toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((t) => !STOP.has(t));
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  const repeatRate = tokens.length ? tokens.filter((t) => (counts.get(t) ?? 0) >= SIGNALS.REPEAT_MIN_USES).length / tokens.length : 0;
  const repeatScore = 1 - Math.min(1, repeatRate / SIGNALS.REPEAT_RATE_ZERO);
  const lens = sentences.map(countTextWords);
  const cv = lens.length > 1 && mean(lens) > 0 ? std(lens) / mean(lens) : 0;
  const varietyScore = Math.min(1, cv / SIGNALS.VARIETY_FULL);
  const generic = c.analysis ? 1 - c.analysis.genericShare : undefined;
  const parts = [clicheScore, repeatScore, varietyScore, ...(generic !== undefined ? [generic] : [])];
  return {
    value: mean(parts) * c.outOf,
    components: { clichesPer100: r2(clicheRate), repeatedWordRate: r2(repeatRate), lengthVariety: r2(cv), ...(c.analysis ? { genericShare: r2(c.analysis.genericShare) } : {}) },
    explanation: `${clicheRate.toFixed(1)} clichés per 100 words, ${Math.round(repeatRate * 100)}% repeated words, sentence-length variety ${cv.toFixed(2)}${c.analysis ? `, ${Math.round(c.analysis.genericShare * 100)}% generic sentences` : ""}. Spelling and grammar are left to the examiner.`,
  };
}

export function measuredSignals(c: MeasuredContext): Record<RubricKey, MeasuredSignal> {
  return { thesis: thesis(c), outline: outline(c), argument: argument(c), evidence: evidence(c), "counter-argument": counter(c), coherence: coherence(c), language: language(c) };
}
