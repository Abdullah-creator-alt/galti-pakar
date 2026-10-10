/**
 * Model names used by the pipeline. Verify with `npm run check:gemini`;
 * update here if the check shows a different working model.
 */
export const GEMINI_TEXT_MODEL = "gemini-3.8-flash";
export const GEMINI_VISION_MODEL = "gemini-3.6-flash";
/** Tried in order when the primary model is overloaded (503/429) or slow. */
/** Examiner second opinion: primary model, then fallbacks when it is overloaded (429/503) or slow. */
export const GEMINI_EXAMINER_MODEL = "gemini-3.6-flash";
export const GEMINI_EXAMINER_FALLBACKS = ["gemini-3-flash-preview", "gemini-3.8-flash"] as const;
export const EXAMINER_TEMPERATURE = 0.3;

export const GEMINI_VISION_FALLBACKS = ["gemini-3-flash-preview", "gemini-3.8-flash"] as const;
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const UPLOAD_LIMITS = {
  minPages: 1,
  maxPages: 12,
  maxBytes: 10 * 1024 * 1024,
  mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic"],
  minTopicChars: 3,
  maxTopicChars: 300,
} as const;

/**
 * Paragraphs with relevance below this (0-100) are flagged as drifting. Set the report driftThreshold to this value.
 * 90 is from npm run eval:drift on synthetic paragraphs (95% of off-topic caught, 100% of on-topic kept); relevance is a
 * percentile among 50 topics, so on-topic paragraphs sit near the top. Re-tune on real essays.
 */
export const DRIFT_THRESHOLD = 90;

/** Max texts embedded per essay. The free tier allows about 100 embedded texts per minute, so one essay must fit in one batch. */
export const EMBED_TEXT_BUDGET = 95;

/** Top-essay benchmark constants. COVERAGE_THRESHOLD and THEME_MIN_SIMILARITY are tuned by npm run eval:benchmark. */
export const BENCHMARK = {
  /**
   * A point counts as covered when some sentence has at least this cosine to it. 0.8 is the AUC peak (0.906) on synthetic
   * paragraphs vs AI checklists. Sentence-level tuning was blocked by the embedding quota; re-run eval:benchmark.
   */
  COVERAGE_THRESHOLD: 0.8,
  /**
   * Nearest theme centroid must be at least this similar, otherwise coverage is skipped. Correct topic matches start at 0.846,
   * unrelated probes reach 0.826, so 0.84 only just separates them. Weak evidence; re-tune with real essays.
   */
  THEME_MIN_SIMILARITY: 0.84,
  /** Agglomerative merge threshold for near-duplicate key points across essays. */
  CLUSTER_THRESHOLD: 0.85,
  /** Below this many reference essays in a theme, only the LLM checklist is used. */
  MIN_REFERENCE_ESSAYS: 3,
  /** Below this many reference essays, the profile comparison is labelled indicative only. */
  INDICATIVE_BELOW: 8,
  /** With at least 4 essays in a theme, ignore points made by fewer than this many essays. */
  MIN_MADE_BY: 2,
  /** If a theme has fewer reference points than this, checklist points supplement them. */
  MIN_REFERENCE_POINTS: 8,
  MAX_POINTS_PER_ESSAY: 12,
  MAX_LISTED: 8,
  /** Stored points must stay paraphrases: no stored point may exceed this many words. */
  MAX_POINT_WORDS: 25,
} as const;

/**
 * Time allowed for each analysis stage that runs in parallel after the essay is read. A stage that exceeds its
 * limit is reported as failed and the others carry on. The stage itself cannot be cancelled, only abandoned.
 */
export const MEASURE_STAGE_TIMEOUT_MS = { structure: 30_000, analysis: 25_000, benchmark: 25_000 } as const;
