/**
 * Typed adapter converting character-level predicted spans to sentence candidate roles
 * using the standard >= 50% character-overlap rule.
 * Never modifies or reconstructs original text.
 */

import type { SentenceNode } from "../types.ts";
import type { ClassifierPredictedSpan, ClassifierRole, SentenceCandidate } from "./types.ts";

const PERSUADE_TO_GALTI: Record<string, ClassifierRole> = {
  Position: "thesis",
  Claim: "claim",
  Counterclaim: "counterclaim",
  Rebuttal: "rebuttal",
  "Concluding Statement": "conclusion",
  Evidence: "evidence",
};

/**
 * Maps predicted character spans into candidate roles for existing sentences.
 * A sentence takes the candidate role of the span covering >= 50% of its character length.
 */
export function mapSpansToSentences(
  spans: ClassifierPredictedSpan[],
  sentences: SentenceNode[]
): SentenceCandidate[] {
  const candidates: SentenceCandidate[] = [];

  for (const sentence of sentences) {
    const sLen = sentence.end - sentence.start;
    if (sLen <= 0) continue;

    let bestCandidate: SentenceCandidate | null = null;
    let maxCoverage = 0;

    for (const span of spans) {
      const mappedRole = PERSUADE_TO_GALTI[span.label];
      if (!mappedRole) continue;

      const overlapStart = Math.max(sentence.start, span.start);
      const overlapEnd = Math.min(sentence.end, span.end);
      const overlapLen = Math.max(0, overlapEnd - overlapStart);
      const coverage = overlapLen / sLen;

      if (coverage >= 0.5 && coverage > maxCoverage) {
        maxCoverage = coverage;
        bestCandidate = {
          sentenceId: sentence.id,
          role: mappedRole,
          confidence: span.confidence ?? 0.8,
          coverage,
        };
      }
    }

    if (bestCandidate) {
      candidates.push(bestCandidate);
    }
  }

  return candidates;
}
