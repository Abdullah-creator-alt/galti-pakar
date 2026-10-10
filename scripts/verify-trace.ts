/**
 * After `next build`, proves the pipeline's runtime data is bundled into the serverless output, and that the API routes
 * do not drag the whole data/ folder along. Fails loudly (exit 1) otherwise.
 * Run: npm run build && npm run verify:bundle
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const server = path.join(root, ".next", "server");
if (!existsSync(server)) {
  console.error("FAIL: .next/server not found. Run npm run build first.");
  process.exit(1);
}

/** A string from each data file that is safe to look for in bundled JavaScript (no quotes or backslashes). */
const clean = (s: string) => !/['"\\]/.test(s) && s.length > 25;
const json = (f: string) => JSON.parse(readFileSync(path.join(root, "data", f), "utf8"));
const markers: Record<string, string> = {
  "topics.embedded.json": json("topics.embedded.json").topics.map((t: { text: string }) => t.text).find(clean),
  "generic-bank.embedded.json": json("generic-bank.embedded.json").items.map((t: { text: string }) => t.text).find(clean),
  "genericness-model.json": String(json("genericness-model.json").bias).slice(0, 9),
  "benchmark.json": json("benchmark.json").themes.flatMap((t: { points: { point: string }[] }) => t.points.map((p) => p.point)).find(clean),
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

let bad = 0;
const routeDirs = [path.join(server, "app", "api", "analyze"), path.join(server, "app", "api", "health")];
const chunkDir = path.join(server, "chunks");
const files = [...routeDirs.flatMap((d) => (existsSync(d) ? walk(d) : [])), ...(existsSync(chunkDir) ? walk(chunkDir) : [])];
const bundle = files.map((f) => readFileSync(f, "utf8")).join("\n");
for (const [file, marker] of Object.entries(markers)) {
  if (bundle.includes(marker)) console.log(`ok   data/${file} is inside the server bundle`);
  else {
    bad++;
    console.error(`FAIL data/${file} was not found in the server bundle (looked for: ${marker.slice(0, 40)}...)`);
  }
}

for (const route of ["analyze", "health"]) {
  const nft = path.join(server, "app", "api", route, "route.js.nft.json");
  if (!existsSync(nft)) continue;
  const dir = path.dirname(nft);
  const traced: string[] = (JSON.parse(readFileSync(nft, "utf8")) as { files: string[] }).files.map((f) => path.relative(root, path.resolve(dir, f)).split(path.sep).join("/"));
  const unwanted = traced.filter((f) => /^data\/(cache|reference-raw|fixtures)\//.test(f) || f === "data/sentences.embedded.json");
  const mb = traced.reduce((n, f) => n + (existsSync(path.join(root, f)) ? statSync(path.join(root, f)).size : 0), 0) / 1024 / 1024;
  if (unwanted.length) {
    bad++;
    console.error(`FAIL ${route}: the trace includes build-only data (${unwanted.slice(0, 3).join(", ")}...)`);
  } else console.log(`ok   ${route}: ${traced.length} traced files, about ${mb.toFixed(0)} MB, no caches or training data`);
}
process.exit(bad ? 1 : 0);
