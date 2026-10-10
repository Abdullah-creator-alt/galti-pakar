/**
 * Try the examiner second opinion on a text file (paragraphs separated by blank lines).
 * Run: npm run test:examiner -- --essay path.txt --topic "..." [--findings path.json] [--runs 2] [--measure]
 * --measure computes drift and genericness first (needs the embedding quota); --findings loads a MeasuredFindings JSON file.
 * Each run appends a line to data/eval/examiner-metrics.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyseGenericnessAndDrift } from "../lib/pipeline/analyse.ts";
import { scoreExaminers } from "../lib/pipeline/examiner.ts";
import { findingsFromAnalysis } from "../lib/pipeline/findings.ts";
import { RUBRIC_KEYS, type MeasuredFindings } from "../lib/pipeline/findings.types.ts";
import { SCORE_TO_BAND } from "../lib/pipeline/rubric.ts";
import { countTextWords } from "../lib/pipeline/sentences.ts";
import type { TranscribedEssay } from "../lib/pipeline/transcribe.types.ts";
import { ApiError } from "../lib/pipeline/validate.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const essayPath = flag("essay");
const topic = flag("topic");
const runs = Number(flag("runs") ?? 2) as 1 | 2 | 3;
if (!essayPath || !topic || ![1, 2, 3].includes(runs)) {
  console.error('Usage: npm run test:examiner -- --essay path.txt --topic "Your topic" [--findings path.json] [--runs 1|2|3] [--measure]');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set. Copy .env.example to .env.local and add your key.");
  process.exit(1);
}

const paragraphs = readFileSync(essayPath, "utf8").split(/\r?\n\s*\r?\n/).map((t) => t.trim()).filter(Boolean)
  .map((text, i, all) => ({ id: `p${i + 1}`, kind: (i === 0 ? "intro" : i === all.length - 1 ? "conclusion" : "body") as "intro" | "body" | "conclusion", text, pageIndex: 0 }));
const essay: TranscribedEssay = {
  outline: [], paragraphs, uncertain: [], legibility: "good", warnings: [],
  wordCount: paragraphs.reduce((n, p) => n + countTextWords(p.text), 0),
};

let findings: MeasuredFindings = {};
if (flag("findings")) findings = JSON.parse(readFileSync(flag("findings")!, "utf8"));
if (args.includes("--measure")) findings = { ...findings, ...findingsFromAnalysis(await analyseGenericnessAndDrift(topic, paragraphs), essay) };
console.log(`Findings supplied: ${Object.keys(findings).join(", ") || "none"}\n`);

let r;
try {
  r = await scoreExaminers(essay, topic, findings, { runs });
} catch (e) {
  console.error(e instanceof ApiError ? `Error ${e.status}: ${e.message}` : e);
  process.exit(1);
}

for (const d of r.dimensions) {
  const flags = Object.entries(d.flags).filter(([, v]) => v).map(([k]) => k.toUpperCase());
  console.log(`${d.label.toUpperCase()}  median ${d.medianScore} / 10  (${d.band})  runs [${d.scores.join(", ")}]  confidence ${d.confidence}${flags.length ? "  FLAGS: " + flags.join(", ") : ""}`);
  d.reasons.forEach((x, i) => console.log(`   run ${r.runs[i].index}: ${x}`));
  for (const q of d.verifiedQuotes) console.log(`   quote [${q.paragraphId} ${q.start}-${q.end}] "${q.text}"`);
  d.disagreements.forEach((x) => console.log(`   disagrees with a measurement: ${x}`));
}
const catchRate = r.quotesProposed ? r.quotesRejected / r.quotesProposed : 0;
console.log(`\nQuotes: ${r.quotesProposed} proposed, ${r.quotesVerified} verified, ${r.quotesRejected} rejected (catch rate ${(catchRate * 100).toFixed(0)}%)`);
console.log(`Run agreement: ${r.agreement.total ? `${r.agreement.agreedCount} of ${r.agreement.total} dimensions agree (within 1 point)${r.agreement.disagreeingDimensions.length ? "; differ on " + r.agreement.disagreeingDimensions.join(", ") : ""}` : "n/a (single run)"}`);
console.log(`Unverified dimensions: ${r.unverifiedDimensions.length} ${r.unverifiedDimensions.join(", ")}`);
console.log(`Conflicts: ${r.conflicts.length}${r.conflicts.map((c) => `\n   ${c.key}: ${c.note}`).join("")}`);
if (r.warnings.length) console.log("Warnings:\n" + r.warnings.map((w) => "   - " + w).join("\n"));
console.log(`Models: ${[...new Set(r.runs.map((x) => x.model))].join(", ")}   Time: ${(r.elapsedMs / 1000).toFixed(1)} s`);
console.log(`Band thresholds (uncalibrated): competitive >= ${SCORE_TO_BAND.competitive}, borderline >= ${SCORE_TO_BAND.borderline}`);

const file = path.join(process.cwd(), "data", "eval", "examiner-metrics.json");
mkdirSync(path.dirname(file), { recursive: true });
const all: unknown[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
all.push({
  at: new Date().toISOString(),
  essay: path.basename(essayPath),
  topic,
  runsRequested: runs,
  runsSucceeded: r.runs.length,
  models: r.runs.map((x) => x.model),
  findingsFields: Object.keys(findings),
  quotes: { proposed: r.quotesProposed, verified: r.quotesVerified, rejected: r.quotesRejected, catchRate },
  runAgreement: r.agreement,
  unverifiedDimensions: r.unverifiedDimensions,
  conflicts: r.conflicts.length,
  medianScores: Object.fromEntries(RUBRIC_KEYS.map((k) => [k, r.dimensions.find((d) => d.key === k)!.medianScore])),
  elapsedMs: r.elapsedMs,
});
writeFileSync(file, JSON.stringify(all, null, 2));
console.log(`\nAppended to data/eval/examiner-metrics.json (${all.length} entr${all.length === 1 ? "y" : "ies"}).`);
