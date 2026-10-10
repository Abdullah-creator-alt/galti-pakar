/**
 * Try the parallel measuring stages (structure | genericness + drift | benchmark) on a text file.
 * Run: npm run test:measure -- essay.txt --topic "Water scarcity in Pakistan"
 * Paragraphs are separated by blank lines. Makes real Gemini calls (structure: 1 text call; the rest: embeddings).
 */
import { readFileSync } from "node:fs";
import { renderFindings } from "../lib/pipeline/examinerPrompt.ts";
import { measureEssay } from "../lib/pipeline/measure.ts";
import { countTextWords } from "../lib/pipeline/sentences.ts";
import type { TranscribedEssay } from "../lib/pipeline/transcribe.types.ts";

const args = process.argv.slice(2);
const ti = args.indexOf("--topic");
const topic = ti >= 0 ? args[ti + 1] : undefined;
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--topic");
if (!file || !topic) {
  console.error('Usage: npm run test:measure -- essay.txt --topic "Your topic"');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set. Copy .env.example to .env.local and add your key.");
  process.exit(1);
}

const texts = readFileSync(file, "utf8").split(/\r?\n\s*\r?\n/).map((t) => t.trim()).filter(Boolean);
const essay: TranscribedEssay = {
  outline: [],
  paragraphs: texts.map((text, i) => ({ id: `p${i + 1}`, kind: i === 0 ? "intro" : i === texts.length - 1 ? "conclusion" : "body", text, pageIndex: 0 })),
  uncertain: [],
  legibility: "good",
  wordCount: texts.reduce((n, t) => n + countTextWords(t), 0),
  warnings: [],
};

const r = await measureEssay(essay, topic);
for (const [name, s] of [["structure", r.structure], ["genericness+drift", r.analysis], ["benchmark", r.benchmark]] as const)
  console.log(`${name.padEnd(18)} ${s.status.padEnd(7)} ${String(s.ms).padStart(6)} ms${s.error ? `  ${s.error}` : ""}`);
console.log(`embedding: ${r.embedding.requestedTexts} texts requested, ${r.embedding.embeddedTexts} sent in ${r.embedding.calls} call(s)`);
console.log(`total ${(r.elapsedMs / 1000).toFixed(1)} s\n`);
for (const w of r.warnings) console.log(`warning: ${w}`);
console.log("\nWhat the examiner would be given:\n" + renderFindings(r.findings));
if (r.structure.value) {
  console.log("\nStructure findings:");
  for (const f of r.structure.value.structuralFindings) console.log(`  ${f.type.padEnd(34)} ${f.sentenceIds.join(",") || f.paragraphIds.join(",")}  conf=${f.confidence} ${f.suggestedSeverity}`);
}
