import type { Band, RubricKey } from "../types.ts";

/**
 * Rubric for the examiner second opinion. Editable.
 *
 * The descriptions below are plain-language and are grounded in recurring themes from published FPSC
 * examiner reports on the CSS English Essay paper: candidates fail to grasp the main argument of the topic;
 * arguments are given without enough supporting evidence; outlines are irrelevant, disorganised or too long;
 * content is formulaic, copied from coaching academies and guidebooks instead of original thought; and
 * expression, grammar and spelling are weak.
 * They are NOT official FPSC marking criteria.
 */

/** Scale used for dimension scores. lib/types.ts carries outOf per dimension; the report uses 10. */
export const SCALE_OUT_OF = 10;

/**
 * Minimum score (on SCALE_OUT_OF) for each band. UNCALIBRATED, NOT OFFICIAL FPSC MARKS.
 * Consistent with bandForScore in lib/derive.ts (ratio 0.7 and 0.5).
 */
export const SCORE_TO_BAND: { competitive: number; borderline: number } = { competitive: 7, borderline: 5 };

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(SCALE_OUT_OF, Math.max(0, Math.round(score * 2) / 2)); // half-point steps
}

/** The only place a model score becomes a band. A band supplied by the model is never trusted. */
export function bandFromScore(score: number): Band {
  const s = clampScore(score);
  return s >= SCORE_TO_BAND.competitive ? "competitive" : s >= SCORE_TO_BAND.borderline ? "borderline" : "below-pass";
}

export interface RubricEntry {
  key: RubricKey;
  label: string;
  definition: string;
  weak: string;
  adequate: string;
  strong: string;
}

export const RUBRIC: RubricEntry[] = [
  {
    key: "thesis",
    label: "Thesis",
    definition: "Does the candidate grasp the main argument of the topic and take a clear, arguable position on it?",
    weak: "Misreads or only partly addresses the topic, writes about the general subject instead of the question set, or states no position.",
    adequate: "Addresses the topic and states a position, but it is broad, hedged or only loosely held through the essay.",
    strong: "Shows a precise grasp of what the topic asks, takes a clear arguable position early, and the essay keeps to it.",
  },
  {
    key: "outline",
    label: "Outline",
    definition: "Is the essay (and the outline, if one is given) relevant, well organised and of sensible length?",
    weak: "Outline or structure is irrelevant, disorganised, or too long to guide the essay; paragraphs wander off the topic.",
    adequate: "A recognisable introduction, body and conclusion with mostly relevant parts, but some are weak, repeated or out of order.",
    strong: "Outline and essay follow a logical order, every part serves the topic, and proportions are sensible.",
  },
  {
    key: "argument",
    label: "Argument",
    definition: "Are the claims reasoned, developed and linked to the position, with original thought?",
    weak: "Assertions and slogans without reasoning, formulaic points of the kind found in guidebooks and coaching notes, or claims that do not follow.",
    adequate: "Reasoned claims that support the position, though some stay general or repeat familiar lines.",
    strong: "Developed, original reasoning in which each claim advances the position and consequences are drawn out.",
  },
  {
    key: "evidence",
    label: "Evidence",
    definition: "Are the arguments backed by enough relevant, specific support (facts, figures, examples, institutions, cases)?",
    weak: "Arguments stand with little or no support, or rely on vague statements such as 'many people' or 'it is known'.",
    adequate: "Some specific support, but uneven: several claims remain unsupported or the examples are thin.",
    strong: "Claims are regularly backed by specific, relevant and plausible evidence, with Pakistani context where it matters.",
  },
  {
    key: "counter-argument",
    label: "Counter-argument",
    definition: "Does the candidate consider opposing views and answer them?",
    weak: "No opposing view is considered, or it is mentioned only to be dismissed.",
    adequate: "An opposing view is acknowledged, but the answer is brief or unconvincing.",
    strong: "A serious opposing view is stated fairly and answered with reasons, which strengthens the position.",
  },
  {
    key: "coherence",
    label: "Coherence",
    definition: "Do sentences and paragraphs connect, with clear transitions and a consistent line of thought from start to finish?",
    weak: "Paragraphs read as separate pieces, topics change without warning, or sections repeat each other.",
    adequate: "Generally follows a line of thought, with some abrupt shifts or weak links between paragraphs.",
    strong: "Each paragraph builds on the last, transitions are clear, and the conclusion follows from what came before.",
  },
  {
    key: "language",
    label: "Language",
    definition: "Is expression clear and correct (grammar, spelling, punctuation, vocabulary, style)?",
    weak: "Frequent errors in grammar, spelling or punctuation that obscure meaning, or misused fancy vocabulary.",
    adequate: "Understandable throughout, with noticeable errors or stock phrasing.",
    strong: "Accurate, clear and varied expression with appropriate vocabulary; few errors.",
  },
];

export function labelFor(key: RubricKey): string {
  return RUBRIC.find((r) => r.key === key)!.label;
}
