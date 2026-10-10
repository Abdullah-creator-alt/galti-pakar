/**
 * Builds the synthetic datasets and runtime assets. Idempotent and resumable:
 * every API result is cached in data/cache/, so reruns only fill what is missing.
 * Run: npm run build:data
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GEMINI_TEXT_MODEL } from "../lib/config.ts";
import { generateJson, GeminiError } from "../lib/gemini.ts";
import { embedTexts } from "../lib/pipeline/embed.ts";
import { seededShuffle } from "../lib/pipeline/logreg.ts";
import { cosine, roundVec } from "../lib/pipeline/vecmath.ts";

const DATA = path.join(process.cwd(), "data");
const CACHE = path.join(DATA, "cache");
mkdirSync(CACHE, { recursive: true });

const SEED = 42;
const MODELS = ["gemini-3.6-flash", GEMINI_TEXT_MODEL, "gemini-3-flash-preview", "gemini-3.5-flash", "gemini-3.1-flash-lite"];
/** Models whose free-tier daily quota is used up. They are skipped for the rest of the run. */
const exhausted = new Set<string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Topic { id: string; theme: string; text: string }
const topics: Topic[] = JSON.parse(readFileSync(path.join(DATA, "topics.json"), "utf8"));

/* ---------- cached JSON generation ---------- */

function cacheRead<T>(name: string): T | null {
  const p = path.join(CACHE, name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}
const cacheWrite = (name: string, v: unknown) => writeFileSync(path.join(CACHE, name), JSON.stringify(v));

async function gen<T>(cacheName: string, prompt: string, schema: unknown): Promise<T> {
  const hit = cacheRead<T>(cacheName);
  if (hit) return hit;
  let last: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    const live = MODELS.filter((m) => !exhausted.has(m));
    if (live.length === 0) throw new Error("Every model has hit its quota. Wait for the daily reset and rerun npm run build:data (progress is cached).");
    const model = live[attempt % live.length];
    try {
      const r = await generateJson<T>({ model, prompt, responseSchema: schema, temperature: 1, timeoutMs: 120_000, maxOutputTokens: 16384 });
      cacheWrite(cacheName, r);
      console.log(`  generated ${cacheName} (${model})`);
      return r;
    } catch (e) {
      last = e;
      if (/exceeded your current quota/i.test((e as Error).message)) exhausted.add(model);
      const status = e instanceof GeminiError ? e.status : undefined;
      console.log(`  retry ${cacheName}: ${(e as Error).message.slice(0, 90)}`);
      await sleep(1500 * (attempt + 1) + (status === 429 ? 5000 : 0));
    }
  }
  throw new Error(`Could not generate ${cacheName}: ${(last as Error)?.message}`);
}

async function pool<T, R>(items: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  return xs.map((x) => x.trim()).filter((x) => x.length > 15 && !seen.has(norm(x)) && seen.add(norm(x)));
}

/* ---------- 1. generate text ---------- */

const GENERIC_HINTS = [
  "cliched openers about the modern world and progress",
  "platitudes about society, the youth and the future of the nation",
  "vague claims about government, problems and solutions",
  "stock phrases used to start a conclusion or wrap up an argument",
  "moralising statements about unity, honesty and hard work",
  "vague statements about technology, education and development",
  "overused proverbs and famous sayings dropped in without analysis",
  "sentences that say the nation, people or government must act, with no detail",
];

const arrSchema = { type: "OBJECT", properties: { sentences: { type: "ARRAY", items: { type: "STRING" } } }, required: ["sentences"] };

async function genericSentences(): Promise<string[]> {
  const all: string[] = [];
  for (let round = 0; round < 3 && dedupe(all).length < 300; round++) {
    const batchesNeeded = Math.max(Math.ceil((300 - dedupe(all).length) / 45), 1);
    const start = all.length ? GENERIC_HINTS.length * round : 0;
    const results = await pool(Array.from({ length: batchesNeeded }, (_, k) => start + k), 3, (b) =>
      gen<{ sentences: string[] }>(
        `generic-${b}.json`,
        `Write 50 different generic filler sentences of the kind found in weak English essays by CSS (Pakistan civil service exam) candidates. They must be vague, cliched platitudes or stock openers and closers that could appear in an essay on ANY topic. Do NOT include names, numbers, years, institutions, laws or places. Vary the length from 8 to 30 words. Focus of this batch: ${GENERIC_HINTS[b % GENERIC_HINTS.length]}. Make each sentence different from the others. Return JSON {"sentences": [...]}.`,
        arrSchema,
      ),
    );
    results.forEach((r) => all.push(...r.sentences));
  }
  return dedupe(all);
}

