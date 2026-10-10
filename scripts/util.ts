/** Shared helpers for build scripts: JSON cache, resilient Gemini JSON generation, cached and rate-limit-aware embedding. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GEMINI_TEXT_MODEL } from "../lib/config.ts";
import { GeminiError, generateJson } from "../lib/gemini.ts";
import { embedTexts } from "../lib/pipeline/embed.ts";
import { roundVec } from "../lib/pipeline/vecmath.ts";

export const DATA = path.join(process.cwd(), "data");
export const CACHE = path.join(DATA, "cache");
mkdirSync(CACHE, { recursive: true });

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const sha = (s: string) => createHash("sha1").update(s).digest("hex");

export function cacheRead<T>(name: string): T | null {
  const p = path.join(CACHE, name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}
export const cacheWrite = (name: string, v: unknown) => writeFileSync(path.join(CACHE, name), JSON.stringify(v));

const MODELS = ["gemini-3.6-flash", GEMINI_TEXT_MODEL, "gemini-3-flash-preview", "gemini-3.5-flash", "gemini-3.1-flash-lite"];
/** Models whose free-tier daily quota is used up are skipped for the rest of the run. */
const exhausted = new Set<string>();

/** One JSON generation with model rotation and backoff. temperature 0. Not cached. */
export async function genJson<T>(prompt: string, schema: unknown): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    const live = MODELS.filter((m) => !exhausted.has(m));
    if (live.length === 0) throw new Error("Every model has hit its quota. Wait for the daily reset and rerun (progress is cached).");
    const model = live[attempt % live.length];
    try {
      return await generateJson<T>({ model, prompt, responseSchema: schema, temperature: 0, timeoutMs: 120_000, maxOutputTokens: 16384 });
    } catch (e) {
      last = e;
      if (/exceeded your current quota/i.test((e as Error).message)) exhausted.add(model);
      console.log(`  retry (${model}): ${(e as Error).message.slice(0, 90)}`);
      await sleep(1500 * (attempt + 1) + (e instanceof GeminiError && e.status === 429 ? 5000 : 0));
    }
  }
  throw new Error(`Gemini generation failed: ${(last as Error)?.message}`);
}

/**
 * Cached, validated generation. `validate` throws on bad output; the call is retried once with the
 * error appended before giving up.
 */
export async function genValidated<T>(cacheName: string, prompt: string, schema: unknown, validate: (raw: unknown) => T): Promise<T> {
  const hit = cacheRead<unknown>(cacheName);
  if (hit) {
    try {
      return validate(hit);
    } catch {
      /* stale cache: regenerate */
    }
  }
  let err = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await genJson<unknown>(attempt ? `${prompt}\n\nYour previous reply was invalid: ${err}\nReturn corrected JSON only.` : prompt, schema);
    try {
      const v = validate(raw);
      cacheWrite(cacheName, raw);
      console.log(`  generated ${cacheName}`);
      return v;
    } catch (e) {
      err = (e as Error).message.slice(0, 400);
    }
  }
  throw new Error(`Output for ${cacheName} stayed invalid: ${err}`);
}

export async function pool<T, R>(items: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const EMB_FILE = "embeddings.json";
const embCache: Record<string, number[]> = cacheRead<Record<string, number[]>>(EMB_FILE) ?? {};

/** Embeds with a persistent cache, in chunks of 90, waiting out the free-tier rate limit. Order preserved. */
export async function embedCached(texts: string[]): Promise<number[][]> {
  const missing = [...new Set(texts.filter((t) => !embCache[sha(t)]))];
  const CHUNK = 90;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    for (let attempt = 0; ; attempt++) {
      try {
        const vecs = await embedTexts(chunk, { retries: 0 });
        chunk.forEach((t, j) => (embCache[sha(t)] = roundVec(vecs[j])));
        cacheWrite(EMB_FILE, embCache);
        break;
      } catch (e) {
        if (!(e instanceof GeminiError) || e.status !== 429 || attempt >= 12) throw e;
        console.log("  embedding rate limit; waiting 40s...");
        await sleep(40_000);
      }
    }
    console.log(`  embedded ${Math.min(i + CHUNK, missing.length)}/${missing.length}`);
  }
  return texts.map((t) => embCache[sha(t)]);
}
