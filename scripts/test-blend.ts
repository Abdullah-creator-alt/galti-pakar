/**
 * Runs the verify / blend / score step on a fixture. No API key needed.
 * Run: npm run test:blend -- --fixture data/fixtures/essay1.json
 */
import { readFileSync } from "node:fs";
import { blendAnalysis } from "../lib/pipeline/blend.ts";
import type { BlendInput } from "../lib/pipeline/blend.types.ts";
import { BLEND_WEIGHT_MEASURED, LINK_STRONG, LINK_WEAK } from "../lib/pipeline/blendConfig.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--fixture");
const file = i >= 0 ? args[i + 1] : "data/fixtures/essay1.json";
const fx = JSON.parse(readFileSync(file, "utf8"));
const input: BlendInput = { essay: fx.essay, topic: fx.topic, sentences: fx.sentences, structure: fx.structure, analysis: fx.analysis, benchmark: fx.benchmark, examiner: fx.examiner, outlineVecs: fx.outlineVecs };
const r = await blendAnalysis(input);

const pad = (s: unknown, n: number) => String(s).padEnd(n).slice(0, n);
console.log(`Fixture ${file}   links: strong >= ${LINK_STRONG}, weak >= ${LINK_WEAK}\n`);

console.log("Sentences");
console.log(`${pad("id", 7)} ${pad("label", 12)} ${pad("tone", 9)} ${pad("rules", 38)} reason`);
const spanFor = (pid: string, s: number, e: number) => r.reportParts.paragraphs.find((p) => p.id === pid)!.spans.find((x) => x.start <= s && x.end >= e);
for (const s of input.sentences) {
  const lab = input.structure?.sentences.find((l) => l.sentenceId === s.id)?.label ?? "-";
  const sp = spanFor(s.paragraphId, s.start, s.end);
  const t = r.trace.find((x) => x.sentenceIds.includes(s.id));
  console.log(`${pad(s.id, 7)} ${pad(lab, 12)} ${pad(sp?.tone ?? "-", 9)} ${pad(t?.ruleIds.join("+") ?? "-", 38)} ${sp?.reason ?? ""}`);
}

console.log("\nClaim-to-evidence links");
for (const l of r.links) console.log(`  ${pad(l.claimSentenceId, 7)} -> ${pad(l.evidenceSentenceId ?? "none", 7)} ${pad(l.strength, 7)} sim ${l.similarity.toFixed(2)}  (${l.windowUsed})`);
for (const c of r.counters) console.log(`  counterclaim ${c.counterSentenceId}: ${c.status}${c.rebuttalSentenceId ? ` by ${c.rebuttalSentenceId}` : ""}`);
if (r.xray) console.log(`  claims ${r.xray.claimsTotal}: strong ${r.xray.claimsStrong}, weak ${r.xray.claimsWeak}, orphan ${r.xray.claimsOrphan}; linked share ${r.xray.claimsLinkedShare.toFixed(2)}`);

console.log("\nConflicts");
if (!r.conflicts.length) console.log("  none");
for (const c of r.conflicts) console.log(`  [${c.type}] examiner: ${c.examinerSays} | measured: ${c.measuredSays}`);

console.log("\nDimensions");
console.log(`${pad("dimension", 18)} ${pad("measured", 9)} ${pad("examiner", 9)} ${pad("w(meas)", 8)} ${pad("final", 6)} ${pad("band", 11)} ${pad("conf", 7)} flags`);
for (const t of r.dimensionTrace) {
  const d = r.reportParts.dimensions.find((x) => x.key === t.key)!;
  console.log(`${pad(t.key, 18)} ${pad(t.measured ?? "n/a", 9)} ${pad(t.examiner ?? "n/a", 9)} ${pad(BLEND_WEIGHT_MEASURED[t.key], 8)} ${pad(t.final, 6)} ${pad(d.band, 11)} ${pad(t.confidence, 7)} ${t.flags.join(",")}`);
  console.log(`${" ".repeat(19)}${d.note}`);
}
console.log(`\nOverall ${r.reportParts.overallScore} / ${r.reportParts.overallOutOf}   Verdict: ${r.reportParts.verdict}`);

console.log("\nRanked issues (impact = severity x dimension weight x count)");
for (const x of r.rankedIssues) console.log(`  ${pad(x.impact, 5)} ${pad(x.type, 24)} ${pad(x.paragraphId ?? "essay", 6)} sev ${x.severity} x${x.count}  ${x.sentences[0] ? `"${x.sentences[0].text.slice(0, 50)}"` : ""}`);
console.log(`Weakest paragraph: ${r.weakestParagraphId ?? "none"}`);

console.log("\nMetrics", JSON.stringify(r.metrics));
console.log("\nWarnings");
for (const w of r.warnings) console.log(`  - ${w}`);
if (!r.warnings.length) console.log("  none");
