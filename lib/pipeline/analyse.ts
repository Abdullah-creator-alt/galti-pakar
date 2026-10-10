import { DRIFT_THRESHOLD, EMBED_TEXT_BUDGET } from "../config.ts";
import type { HighlightSpan } from "../types.ts";
import { loadAssets, type Assets } from "./dataFiles.ts";
import { relevance } from "./drift.ts";
import { embedTexts, type EmbedFn } from "./embed.ts";
import { sentenceFeatures, type FeatureName } from "./features.ts";
import { genericnessScore, levelFor, reasonCodes, reasonText, signalsOf, type GenericLevel } from "./genericness.ts";
import { countTextWords, splitSentences } from "./sentences.ts";
import { mean } from "./vecmath.ts";

export interface SentenceResult {
  /** Offsets inside the paragraph text. */
  start: number;
  end: number;
  /** null when the sentence was not assessed. */
  genericScore: number | null;
  level: GenericLevel;
  signals: Record<FeatureName, number> | null;
  reasonCodes: string[];
}

export interface ParagraphAnalysis {
  id: string;
  relevance: number;
  rawSimilarity: number;
  driftFlag: boolean;
  sentences: SentenceResult[];
  avgGenericScore: number | null;
}

export interface EssayAnalysis {
  paragraphs: ParagraphAnalysis[];
  /** Fraction of sentences rated "generic". */
  genericShare: number;
  /** Numbers, named entities and Pakistan terms per 100 words. */
  specificityPer100Words: number;
  driftingParagraphIds: string[];
  /** Number of texts embedded and API calls made, for cost tracking. */
  embedTextCount: number;
  /** Sentences left out because the essay exceeded the embedding budget. */
  unassessedSentences: number;
}

export interface AnalyseDeps {
  embed?: EmbedFn;
  assets?: Assets;
  driftThreshold?: number;
  /** Max texts to embed. Longest sentences are kept first; the rest are marked unassessed. */
  embedBudget?: number;
}

/**
 * Drift per paragraph plus genericness per sentence, from embeddings and a trained
 * logistic regression. No LLM judging at runtime.
 * Embeds the topic, paragraphs and sentences together in as few batched calls as possible.
 */
export async function analyseGenericnessAndDrift(
  topic: string,
  paragraphs: { id: string; text: string }[],
  deps: AnalyseDeps = {},
): Promise<EssayAnalysis> {
  const assets = deps.assets ?? loadAssets();
  const embed = deps.embed ?? embedTexts;
  const threshold = deps.driftThreshold ?? DRIFT_THRESHOLD;

  const budget = deps.embedBudget ?? EMBED_TEXT_BUDGET;

  const split = paragraphs.map((p) => splitSentences(p.text));
  // Topic and paragraphs always get embedded (drift needs them). Sentences fill the rest of the
  // budget, longest first, because short ones carry little signal. Others are reported as unassessed.
  const all = split.flatMap((ss, pi) => ss.map((s, si) => ({ pi, si, text: s.text, words: countTextWords(s.text) })));
  const room = Math.max(budget - 1 - paragraphs.length, 0);
  const chosen = all.length <= room ? all : [...all].sort((x, y) => y.words - x.words || x.pi - y.pi || x.si - y.si).slice(0, room);
  const chosenKey = new Set(chosen.map((c) => c.pi + ":" + c.si));
  const ordered = all.filter((c) => chosenKey.has(c.pi + ":" + c.si));

  const texts = [topic, ...paragraphs.map((p) => p.text), ...ordered.map((c) => c.text)];
  const vecs = await embed(texts);
  if (vecs.length !== texts.length) throw new Error(`Embedding returned ${vecs.length} vectors for ${texts.length} texts.`);

  const topicVec = vecs[0];
  const paraVecs = vecs.slice(1, 1 + paragraphs.length);
  const sentenceVec = new Map<string, number[]>();
  ordered.forEach((c, i) => sentenceVec.set(c.pi + ":" + c.si, vecs[1 + paragraphs.length + i]));
  const topicVecs = assets.topics.map((t) => t.vec);

  let sentenceCount = 0;
  let genericCount = 0;
  let detailCount = 0;
  let wordCount = 0;
  let unassessed = 0;

  const out: ParagraphAnalysis[] = paragraphs.map((p, pi) => {
    const rel = relevance(paraVecs[pi], topicVec, topicVecs);
    const sentences: SentenceResult[] = split[pi].map((s, si) => {
      const vec = sentenceVec.get(pi + ":" + si);
      if (!vec) {
        unassessed++;
        return { start: s.start, end: s.end, genericScore: null, level: "unassessed" as const, signals: null, reasonCodes: [] };
      }
      const features = sentenceFeatures(vec, s.text, assets.bankVecs, topicVecs);
      const genericScore = genericnessScore(features, assets.model);
      const level = levelFor(genericScore, assets.model.levelThresholds);
      const signals = signalsOf(features);
      const words = Math.max(signals.lengthWords, 1);
      sentenceCount++;
      wordCount += words;
      if (level === "generic") genericCount++;
      detailCount += ((signals.numbersPer20 + signals.entitiesPer20) * words) / 20 + signals.pakistanTerms;
      return { start: s.start, end: s.end, genericScore, level, signals, reasonCodes: reasonCodes(features, level, assets.model.reasonThresholds) };
    });
    const scores = sentences.flatMap((x) => (x.genericScore === null ? [] : [x.genericScore]));
    return {
      id: p.id,
      relevance: rel.relevance,
      rawSimilarity: rel.rawSimilarity,
      driftFlag: rel.relevance < threshold,
      sentences,
      avgGenericScore: scores.length ? mean(scores) : null,
    };
  });

  return {
    paragraphs: out,
    genericShare: sentenceCount ? genericCount / sentenceCount : 0,
    specificityPer100Words: wordCount ? (detailCount / wordCount) * 100 : 0,
    driftingParagraphIds: out.filter((p) => p.driftFlag).map((p) => p.id),
    embedTextCount: texts.length,
    unassessedSentences: unassessed,
  };
}

/**
 * Converts sentence results to UI highlight spans. Generic -> "weak", specific -> "strong", mixed -> none.
 * Reasons come from reason codes only.
 */
export function toSpans(p: ParagraphAnalysis): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  for (const s of p.sentences) {
    if (s.level === "mixed" || s.level === "unassessed") continue;
    spans.push({ start: s.start, end: s.end, tone: s.level === "generic" ? "weak" : "strong", reason: reasonText(s.level, s.reasonCodes) });
  }
  return spans;
}
