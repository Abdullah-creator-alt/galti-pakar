import { cosine, percentileRank } from "./vecmath.ts";

export interface Relevance {
  /** 0-100. Percentile of the essay topic's similarity among all bank topics plus the essay topic. */
  relevance: number;
  /** Raw cosine between paragraph and essay topic, for debugging. */
  rawSimilarity: number;
}

/**
 * A paragraph is on topic when the essay topic is one of the topics it is closest to.
 * Ranking against a bank of other topics removes the baseline similarity that
 * any two pieces of text share, which a raw cosine threshold cannot do.
 */
export function relevance(paragraphVec: number[], topicVec: number[], bankTopicVecs: number[][]): Relevance {
  const essaySim = cosine(paragraphVec, topicVec);
  const population = [essaySim, ...bankTopicVecs.map((t) => cosine(paragraphVec, t))];
  return { relevance: percentileRank(essaySim, population), rawSimilarity: essaySim };
}
