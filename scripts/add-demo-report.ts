/**
 * Adds a cached sample analysis to the site, so a demo works even if the live analysis is slow or the quota is out.
 * Run: npm run demo:add -- path/to/bundle.json
 * The file may be an AnalysisBundle ({ report, extras }) or a bare EssayReport. It is validated with the same schemas
 * the app uses, written to public/demo-reports/<id>.json, and listed in public/demo-reports/index.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseAnalyzeResponse } from "../lib/client/response.ts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run demo:add -- path/to/bundle.json");
  process.exit(1);
}

let json: unknown;
try {
  json = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error(`Could not read ${file}: ${(e as Error).message}`);
  process.exit(1);
}

const parsed = parseAnalyzeResponse(json);
if (!parsed.ok) {
  console.error(`Not a valid analysis: ${parsed.message}${parsed.detail ? ` (${parsed.detail})` : ""}`);
  process.exit(1);
}

const { bundle } = parsed;
const id = bundle.report.id.replace(/[^\w-]/g, "-").slice(0, 80);
if (id === "example") {
  console.error('The id "example" is reserved for the built-in sample. Give the report another id.');
  process.exit(1);
}
const outId = { ...bundle, report: { ...bundle.report, id } };

const dir = path.join(process.cwd(), "public", "demo-reports");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(outId));

const indexFile = path.join(dir, "index.json");
let index: { id: string; title: string }[] = [];
try {
  if (existsSync(indexFile)) {
    const j: unknown = JSON.parse(readFileSync(indexFile, "utf8"));
    if (Array.isArray(j)) index = j.filter((x) => typeof x?.id === "string");
  }
} catch {
  /* a corrupt index is rebuilt */
}
index = [...index.filter((x) => x.id !== id), { id, title: bundle.report.topic.slice(0, 120) }];
writeFileSync(indexFile, JSON.stringify(index, null, 2));

console.log(`Added demo report "${id}" (${Object.keys(bundle.extras ?? {}).length} extras sections).`);
console.log(`  file: public/demo-reports/${id}.json`);
console.log(`  URL:  /report/${id}`);
console.log(`  The /new page lists it as a sample link.`);
