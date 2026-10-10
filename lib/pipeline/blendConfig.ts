/**
 * Tunable constants for the verify / blend / score step. Every value is exported and commented.
 * Nothing here is calibrated against official FPSC marks.
 */
import type { RubricKey } from "../types.ts";

/**
 * Claim-to-evidence cosine thresholds. The brief suggested 0.60 / 0.45, but gemini-embedding-001 cosines are high
 * for everything: unrelated sentences measured 0.73-0.83 in this project, paraphrases 0.78-0.83, a wording trap 0.84
 * (see lib/structure/README.md). At 0.60 every pair would pass, so no claim could ever be an orphan.
 * These starting values sit inside the measured range. Tune with `npm run tune-links` on hand-labelled pairs.
 */
export const LINK_STRONG = 0.82;
export const LINK_WEAK = 0.76;

/** Where evidence is searched. Same paragraph can make a strong link; an adjacent paragraph can only make a weak one. */
export const EVIDENCE_WINDOW = { strongParagraphs: 0, weakParagraphs: 1 } as const;

/** A counterclaim is rebutted if a Rebuttal follows within this many sentences of its paragraph, or in the next N paragraphs. */
export const REBUTTAL_WINDOW = { sentences: 4, paragraphs: 1 } as const;

/** Share of the examiner's score taken by the measured signal. Language stays low: spelling and grammar are the examiner's job. */
export const BLEND_WEIGHT_MEASURED: Record<RubricKey, number> = {
  thesis: 0.4,
  outline: 0.4,
  argument: 0.4,
  evidence: 0.4,
  "counter-argument": 0.4,
  coherence: 0.4,
  language: 0.2,
};

/** Measured and examiner scores this far apart (as a fraction of the scale) are recorded as a conflict. */
export const CONFLICT_GAP = 0.25;

/** Weights for the overall score (normalised, so only ratios matter). Equal by default. */
export const DIMENSION_WEIGHTS: Record<RubricKey, number> = {
  thesis: 1,
  outline: 1,
  argument: 1,
  evidence: 1,
  "counter-argument": 1,
  coherence: 1,
  language: 1,
};

/** Verdict thresholds as fractions of the scale. UNCALIBRATED, NOT OFFICIAL FPSC MARKS. Same values as bandForScore in lib/derive.ts. */
export const VERDICT_THRESHOLDS = { competitive: 0.7, borderline: 0.5 } as const;

/** Cross-checks between the examiner and the measurements. */
export const CROSS_CHECK = {
  /** Examiner score (fraction of scale) at or above which a dimension counts as "praised". */
  PRAISE_MIN: 0.7,
  /** evidence_praised_but_orphans: share of claims that are orphans. */
  ORPHAN_SHARE_MIN: 0.4,
  /** coherence_praised_but_drift: number of drifting paragraphs. */
  DRIFT_PARAGRAPHS_MIN: 2,
  /** counter_present_but_none: examiner counter-argument score (fraction of scale) that implies it saw one. */
  COUNTER_PRESENT_MIN: 0.5,
  /** structure_label_disagreement: label agreement rate below this is reported. */
  LABEL_AGREEMENT_FLOOR: 0.6,
} as const;

/** Expected word range for a CSS essay. Outside it gives a warning only; it never changes a score. */
export const EXPECTED_WORDS = { min: 1800, max: 3500 } as const;

/** Parameters of the measured signals. */
export const SIGNALS = {
  /** Concrete details per 100 words that earn full specificity credit. */
  SPECIFICITY_FULL: 6,
  /** Outline line and paragraph count as matching at this cosine (same scale caveat as LINK_*). */
  OUTLINE_MATCH_SIM: 0.78,
  /** Measured Outline value (fraction of scale) when no outline was transcribed. Flagged low confidence: it may be a reading problem. */
  OUTLINE_MISSING_FRACTION: 0.2,
  /** Cliches per 100 words at which the cliche score reaches zero. */
  CLICHE_RATE_ZERO: 2,
  /** A content word used at least this many times counts as repeated. */
  REPEAT_MIN_USES: 4,
  /** Repeated-word rate at which the repetition score reaches zero. */
  REPEAT_RATE_ZERO: 0.3,
  /** Coefficient of variation of sentence length that earns full variety credit. */
  VARIETY_FULL: 0.5,
  /** Thesis: weight of paragraph relevance versus presence of a Position sentence. */
  THESIS_RELEVANCE_WEIGHT: 0.6,
  /** Coherence: weight of on-topic share versus mean relevance. */
  COHERENCE_SHARE_WEIGHT: 0.5,
  /** Evidence: weight of specificity versus strong-link share. */
  EVIDENCE_SPECIFICITY_WEIGHT: 0.5,
} as const;

/** Severity of each issue type (1 low to 3 high) for ranking. */
export const ISSUE_SEVERITY = {
  orphan_claim: 3,
  drift: 3,
  missing_counter: 3,
  no_position: 3,
  unrebutted_counterclaim: 2,
  no_conclusion: 2,
  weak_link_claim: 1.5,
  generic: 1,
} as const;

/** Dimension each issue type mainly affects, used to weight its impact. */
export const ISSUE_DIMENSION: Record<keyof typeof ISSUE_SEVERITY, RubricKey> = {
  orphan_claim: "evidence",
  weak_link_claim: "evidence",
  unrebutted_counterclaim: "counter-argument",
  drift: "coherence",
  generic: "evidence",
  missing_counter: "counter-argument",
  no_position: "thesis",
  no_conclusion: "outline",
};

/**
 * Paragraph role for the report, from sentence labels and the transcription kind. First match wins.
 * Roles are the ParagraphRole values in lib/types.ts.
 *   1. a Conclusion sentence                                  -> "conclusion"
 *   2. a Position sentence, or kind "intro" with no other cue -> "position"
 *   3. a Counterclaim or Rebuttal sentence                    -> "counter-argument"
 *   4. Evidence sentences at least as many as Claim sentences -> "evidence"
 *   5. a Claim sentence                                       -> "claim"
 *   6. fallback by kind: intro -> "position", conclusion -> "conclusion", body -> "claim"
 */
export const PARAGRAPH_ROLE_RULES = "see blendConfig.ts comment; implemented in xray.paragraphRole";
