import { EMBEDDING_DIMENSIONS, GEMINI_EMBEDDING_MODEL } from "../config.ts";
import { EMBED_BATCH_LIMIT, GeminiError, embed as rawEmbed, type EmbedTaskType } from "../gemini.ts";
import { normalize } from "./vecmath.ts";

/** One task type for every text, so vectors are comparable. */
export const EMBED_TASK: EmbedTaskType = "SEMANTIC_SIMILARITY";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
/** Longest we will wait on a rate-limit hint, to stay inside a 60 s serverless function. */
const MAX_HINT_WAIT_MS = 45_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seconds from a Gemini 429 message such as "Please retry in 41.59s.", or NaN. */
export function parseRetryHint(message: string): number {
  return Number(/retry in ([0-9.]+)s/i.exec(message)?.[1]);
}

async function embedBatch(texts: string[], retries: number, baseDelayMs: number): Promise<number[][]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const vecs = await rawEmbed(GEMINI_EMBEDDING_MODEL, texts, EMBEDDING_DIMENSIONS, EMBED_TASK, 30_000);
      if (vecs.length !== texts.length) throw new GeminiError(`Embedding returned ${vecs.length} vectors for ${texts.length} texts.`);
      return vecs.map(normalize); // truncated dimensions are not unit length
    } catch (e) {
      const status = e instanceof GeminiError ? e.status : undefined;
      if (attempt >= retries || status === undefined || !RETRYABLE.has(status)) throw e;
      // Google says how long to wait on a 429 ("Please retry in 41.5s"). Honour it, capped.
      const hint = e instanceof GeminiError ? parseRetryHint(e.message) : NaN;
      const wait = status === 429 && Number.isFinite(hint) ? Math.min(hint * 1000 + 500, MAX_HINT_WAIT_MS) : baseDelayMs * 2 ** attempt + Math.random() * 200;
      await sleep(wait);
    }
  }
}

/**
 * Embeds texts with the shared model/dimension/task type, L2-normalised, order preserved.
 * Splits into batches of the API limit and runs them in parallel.
 */
export async function embedTexts(texts: string[], opts: { retries?: number; baseDelayMs?: number; concurrency?: number } = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { retries = 4, baseDelayMs = 800, concurrency = 4 } = opts;
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_LIMIT) batches.push(texts.slice(i, i + EMBED_BATCH_LIMIT));
  const results: number[][][] = new Array(batches.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      while (next < batches.length) {
        const i = next++;
        results[i] = await embedBatch(batches[i], retries, baseDelayMs);
      }
    }),
  );
  return results.flat();
}

export function embedCallCount(textCount: number): number {
  return Math.ceil(textCount / EMBED_BATCH_LIMIT);
}

/** The request-scoped embedding cache (one per essay request). See sharedEmbed.ts. */
export { createSharedEmbed as createRequestEmbed } from "./sharedEmbed.ts";
