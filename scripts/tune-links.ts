/**
 * Sweeps LINK_STRONG / LINK_WEAK against hand-labelled claim -> evidence pairs and recommends thresholds.
 * Run: npm run tune-links
 *
 * Input: data/eval/links.json (see data/eval/links.example.json):
 *   { "items": [ { "id": "...", "claim": "text",
 *       "candidates": [ { "text": "...", "sameParagraph": true, "vec": [optional] } ],
 *       "gold": 0 } ] }
 * `gold` is the index of the correct evidence among `candidates`, or null when the claim has no evidence.
 * Texts without a "vec" are embedded with Gemini (cached in data/cache/), which needs GEMINI_API_KEY.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LINK_STRONG, LINK_WEAK } from "../lib/pipeline/blendConfig.ts";
import { decideLink } from "../lib/pipeline/xray.ts";

const file = path.join(process.cwd(), "data", "eval", "links.json");
if (!existsSync(file)) {
  console.log(`No ${path.relative(process.cwd(), file)} found.

Create it from data/eval/links.example.json:
  1. For each claim sentence in a few real essays, copy the claim text.
  2. List the Evidence-labelled sentences near it as "candidates" (set sameParagraph true/false).
  3. Set "gold" to the index of the sentence that really supports the claim, or null if none does.
Aim for 30 or more claims, including some with gold = null, then run: npm run tune-links`);
  process.exit(0);
}

interface Item { id: string; claim: string; candidates: { text: string; sameParagraph: boolean; vec?: number[] }[]; gold: number | null; claimVec?: number[] }
const items: Item[] = JSON.parse(readFileSync(file, "utf8")).items;
if (!items?.length) {
  console.log("links.json has no items.");
  process.exit(0);
}

// Embed whatever lacks a vector, in one cached pass.
const need = [...new Set(items.flatMap((it) => [...(it.claimVec ? [] : [it.claim]), ...it.candidates.filter((c) => !c.vec).map((c) => c.text)]))];
if (need.length) {
  if (!process.env.GEMINI_API_KEY) {
    console.error(`${need.length} texts have no "vec" and GEMINI_API_KEY is not set. Add vectors or set the key in .env.local.`);
    process.exit(1);
  }
  const { embedCached } = await import("./util.ts");
  const vecs = await embedCached(need);
  const by = new Map(need.map((t, i) => [t, vecs[i]]));
  for (const it of items) {
    it.claimVec ??= by.get(it.claim);
    for (const c of it.candidates) c.vec ??= by.get(c.text);
  }
}

interface Row { strong: number; weak: number; p: number; r: number; f1: number; strongPrecision: number; tp: number; fp: number; fn: number }
function evaluate(strong: number, weak: number): Row {
  let tp = 0, fp = 0, fn = 0, strongN = 0, strongOk = 0;
  for (const it of items) {
    const d = decideLink(it.claimVec, it.candidates.map((c, i) => ({ id: String(i), vec: c.vec, sameParagraph: c.sameParagraph })), { strong, weak });
    const linked = d.strength !== "orphan";
    const correct = linked && it.gold !== null && d.evidenceId === String(it.gold);
    if (correct) tp++;
    else if (linked) fp++;
    if (it.gold !== null && !correct) fn++;
    if (d.strength === "strong") { strongN++; if (correct) strongOk++; }
  }
  const p = tp + fp ? tp / (tp + fp) : 0;
  const r = tp + fn ? tp / (tp + fn) : 0;
  return { strong, weak, p, r, f1: p + r ? (2 * p * r) / (p + r) : 0, strongPrecision: strongN ? strongOk / strongN : 0, tp, fp, fn };
}

const rows: Row[] = [];
for (let s = 0.7; s <= 0.941; s += 0.02) for (let w = 0.6; w <= s + 1e-9; w += 0.02) rows.push(evaluate(Math.round(s * 100) / 100, Math.round(w * 100) / 100));
rows.sort((a, b) => b.f1 - a.f1 || b.weak - a.weak || b.strong - a.strong); // ties prefer stricter thresholds
const fmt = (r: Row) => `strong ${r.strong.toFixed(2)}  weak ${r.weak.toFixed(2)}  precision ${r.p.toFixed(2)}  recall ${r.r.toFixed(2)}  F1 ${r.f1.toFixed(2)}  strong-link precision ${r.strongPrecision.toFixed(2)}`;

const withGold = items.filter((i) => i.gold !== null).length;
console.log(`${items.length} claims (${withGold} with evidence, ${items.length - withGold} without).`);
if (items.length < 30) console.log("WARNING: fewer than 30 claims; treat the recommendation as a rough guide.");
console.log("\nBest settings:");
rows.slice(0, 5).forEach((r) => console.log("  " + fmt(r)));
console.log("\nCurrent config:\n  " + fmt(evaluate(LINK_STRONG, LINK_WEAK)));
console.log(`\nRecommended: LINK_STRONG = ${rows[0].strong}, LINK_WEAK = ${rows[0].weak} (edit lib/pipeline/blendConfig.ts)`);
