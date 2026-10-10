import type { EmbedFn } from "./embed.ts";

/** Cache key: the text with whitespace collapsed, so the same sentence cut from two places embeds once. */
export const normalizeKey = (t: string): string => t.replace(/\s+/g, " ").trim();

export type RequestEmbed = EmbedFn & {
  stats: () => { requestedTexts: number; embeddedTexts: number; calls: number };
  /** A vector already in the cache, without any network call. */
  peek: (text: string) => number[] | undefined;
};

/**
 * Wraps an embed function so concurrent pipeline stages share one request per distinct text. Create one per essay
 * request (it is the request-scoped embedding cache). Each text, compared with whitespace collapsed, is embedded at
 * most once (in-flight requests are shared too), which keeps parallel stages that embed the same sentences inside the
 * free-tier limit. If the underlying call fails, the failed texts are forgotten so a later call can try again.
 */
export function createSharedEmbed(base: EmbedFn): RequestEmbed {
  const cache = new Map<string, Promise<number[]>>();
  const resolved = new Map<string, number[]>();
  let requestedTexts = 0;
  let embeddedTexts = 0;
  let calls = 0;

  const embed: EmbedFn = async (texts) => {
    requestedTexts += texts.length;
    const seen = new Set<string>();
    const fresh: { key: string; text: string }[] = [];
    for (const t of texts) {
      const key = normalizeKey(t);
      if (!cache.has(key) && !seen.has(key)) {
        seen.add(key);
        fresh.push({ key, text: t });
      }
    }
    if (fresh.length > 0) {
      calls++;
      embeddedTexts += fresh.length;
      const batch = base(fresh.map((f) => f.text));
      fresh.forEach(({ key }, i) => {
        const p = batch.then((vecs) => {
          if (vecs.length !== fresh.length) throw new Error(`embedding returned ${vecs.length} vectors for ${fresh.length} texts`);
          resolved.set(key, vecs[i]);
          return vecs[i];
        });
        p.catch(() => cache.delete(key)); // forget failures so a retry is possible
        cache.set(key, p);
      });
    }
    return Promise.all(texts.map((t) => cache.get(normalizeKey(t))!));
  };
  return Object.assign(embed, {
    stats: () => ({ requestedTexts, embeddedTexts, calls }),
    peek: (text: string) => resolved.get(normalizeKey(text)),
  });
}
