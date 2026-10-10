/**
 * Runs the fixes + model paragraph step on a fixture (reusing the verify/blend output).
 * Run: npm run test:coach -- --fixture data/fixtures/essay1.json [--mock]
 * With GEMINI_API_KEY set it calls Gemini. Without a key (or with --mock) it uses the hand-written sample responses in
 * data/fixtures/coach-mock.json, and says so: that output says nothing about real model quality.
 * Real runs append a line to data/eval/coach-metrics.json; mocked runs are not recorded.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { blendAnalysis } from "../lib/pipeline/blend.ts";
import type { BlendInput } from "../lib/pipeline/blend.types.ts";
import { CoachError, coachEssay, type GenerateFn } from "../lib/pipeline/coach.ts";
import { FIXES_SYSTEM, REWRITE_SYSTEM } from "../lib/pipeline/coachPrompt.ts";
import { COACH, COACH_TEMPERATURE, GEMINI_COACH_MODEL } from "../lib/config.ts";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const file = flag("fixture") ?? "data/fixtures/essay1.json";
const fx = JSON.parse(readFileSync(file, "utf8"));
const mocked = args.includes("--mock") || !process.env.GEMINI_API_KEY;

const input: BlendInput = { essay: fx.essay, topic: fx.topic, sentences: fx.sentences, structure: fx.structure, analysis: fx.analysis, benchmark: fx.benchmark, examiner: fx.examiner, outlineVecs: fx.outlineVecs };
const blended = await blendAnalysis(input);

const mock = JSON.parse(readFileSync("data/fixtures/coach-mock.json", "utf8"));
const mockGenerate: GenerateFn = async (o) => {
  if (o.system === FIXES_SYSTEM) {
    const keys = [...o.prompt.matchAll(/^\[((?:issue|dimension|benchmark):[^\]]+)\]$/gm)].map((m) => m[1]);
    return JSON.stringify({ fixes: keys.map((k) => ({ issueKey: k, ...(mock.fixes[k] ?? { title: "Improve this area", body: "Sample response for an issue the mock does not cover.", evidenceQuote: "" }) })) });
  }
  if (o.system === REWRITE_SYSTEM) return JSON.stringify(mock.rewrite);
  throw new Error("unexpected call");
};

console.log(mocked ? "*** MOCKED OUTPUT: hand-written sample responses, not Gemini. ***\n" : `Calling Gemini (first choice ${GEMINI_COACH_MODEL}, temperature ${COACH_TEMPERATURE}; fallbacks if overloaded).\n`);
console.log(`Weakest paragraph chosen by code: ${blended.weakestParagraphId}\nTop issues: ${blended.rankedIssues.slice(0, 5).map((i) => `${i.type}@${i.paragraphId ?? "essay"} (${i.impact})`).join(", ")}\n`);

let r;
try {
  r = await coachEssay(fx.essay, fx.topic, blended, { benchmark: fx.benchmark, ...(mocked ? { generate: mockGenerate } : {}) });
} catch (e) {
  if (e instanceof CoachError) {
    console.error(`Coach error (${e.kind}, ${e.status}): ${e.message}`);
    if (e.partialFixes.length) console.error(`${e.partialFixes.length} fix(es) were produced before the failure:`, e.partialFixes.map((f) => f.title));
  } else console.error(e);
  process.exit(1);
}

console.log("FIXES");
r.fixes.forEach((f, i) => {
  const s = r.extras.fixSources[i];
  console.log(`\n${f.rank}. ${f.title}   [source: ${s.source}${f.paragraphId ? `, ${f.paragraphId}` : ""}]`);
  console.log(`   ${f.body}`);
  console.log(`   quote: ${s.quote ? `verified in ${s.quote.paragraphId} ${s.quote.start}-${s.quote.end}: "${s.quote.text}"` : s.quoteUnverified ? "UNVERIFIED (dropped, fix kept)" : "none"}${s.notes.length ? `   notes: ${s.notes.join(", ")}` : ""}`);
});

const rw = r.rewrite;
console.log(`\nMODEL PARAGRAPH (${rw.paragraphId}), a teaching model, not a replacement for your own writing`);
console.log(`\nORIGINAL:\n${rw.original}\n\nIMPROVED:\n${rw.improved}`);
console.log(`\nremoved (${rw.removed?.length ?? 0}):`); rw.removed?.forEach((x) => console.log(`  - "${x}"`));
console.log(`added (${rw.added?.length ?? 0}):`); rw.added?.forEach((x) => console.log(`  + "${x}"`));
console.log(`\nChange notes:`); r.extras.changeNotes.forEach((n) => console.log(`  - ${n.what} (${n.why})`));
console.log(`Slots to fill in yourself (${r.extras.placeholdersAdded.length}/${COACH.MAX_SLOTS}): ${r.extras.placeholdersAdded.join(" | ") || "none"}`);
console.log(`\nWarnings:`); (r.extras.warnings.length ? r.extras.warnings : ["none"]).forEach((w) => console.log(`  - ${w}`));
console.log(`\nModels that answered: ${mocked ? "none (mocked)" : r.metrics.models.join(", ")}\nMetrics ${JSON.stringify(r.metrics)}`);

if (mocked) console.log("\nMocked run: metrics NOT appended to data/eval/coach-metrics.json.");
else {
  const out = path.join(process.cwd(), "data", "eval", "coach-metrics.json");
  mkdirSync(path.dirname(out), { recursive: true });
  const all: unknown[] = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : [];
  all.push({ at: new Date().toISOString(), fixture: path.basename(file), ...r.metrics });
  writeFileSync(out, JSON.stringify(all, null, 2));
  console.log(`\nAppended to data/eval/coach-metrics.json (${all.length} entr${all.length === 1 ? "y" : "ies"}).`);
}
