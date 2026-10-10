import test from "node:test";
import assert from "node:assert/strict";
import { createSharedEmbed } from "./sharedEmbed.ts";
import type { EmbedFn } from "./embed.ts";

const counting = () => {
  const seen: string[][] = [];
  const base: EmbedFn = async (texts) => {
    seen.push([...texts]);
    return texts.map((t) => [t.length, t.charCodeAt(0)]);
  };
  return { base, seen };
};

test("concurrent calls with overlapping texts embed each distinct text once, preserving order", async () => {
  const { base, seen } = counting();
  const embed = createSharedEmbed(base);
  const [a, b] = await Promise.all([embed(["topic", "alpha", "beta"]), embed(["beta", "gamma", "topic"])]);
  assert.deepEqual(a.map((v) => v[0]), [5, 5, 4]);
  assert.deepEqual(b.map((v) => v[0]), [4, 5, 5]);
  assert.deepEqual(seen, [["topic", "alpha", "beta"], ["gamma"]]);
  assert.deepEqual(embed.stats(), { requestedTexts: 6, embeddedTexts: 4, calls: 2 });
});

test("a fully cached call makes no request; duplicates inside one call are sent once", async () => {
  const { base, seen } = counting();
  const embed = createSharedEmbed(base);
  await embed(["x", "x", "y"]);
  await embed(["y", "x"]);
  assert.deepEqual(seen, [["x", "y"]]);
});

test("a failed request is forgotten so the same text can be retried", async () => {
  let fail = true;
  const embed = createSharedEmbed(async (texts) => {
    if (fail) throw new Error("429");
    return texts.map(() => [1]);
  });
  await assert.rejects(embed(["a", "b"]), /429/);
  fail = false;
  assert.deepEqual(await embed(["a", "b"]), [[1], [1]]);
});

test("a base call that returns the wrong number of vectors rejects instead of misaligning", async () => {
  const embed = createSharedEmbed(async () => [[1]]);
  await assert.rejects(embed(["a", "b"]), /returned 1 vectors for 2 texts/);
});
