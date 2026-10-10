import type { EmbedFn } from "./embed.ts";

/**
 * Wraps an embed function so concurrent pipeline stages share one request per distinct text. Create one per essay
 * request. Each text is embedded at most once (in-flight requests are shared too), which keeps parallel stages
 * that embed the same sentences inside the free-tier limit. If the underlying call fails, the failed texts are
 * forgotten so a later call can try again.
 */
export function createSharedEmbed(base: EmbedFn): EmbedFn & { stats: () => { requestedTexts: number; embeddedTexts: number; calls: number } } {
  const cache = new Map<string, Promise<number[]>>();
  let requestedTexts = 0;
  let embeddedTexts = 0;
  let calls = 0;

  const embed: EmbedFn = async (texts) => {
    requestedTexts += texts.length;
    const fresh = [...new Set(texts)].filter((t) => !cache.has(t));
    if (fresh.length > 0) {
      calls++;
      embeddedTexts += fresh.length;
      const batch = base(fresh);
      fresh.forEach((t, i) => {
        const p = batch.then((vecs) => {
          if (vecs.length !== fresh.length) throw new Error(`embedding returned ${vecs.length} vectors for ${fresh.length} texts`);
          return vecs[i];
        });
        p.catch(() => cache.delete(t)); // forget failures so a retry is possible
        cache.set(t, p);
      });
    }
    return Promise.all(texts.map((t) => cache.get(t)!));
  };
  return Object.assign(embed, { stats: () => ({ requestedTexts, embeddedTexts, calls }) });
}
