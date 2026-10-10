import { test } from "node:test";
import assert from "node:assert/strict";
import { embed, generateText, usageTotals, withUsage, type UsageReport } from "./gemini.ts";

process.env.GEMINI_API_KEY ??= "test-key";

/** Replaces fetch for the duration of fn with a fake that answers from `reply`. */
async function withFetch<T>(reply: (url: string) => { status: number; body: unknown }, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const r = reply(String(url));
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const ok = { candidates: [{ content: { parts: [{ text: "hi" }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 } };

test("withUsage counts calls, tokens and embedded texts per model", async () => {
  let usage: UsageReport = {};
  await withFetch(
    (url) => (url.includes("batchEmbedContents") ? { status: 200, body: { embeddings: [{ values: [1] }, { values: [2] }, { values: [3] }] } } : { status: 200, body: ok }),
    () =>
      withUsage(async () => {
        await generateText({ model: "m1", prompt: "a" });
        await generateText({ model: "m1", prompt: "b" });
        await embed("e1", ["x", "y", "z"]);
      }, (u) => (usage = u)),
  );
  assert.deepEqual(usage.m1, { calls: 2, failed: 0, inputTokens: 200, outputTokens: 40, thinkingTokens: 10, embeddedTexts: 0 });
  assert.equal(usage.e1.embeddedTexts, 3);
  assert.equal(usageTotals(usage).calls, 3);
});

test("failed calls are counted and the usage still reaches the caller when the work throws", async () => {
  let usage: UsageReport = {};
  await withFetch(
    () => ({ status: 429, body: { error: { message: "quota" } } }),
    () => assert.rejects(withUsage(() => generateText({ model: "m2", prompt: "a" }), (u) => (usage = u))),
  );
  assert.deepEqual(usage.m2, { calls: 1, failed: 1, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, embeddedTexts: 0 });
});

test("concurrent runs keep separate usage", async () => {
  const seen: UsageReport[] = [];
  await withFetch(
    () => ({ status: 200, body: ok }),
    () =>
      Promise.all([
        withUsage(async () => { await generateText({ model: "a", prompt: "1" }); }, (u) => seen.push(u)),
        withUsage(async () => { await generateText({ model: "b", prompt: "1" }); await generateText({ model: "b", prompt: "2" }); }, (u) => seen.push(u)),
      ]),
  );
  const a = seen.find((u) => u.a)!;
  const b = seen.find((u) => u.b)!;
  assert.equal(a.a.calls, 1);
  assert.equal(a.b, undefined);
  assert.equal(b.b.calls, 2);
});

test("calls outside withUsage are not recorded anywhere and do not throw", async () => {
  await withFetch(() => ({ status: 200, body: ok }), () => generateText({ model: "m", prompt: "x" }));
});
