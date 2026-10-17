/**
 * Pure fusion function combining Gemini's extracted elements with candidate roles
 * from the specialized argument classifier.
 *
 * Disagreement Policy:
 * - When both agree (or classifier evidence matches Gemini evidence/premise), modelConfidence is boosted.
 * - When there is genuine disagreement, Gemini's role is preserved, the classifier's reading is placed in
 *   `alternativeRole`, and modelConfidence is lowered (< 0.5) so that the existing `uncertain_classification`
 *   diagnostic fires as specified in HANDOFF.md and diagnose.ts rule 7.
 * - When the classifier output is missing/empty, Gemini elements are returned unchanged.
 */

import type { ExtractedElement } from "../extract.ts";
import type { SentenceCandidate } from "./types.ts";

export interface FusionOptions {
  mode?: "hybrid" | "shadow" | "off";
  evidenceConfidenceBoost?: number;
  disagreementPenalty?: number;
}

export function fuseRoles(
  geminiElements: ExtractedElement[],
  classifierCandidates: SentenceCandidate[] | null | undefined,
  options: FusionOptions = {}
): ExtractedElement[] {
  // If mode is off, shadow, or no classifier output is present, return Gemini unmodified
  if (options.mode === "off" || !classifierCandidates || classifierCandidates.length === 0) {
    return geminiElements;
  }

  const candidateBySentenceId = new Map(
    classifierCandidates.map((c) => [c.sentenceId, c])
  );

  return geminiElements.map((el) => {
    // Check if any sentence in this element has a candidate from the classifier
    const candidates = el.sentenceIds
      .map((id) => candidateBySentenceId.get(id))
      .filter((c): c is SentenceCandidate => c !== undefined);

    if (candidates.length === 0) {
      return el;
    }

    const primaryCandidate = candidates[0];
    const clfRole = primaryCandidate.role;
    const geminiRole = el.role;

    // Check agreement (accounting for Evidence vs Premise partial overlap)
    const isEquivalentEvidence =
      (geminiRole === "evidence" || geminiRole === "premise") &&
      clfRole === "evidence";
    const isDirectAgreement = geminiRole === clfRole;

    if (isDirectAgreement || isEquivalentEvidence) {
      // Both systems agree: boost confidence with a cap at 0.95
      const boost = options.evidenceConfidenceBoost ?? 0.15;
      const boostedConfidence = Math.min(0.95, Number((el.modelConfidence + boost).toFixed(2)));
      return {
        ...el,
        modelConfidence: boostedConfidence,
      };
    } else {
      // Disagreement: preserve Gemini reading, record alternativeRole, lower confidence below 0.5
      // to trigger the uncertain_classification diagnostic
      return {
        ...el,
        modelConfidence: 0.45, // below LOW_MODEL_CONFIDENCE (0.50)
        alternativeRole: clfRole,
      };
    }
  });
}
