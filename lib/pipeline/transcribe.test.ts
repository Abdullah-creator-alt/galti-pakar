import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { describeParseError, parseModelOutput, postProcess } from "./transcribe.ts";
import { prepareImages } from "./prepareImages.ts";
import { readHandwriting } from "./steps.ts";
import { ApiError } from "./validate.ts";
import type { RawTranscription } from "./transcribe.types.ts";

const good: RawTranscription = {
  outline: ["1. Intro", "2. Causes", " "],
  paragraphs: [
    { kind: "intro", text: "  Water is the lifeblood of Pakistan.  ", pageIndex: 0 },
    { kind: "body", text: "   ", pageIndex: 0 },
    { kind: "body", text: "The Indus basin suppport millions of farmers.", pageIndex: 1 },
    { kind: "conclusion", text: "In conclusion we must act now.", pageIndex: 7 },
  ],
  uncertain: [
    { paragraphNumber: 3, word: "suppport", guess: "support" },
    { paragraphNumber: 3, word: "glacier", guess: "glaciers" }, // not in text: hallucinated
    { paragraphNumber: 2, word: "anything", guess: "x" }, // paragraph was dropped
    { paragraphNumber: 1, word: "LIFEBLOOD", guess: "lifeblood" }, // case-insensitive match
  ],
  legibility: "fair",
  warnings: [],
};

test("schema accepts a good fixture and rejects a bad one", () => {
  assert.doesNotThrow(() => parseModelOutput(JSON.stringify(good)));
  const bad = { ...good, legibility: "excellent", paragraphs: [{ kind: "preface", text: "x", pageIndex: -1 }] };
  assert.throws(() => parseModelOutput(JSON.stringify(bad)));
  assert.match(describeParseError((() => { try { parseModelOutput(JSON.stringify(bad)); } catch (e) { return e; } })()), /legibility|kind/);
});

test("parser strips code fences and surrounding prose", () => {
  const fenced = "Here you go:\n```json\n" + JSON.stringify(good) + "\n```";
  assert.equal(parseModelOutput(fenced).paragraphs.length, 4);
  assert.equal(parseModelOutput("note " + JSON.stringify(good) + " done").legibility, "fair");
});

test("postProcess assigns ids, counts words, drops hallucinated uncertain words", () => {
  const e = postProcess(good, 2);
  assert.deepEqual(e.paragraphs.map((p) => p.id), ["p1", "p2", "p3"]);
  assert.equal(e.paragraphs[0].text, "Water is the lifeblood of Pakistan.");
  assert.equal(e.wordCount, 6 + 7 + 6);
  assert.deepEqual(e.outline, ["1. Intro", "2. Causes"]);
  assert.deepEqual(e.uncertain.map((u) => [u.paragraphId, u.word]), [["p2", "suppport"], ["p1", "LIFEBLOOD"]]);
  assert.equal(e.paragraphs[2].pageIndex, 1, "pageIndex is clamped to the last page");
});

test("postProcess throws a user-readable error when nothing was read", () => {
  const empty: RawTranscription = { ...good, paragraphs: [], warnings: ["This is a photo of a cat."] };
  assert.throws(() => postProcess(empty, 1), (e) => e instanceof ApiError && /couldn't read an essay/.test(e.message) && /cat/.test(e.message));
});

test("prepareImages applies EXIF rotation and downsizes", async () => {
  // 3000x1000 stored pixels with orientation 6 (rotate 90 CW): displayed as 1000x3000.
  const src = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#808080" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const [page] = await prepareImages([{ data: src, name: "side.jpg" }]);
  assert.equal(page.mimeType, "image/jpeg");
  assert.equal(page.pageNumber, 1);
  const meta = await sharp(Buffer.from(page.data, "base64")).metadata();
  assert.equal(meta.height, 2000);
  assert.ok(meta.width !== undefined && Math.abs(meta.width - 667) <= 1, `width was ${meta.width}`);
  assert.ok(!meta.orientation || meta.orientation === 1);
});

test("prepareImages keeps order and reports unreadable files clearly", async () => {
  const mk = (c: string) => sharp({ create: { width: 50, height: 50, channels: 3, background: c } }).png().toBuffer();
  const pages = await prepareImages([{ data: await mk("#ff0000") }, { data: await mk("#0000ff") }]);
  assert.deepEqual(pages.map((p) => p.pageNumber), [1, 2]);
  await assert.rejects(prepareImages([{ data: Buffer.from("not an image"), name: "x.jpg" }]), (e) => e instanceof ApiError && /"x.jpg" could not be opened/.test(e.message));
});

test("prepareImages shrinks further, then fails clearly if still too big", async () => {
  const noisy = await sharp({ create: { width: 2400, height: 2400, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 60 } } }).jpeg({ quality: 95 }).toBuffer();
  const big = await prepareImages([{ data: noisy }], { maxBase64Bytes: 700_000 });
  assert.ok(big[0].data.length <= 700_000);
  await assert.rejects(prepareImages([{ data: noisy }], { maxBase64Bytes: 1000 }), (e) => e instanceof ApiError && e.status === 413);
});

const pages = [{ pageNumber: 1, mimeType: "image/jpeg", data: "AAAA" }];

test("readHandwriting retries once with the validation error, then succeeds", async () => {
  const prompts: string[] = [];
  const replies = ["{ not json", JSON.stringify(good)];
  const essay = await readHandwriting(pages, "Water", {
    generate: async (o) => {
      prompts.push(o.prompt);
      assert.equal(o.temperature, 0);
      assert.ok(o.responseSchema);
      return replies.shift()!;
    },
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /previous reply was invalid/);
  assert.equal(essay.paragraphs.length, 3);
});

test("readHandwriting gives a clean error after two invalid replies", async () => {
  let calls = 0;
  await assert.rejects(
    readHandwriting(pages, "Water", { generate: async () => (calls++, "nope") }),
    (e) => e instanceof ApiError && e.status === 502 && !/nope/.test(e.message),
  );
  assert.equal(calls, 2);
});

test("readHandwriting does not retry when the photos hold no essay", async () => {
  let calls = 0;
  const none = JSON.stringify({ ...good, paragraphs: [], uncertain: [], warnings: ["Blank page."] });
  await assert.rejects(readHandwriting(pages, "Water", { generate: async () => (calls++, none) }), (e) => e instanceof ApiError && e.status === 422);
  assert.equal(calls, 1);
});

test("readHandwriting falls back to the next model when the first is overloaded", async () => {
  const { GeminiError } = await import("../gemini.ts");
  const used: string[] = [];
  const essay = await readHandwriting(pages, "Water", {
    generate: async (o) => {
      used.push(o.model);
      if (used.length === 1) throw new GeminiError("high demand", 503);
      return JSON.stringify(good);
    },
  });
  assert.equal(used.length, 2);
  assert.notEqual(used[0], used[1]);
  assert.equal(essay.paragraphs.length, 3);
});