const itemsSchema = {
  type: "OBJECT",
  properties: { items: { type: "ARRAY", items: { type: "OBJECT", properties: { topicId: { type: "STRING" }, sentence: { type: "STRING" } }, required: ["topicId", "sentence"] } } },
  required: ["items"],
};

async function specificSentences(): Promise<{ topicId: string; sentence: string }[]> {
  const groups: Topic[][] = [];
  for (let i = 0; i < topics.length; i += 5) groups.push(topics.slice(i, i + 5));
  const results = await pool(groups, 3, (g, gi) =>
    gen<{ items: { topicId: string; sentence: string }[] }>(
      `specific-${gi}.json`,
      `For EACH topic below write 6 SPECIFIC sentences, as they would appear in a strong CSS English essay on that topic. Every sentence must contain concrete detail: named institutions, laws, treaties, people, places, dates or figures, with Pakistan context where relevant. Use widely known facts and approximate figures; do not invent precise statistics you are unsure of. Vary length from 15 to 35 words. Topics:\n${g.map((t) => `${t.id}: ${t.text}`).join("\n")}\nReturn JSON {"items": [{"topicId": "...", "sentence": "..."}]} with 30 items.`,
      itemsSchema,
    ),
  );
  const seen = new Set<string>();
  return results.flatMap((r) => r.items).filter((x) => x.sentence.trim().length > 15 && !seen.has(norm(x.sentence)) && seen.add(norm(x.sentence)));
}

interface ParaPair { topicId: string; onTopic: string; offTopic: string; offTopicId: string }
const paraSchema = { type: "OBJECT", properties: { onTopic: { type: "STRING" }, offTopic: { type: "STRING" } }, required: ["onTopic", "offTopic"] };

const groupSchema = {
  type: "OBJECT",
  properties: { items: { type: "ARRAY", items: { type: "OBJECT", properties: { topicId: { type: "STRING" }, onTopic: { type: "STRING" }, offTopic: { type: "STRING" } }, required: ["topicId", "onTopic", "offTopic"] } } },
  required: ["items"],
};

async function driftParagraphs(): Promise<ParaPair[]> {
  const sample = seededShuffle(topics, SEED).slice(0, 40);
  const offFor = (t: Topic, i: number) => {
    const others = topics.filter((o) => o.theme !== t.theme);
    return others[(i * 7) % others.length];
  };
  const pending = sample.map((t, i) => ({ t, off: offFor(t, i) })).filter(({ t }) => !cacheRead(`drift-${t.id}.json`));
  // Several topics per request keeps us inside small free-tier quotas.
  const groups: (typeof pending)[] = [];
  for (let i = 0; i < pending.length; i += 5) groups.push(pending.slice(i, i + 5));
  await pool(groups, 2, async (g, gi) => {
    const r = await gen<{ items: { topicId: string; onTopic: string; offTopic: string }[] }>(
      `drift-group-${g.map((x) => x.t.id).join("-")}.json`,
      `For EACH essay topic below, write two short paragraphs (60 to 90 words each) in the style of a CSS English essay candidate.
"onTopic": clearly about the essay topic.
"offTopic": clearly about the DIFFERENT subject given, and it must not mention or depend on the essay topic.

${g.map((x) => `${x.t.id}: essay topic "${x.t.text}" | off-topic subject "${x.off.text}"`).join("\n")}

Return JSON {"items": [{"topicId": "...", "onTopic": "...", "offTopic": "..."}]} with ${g.length} items.`,
      groupSchema,
    );
    for (const it of r.items) if (g.some((x) => x.t.id === it.topicId)) cacheWrite(`drift-${it.topicId}.json`, { onTopic: it.onTopic, offTopic: it.offTopic });
    void gi;
  });
  return sample.map((t, i) => {
    const r = cacheRead<{ onTopic: string; offTopic: string }>(`drift-${t.id}.json`);
    if (!r) throw new Error(`Missing drift paragraphs for ${t.id}; rerun npm run build:data.`);
    return { topicId: t.id, onTopic: r.onTopic.trim(), offTopic: r.offTopic.trim(), offTopicId: offFor(t, i).id };
  });
}

