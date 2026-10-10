/**
 * Try drift and genericness on a text file (paragraphs separated by blank lines).
 * Run: npm run test:genericness -- essay.txt --topic "Water scarcity in Pakistan"
 */
import { readFileSync } from "node:fs";
import { analyseGenericnessAndDrift, toSpans } from "../lib/pipeline/analyse.ts";
import { reasonText } from "../lib/pipeline/genericness.ts";

const args = process.argv.slice(2);
const ti = args.indexOf("--topic");
const topic = ti >= 0 ? args[ti + 1] : undefined;
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--topic");
if (!file || !topic) {
  console.error('Usage: npm run test:genericness -- essay.txt --topic "Your topic"');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set. Copy .env.example to .env.local and add your key.");
  process.exit(1);
}

const paragraphs = readFileSync(file, "utf8")
  .split(/\r?\n\s*\r?\n/)
  .map((t) => t.trim())
  .filter(Boolean)
  .map((text, i) => ({ id: `p${i + 1}`, text }));

const t0 = Date.now();
const a = await analyseGenericnessAndDrift(topic, paragraphs);
const ms = Date.now() - t0;

console.log(`Topic: ${topic}\n\nDrift curve (relevance 0-100):`);
for (const p of a.paragraphs) {
  const bar = "#".repeat(Math.round(p.relevance / 4)).padEnd(25, ".");
  console.log(`  ${p.id.padEnd(4)} ${bar} ${p.relevance.toFixed(0).padStart(3)}  raw cos ${p.rawSimilarity.toFixed(3)}${p.driftFlag ? "  <-- DRIFTS" : ""}`);
}
console.log(`\nDrifting: ${a.driftingParagraphIds.join(", ") || "none"}`);
console.log(`Generic share: ${(a.genericShare * 100).toFixed(0)}%   Specificity: ${a.specificityPer100Words.toFixed(1)} details per 100 words`);

for (const p of a.paragraphs) {
  const text = paragraphs.find((x) => x.id === p.id)!.text;
  console.log(`\n[${p.id}] avg generic score ${p.avgGenericScore === null ? "n/a" : p.avgGenericScore.toFixed(2)}`);
  for (const s of p.sentences) {
    const tag = s.level.toUpperCase().padEnd(8);
    console.log(`  ${tag} ${s.genericScore === null ? " n/a" : s.genericScore.toFixed(2)}  ${text.slice(s.start, s.end).slice(0, 90)}${s.end - s.start > 90 ? "…" : ""}`);
    const why = reasonText(s.level, s.reasonCodes);
    if (why) console.log(`           ${why}`);
  }
  console.log(`  -> ${toSpans(p).length} highlight span(s)`);
}
console.log(`\nTime ${(ms / 1000).toFixed(1)} s, ${a.embedTextCount} texts embedded (${Math.ceil(a.embedTextCount / 100)} API call(s)).`);
