/**
 * Tunable constants for the structure-analysis module. Every threshold here is a heuristic,
 * not a calibrated probability; re-tune against real essays. See README.md for what each means.
 */
/** 1.3.0: additive. Profile criteria gain `official_guidance` origin, `partially_assessable` checkability and optional `limitations`. 1.2.0: `relevant_to` may also come from evidence. 1.1.0: additive. `supports` may target rebuttals and counterclaims; metadata gains `confidenceCalibration`. */
export const STRUCTURE_SCHEMA_VERSION = "1.3.0";

export const STRUCTURE_LIMITS = {
  maxChars: 40_000,
  maxParagraphs: 80,
  maxSentences: 300,
} as const;

/** Elements the model labels below this confidence are reported as uncertain classifications. */
export const LOW_MODEL_CONFIDENCE = 0.5;
/** An element with a plausible alternative role is also reported as uncertain below this confidence. */
export const AMBIGUOUS_MODEL_CONFIDENCE = 0.65;

/** A candidate link needs at least this strength (and one non-lexical signal) to be kept. */
export const MIN_LINK_STRENGTH = 0.35;
/** `claim -> thesis` relevance hypotheses use a lower bar because lexical overlap is their main signal. */
export const MIN_RELEVANCE_STRENGTH = 0.3;
/** A claim whose best support link is weaker than this is reported as potentially unsupported. */
export const WEAK_SUPPORT_STRENGTH = 0.55;
/** At most this many candidate links are kept per target element and link type. */
export const MAX_LINKS_PER_TARGET = 3;

/**
 * Semantic signal mapping: cosine below SEMANTIC_FLOOR adds nothing; it reaches full weight SEMANTIC_SPAN above it.
 * Measured once on gemini-embedding-001 (768d, SEMANTIC_SIMILARITY) with 7 probe sentences against one thesis:
 * unrelated sentences scored 0.73-0.74, paraphrases 0.78-0.83, a wording trap 0.84, an opposite stance 0.87.
 * So the floor sits just above the unrelated baseline. Model-specific, tiny sample, NOT calibrated; embeddings
 * are weak positive evidence only and are never used to assert that a claim is off-topic.
 */
export const SEMANTIC_FLOOR = 0.75;
export const SEMANTIC_SPAN = 0.15;

/** Texts embedded for the optional semantic signal must fit one embedding batch. */
export const MAX_SEMANTIC_TEXTS = 95;

export const EXTRACTION_TIMEOUT_MS = 40_000;
export const EXTRACTION_MAX_ATTEMPTS = 2;
