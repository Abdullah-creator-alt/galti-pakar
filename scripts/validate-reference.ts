/**
 * Checks data/reference-raw/*.txt. Refuses essays missing permission or quality_basis.
 * Run: npm run validate:reference   (no API key needed)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BENCHMARK } from "../lib/config.ts";
import { ReferenceError, parseReference } from "../lib/pipeline/reference.ts";

const DATA = path.join(process.cwd(), "data");
const dir = path.join(DATA, "reference-raw");
const themes: { key: string; label: string }[] = JSON.parse(readFileSync(path.join(DATA, "themes.json"), "utf8"));
const keys = themes.map((t) => t.key);

const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".txt")) : [];
const byTheme: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
const byBasis: Record<string, number> = {};
let bad = 0;

for (const f of files) {
  try {
    const { meta } = parseReference(readFileSync(path.join(dir, f), "utf8"), keys);
    byTheme[meta.theme]++;
    byBasis[meta.qualityBasis] = (byBasis[meta.qualityBasis] ?? 0) + 1;
  } catch (e) {
    bad++;
    console.log(`REFUSED ${f}: ${e instanceof ReferenceError ? e.problems.join("; ") : (e as Error).message}`);
  }
}

console.log(`\n${files.length} file(s), ${files.length - bad} valid, ${bad} refused.`);
console.log("\nPer theme:");
for (const k of keys) {
  const n = byTheme[k];
  console.log(`  ${k.padEnd(20)} ${String(n).padStart(2)}${n < BENCHMARK.MIN_REFERENCE_ESSAYS ? `   WARNING: fewer than ${BENCHMARK.MIN_REFERENCE_ESSAYS} essays; this theme will use the AI checklist only` : ""}`);
}
console.log("\nPer quality basis:");
if (Object.keys(byBasis).length === 0) console.log("  (none)");
for (const [k, n] of Object.entries(byBasis)) console.log(`  ${k.padEnd(18)} ${n}`);
if (files.length === 0) console.log("\nNo reference essays found. Add .txt files to data/reference-raw/ (see its README.md).");
process.exit(bad ? 1 : 0);
