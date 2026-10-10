/**
 * Try the benchmark on a text file.
 * Run: npm run test:benchmark -- essay.txt --topic "Water scarcity in Pakistan"
 */
import { readFileSync } from "node:fs";
import { EMBED_TEXT_BUDGET } from "../lib/config.ts";
import { benchmarkEssay } from "../lib/pipeline/benchmark.ts";
import { embedTexts } from "../lib/pipeline/embed.ts";
import { splitSentences, countTextWords } from "../lib/pipeline/sentences.ts";

const args = process.argv.slice(2);
const ti = args.indexOf("--topic");
const topic = ti >= 0 ? args[ti + 1] : undefined;
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--topic");
if (!file || !topic) {
  console.error('Usage: npm run test:benchmark -- essay.txt --topic "Your topic"');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set. Copy .env.example to .env.local and add your key.");
  process.exit(1);
}

let sentences = splitSentences(readFileSync(file, "utf8")).map((s) => s.text);
// Stay inside the free-tier embedding limit: keep the longest sentences, in original order.
if (sentences.length > EMBED_TEXT_BUDGET - 1) {
  const keep = new Set([...sentences.keys()].sort((a, b) => countTextWords(sentences[b]) - countTextWords(sentences[a])).slice(0, EMBED_TEXT_BUDGET - 1));
  console.log(`Note: ${sentences.length} sentences; using the ${keep.size} longest to stay inside the free-tier embedding limit.\n`);
  sentences = sentences.filter((_, i) => keep.has(i));
}

const t0 = Date.now();
const vecs = await embedTexts([topic, ...sentences]);
const r = await benchmarkEssay({ topic, topicVec: vecs[0], sentences: sentences.map((text, i) => ({ text, vec: vecs[i + 1] })) });
console.log(`Status: ${r.status}${r.reason ? `\nReason: ${r.reason}` : ""}`);
if (r.theme) console.log(`Theme: ${r.theme.label} (similarity ${r.theme.similarity.toFixed(3)})`);
if (r.coverage) {
  const c = r.coverage;
  console.log(`\nCoverage (${c.basis}, ${c.nReferences} reference essays): ${c.covered} of ${c.total} key points`);
  const line = (p: (typeof c.missing)[number]) => `  [${p.type}] ${p.point}  (sim ${p.bestSimilarity}${p.madeByCount !== null ? `, made by ${p.madeByCount} of ${p.ofN}` : ", checklist"})`;
  console.log("\nCovered:"); c.coveredPoints.forEach((p) => console.log(line(p)));
  console.log("\nMissing:"); c.missing.forEach((p) => console.log(line(p)));
}
if (r.profile.length) {
  console.log(`\nProfile (reference n = ${r.nProfileEssays}):`);
  for (const p of r.profile) console.log(`  ${p.label.padEnd(42)} ${String(p.value).padStart(7)}  [${p.refQ1} - ${p.refQ3}] ${p.position.toUpperCase()}\n      ${p.note}`);
} else console.log("\nProfile: unavailable (no reference essays).");
console.log("\nDisclaimers:"); r.disclaimers.forEach((d) => console.log(`  - ${d}`));
console.log(`\nTime ${((Date.now() - t0) / 1000).toFixed(1)} s, 1 embedding call.`);
