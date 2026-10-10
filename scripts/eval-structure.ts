/**
 * Live check of the structure-analysis module against the real Gemini model. Run: npm run eval:structure
 * Needs GEMINI_API_KEY in .env.local. Compares the model's sentence roles, links and findings with the
 * hand-labelled baseline for two fixture essays. Two essays is a smoke test, not an accuracy measurement.
 * Without a key it exits with code 2 and makes no call.
 */
import { analyzeEssayStructure } from "../lib/structure/analyze.ts";
import { compareRuns } from "../lib/structure/compare.ts";
import { labelElements, STRONG_ESSAY, WEAK_ESSAY } from "../lib/structure/fixtures.ts";

if (!process.env.GEMINI_API_KEY) {
  console.error("BLOCKED: GEMINI_API_KEY is not set. Copy .env.example to .env.local, add the key, and re-run `npm run eval:structure`.");
  process.exit(2);
}

let failures = 0;
for (const essay of [STRONG_ESSAY, WEAK_ESSAY]) {
  console.log(`\n===== ${essay.id} =====`);
  const baseline = await analyzeEssayStructure({ text: essay.text }, { complete: async () => JSON.stringify({ elements: labelElements(essay) }) });
  const started = Date.now();
  const live = await analyzeEssayStructure({ text: essay.text });
  const ms = Date.now() - started;
  if (!baseline.ok) throw new Error("baseline failed: " + baseline.error.message);
  if (!live.ok) {
    failures++;
    console.log(`LIVE CALL FAILED after ${ms} ms: ${live.error.code} (retryable=${live.error.retryable}) ${live.error.message}`, live.error.details ?? "");
    continue;
  }
  const cmp = compareRuns(baseline.result, live.result);
  console.log(`live call ok in ${ms} ms, attempts=${live.result.analysisMetadata.extractor.attempts}, rejected elements=${live.result.analysisMetadata.rejectedElements.length}`);
  for (const r of live.result.analysisMetadata.rejectedElements) console.log(`  rejected #${r.index}: ${r.code}`);
  console.log("counts", cmp.counts);
  for (const r of cmp.sentences.filter((x) => x.kind !== "agree")) console.log(`  ${r.kind.padEnd(20)} ${r.sentenceId}  baseline=${r.baseline} model=${r.candidate}  "${r.text}"`);
  console.log("links only in baseline:", cmp.links.onlyBaseline, "\nlinks only in model:   ", cmp.links.onlyCandidate);
  console.log("findings only in baseline:", cmp.findings.onlyBaseline, "\nfindings only in model:   ", cmp.findings.onlyCandidate);
}
process.exit(failures ? 1 : 0);