/* ---------- 2. embeddings with cache ---------- */

const EMB_FILE = "embeddings.json";
let embCache: Record<string, number[]> = cacheRead<Record<string, number[]>>(EMB_FILE) ?? {};
const key = (t: string) => createHash("sha1").update(t).digest("hex");

async function embedCached(texts: string[]): Promise<number[][]> {
  const missing = [...new Set(texts.filter((t) => !embCache[key(t)]))];
  const CHUNK = 90; // the free tier allows about 100 embedded texts per minute
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    for (let attempt = 0; ; attempt++) {
      try {
        const vecs = await embedTexts(chunk, { retries: 0 });
        chunk.forEach((t, j) => (embCache[key(t)] = roundVec(vecs[j])));
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
  return texts.map((t) => embCache[key(t)]);
}

/* ---------- main ---------- */

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set (see .env.example).");
  if (topics.length !== 50) console.log(`Note: ${topics.length} topics (brief asked for 50).`);

  console.log("Generating generic sentences...");
  const generic = await genericSentences();
  console.log("Generating specific sentences...");
  const specific = await specificSentences();
  console.log("Generating drift paragraphs...");
  const pairs = await driftParagraphs();
  console.log(`Got ${generic.length} generic, ${specific.length} specific, ${pairs.length} paragraph pairs.`);

  // Bank = 100 generic sentences, disjoint from everything used for training/testing.
  const gShuffled = seededShuffle(generic, SEED);
  const bankTexts = gShuffled.slice(0, 100);
  const genericRest = gShuffled.slice(100);

  console.log("Embedding...");
  const topicVecs = await embedCached(topics.map((t) => t.text));
  const bankVecs = await embedCached(bankTexts);
  const restTexts = [...genericRest, ...specific.map((s) => s.sentence)];
  const restVecs = await embedCached(restTexts);
  const paraTexts = pairs.flatMap((p) => [p.onTopic, p.offTopic]);
  const paraVecs = await embedCached(paraTexts);

  // Remove near-duplicates of bank sentences from the train/test pool.
  const labelled = restTexts.map((text, i) => ({ text, label: i < genericRest.length ? 1 : 0, vec: restVecs[i] }));
  const clean = labelled.filter((x) => !bankVecs.some((b) => cosine(x.vec, b) >= 0.95));
  console.log(`Dropped ${labelled.length - clean.length} near-duplicates of the bank.`);

  const split = (rows: typeof clean) => {
    const s = seededShuffle(rows, SEED);
    const cut = Math.floor(s.length * 0.8);
    return { train: s.slice(0, cut), test: s.slice(cut) };
  };
  const g = split(clean.filter((x) => x.label === 1));
  const sp = split(clean.filter((x) => x.label === 0));
  const train = seededShuffle([...g.train, ...sp.train], SEED);
  const test = seededShuffle([...g.test, ...sp.test], SEED);

  const meta = { model: "gemini-embedding-001", dimensions: 768, taskType: "SEMANTIC_SIMILARITY", synthetic: true };
  const write = (f: string, v: unknown) => writeFileSync(path.join(DATA, f), JSON.stringify(v));
  const rows = (xs: typeof clean) => xs.map((x) => ({ text: x.text, label: x.label, vec: x.vec }));

  write("topics.embedded.json", { ...meta, topics: topics.map((t, i) => ({ ...t, vec: topicVecs[i] })) });
  write("generic-bank.embedded.json", { ...meta, items: bankTexts.map((text, i) => ({ text, vec: bankVecs[i] })) });
  write("sentences.embedded.json", { ...meta, labels: { generic: 1, specific: 0 }, train: rows(train), test: rows(test) });
  write("drift-set.json", {
    ...meta,
    items: pairs.flatMap((p, i) => [
      { topicId: p.topicId, onTopic: true, text: p.onTopic, vec: paraVecs[2 * i] },
      { topicId: p.topicId, onTopic: false, text: p.offTopic, vec: paraVecs[2 * i + 1] },
    ]),
  });

  console.log(`Done. bank=${bankTexts.length} train=${train.length} (generic ${g.train.length}) test=${test.length} (generic ${g.test.length}) paragraphs=${paraTexts.length}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
