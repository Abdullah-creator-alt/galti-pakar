/**
 * Model names used by the pipeline. Verify with `npm run check:gemini`;
 * update here if the check shows a different working model.
 */
export const GEMINI_TEXT_MODEL = "gemini-3.8-flash";
export const GEMINI_VISION_MODEL = "gemini-3.6-flash";
/** Tried in order when the primary model is overloaded (503/429) or slow. */
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
