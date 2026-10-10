/**
 * Builds the bundle fixtures used by the browser tests, into tests/fixtures/bundles/. The originals are never edited:
 *   - the example bundle (lib/mock-extras.ts): full extras, synthetic
 *   - tests/fixtures/real/live-run-degraded.json: a saved REAL response from the live backend (typed-text pages, so no
 *     student essay or photo), produced while the embedding quota was exhausted
 * Every variant is validated with the same zod schemas the app uses. One is intentionally invalid.
 * Run: node --no-warnings scripts/make-test-bundles.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mockBundle, mockExtras } from "../lib/mock-extras.ts";
import { parseBundle, type AnalysisBundle, type ReportExtras } from "../lib/types.extras.ts";

const out = path.join(process.cwd(), "tests", "fixtures", "bundles");
mkdirSync(out, { recursive: true });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const base = (id: string): AnalysisBundle => {
  const b = clone(mockBundle);
  b.report.id = id;
  b.report.isExample = false;
  return b;
};

interface Entry { name: string; valid: boolean; note: string; bundle: unknown }
const entries: Entry[] = [];
const add = (name: string, note: string, bundle: unknown, valid = true) => entries.push({ name, valid, note, bundle });

add("full", "All extras present (synthetic example data)", base("fx-full"));

{ const b = base("fx-no-extras"); delete b.extras; add("no-extras", "Report only, no extras", b); }
{ const b = base("fx-empty-trace"); b.extras = { ...b.extras, trace: {} }; add("empty-trace", "extras.trace is an empty object", b); }
{ const b = base("fx-no-examiners"); b.report.examiners = []; b.extras = { ...b.extras, conflicts: [], verification: { spansProposed: 16, spansDropped: 0, quotesProposed: 0, quotesVerified: 0, quotesRejected: 0, conflictsFound: 0 } }; add("no-examiners", "examiners: [] (measured-only scores)", b); }
{ const b = base("fx-rewrite-identical"); b.report.rewrite = { ...b.report.rewrite, improved: b.report.rewrite.original, removed: [], added: [] }; if (b.extras) delete b.extras.rewriteExtras; add("rewrite-identical", "rewrite.original equals rewrite.improved", b); }
{
  const b = base("fx-poor-legibility");
  const p2 = b.report.paragraphs.find((p) => p.id === "p2")!;
  const words = ["Punjab", "monsoon", "glacier-fed"].filter((w) => p2.text.includes(w));
  b.extras = { ...b.extras, transcription: { legibility: "poor", uncertain: [...words.map((w) => ({ paragraphId: "p2", word: w, guess: w.toLowerCase() })), { paragraphId: "p3", word: "submerged", guess: "submerged" }] } };
  add("poor-legibility", "legibility poor with uncertain words that exist in the text", b);
}
{ const b = base("fx-benchmark-unavailable"); b.extras = { ...b.extras, benchmark: { status: "unavailable", disclaimers: [] } }; add("benchmark-unavailable", "benchmark.status unavailable", b); }
{ const b = base("fx-benchmark-ok"); add("benchmark-ok", "benchmark.status ok with coverage and profile", b); }
{
  const b = base("fx-long-warnings");
  const long = "This is a deliberately long warning sentence used to test wrapping and the collapsed notes list on a narrow phone screen, including a_long_unbroken_token_" + "x".repeat(70);
  b.extras = { ...b.extras, warnings: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `Note ${i} (an analysis stage was unavailable): ${long}`) };
  add("long-warnings", "8 long warnings, including an unbroken token", b);
}
{
  const b = base("fx-link-out-of-range");
  const trace = b.extras!.trace as Record<string, { linked?: { paragraphId: string; start: number; end: number } }>;
  const key = Object.keys(trace).find((k) => trace[k].linked)!;
  trace[key].linked = { paragraphId: "p3", start: 10, end: 99999 };
  b.extras!.claimMap!.links.push({ id: "l-bad", kind: "claim", claim: { paragraphId: "p2", start: 0, end: 5000 }, strength: "orphan" });
  add("link-out-of-range", "a trace link and an argument-map row point outside their paragraph", b);
}
{
  // A 3,000-word essay: 12 paragraphs of ten 25-word sentences, with a highlight on every third sentence.
  const b = base("fx-very-long");
  const words = "water river climate farm policy province budget flood energy school health market drought export tax grain canal village harvest rainfall reform dam".split(" ");
  const sentence = (p: number, s: number) => Array.from({ length: 25 }, (_, i) => words[(p * 7 + s * 3 + i * 5) % words.length]).join(" ").replace(/^./, (c) => c.toUpperCase()) + ".";
  b.report.paragraphs = Array.from({ length: 12 }, (_, p) => {
    const sents = Array.from({ length: 10 }, (_, s) => sentence(p, s));
    let text = "";
    const spans = sents.flatMap((t, s) => {
      const start = text.length ? text.length + 1 : 0;
      text = text ? `${text} ${t}` : t;
      if (s % 3 !== 0) return [];
      const tone = (["strong", "weak", "offtopic"] as const)[(p + s) % 3];
      return [{ start, end: start + t.length, tone, reason: `Sample reason ${p + 1}.${s + 1} for a long essay test.` }];
    });
    return { id: `p${p + 1}`, text, role: (["position", "claim", "evidence", "counter-argument", "claim", "evidence"] as const)[p % 6], relevance: 40 + ((p * 17) % 60), summary: `Paragraph ${p + 1} summary`, spans };
  });
  b.report.wordCount = 3000;
  b.report.rewrite = { paragraphId: "p3", original: b.report.paragraphs[2].text, improved: `${b.report.paragraphs[2].text} [add a verified figure]`, removed: [], added: [" [add a verified figure]"] };
  b.report.fixes = b.report.fixes.map((f) => ({ ...f, paragraphId: "p3" }));
  delete b.extras;
  add("very-long", "3,000 words, 12 paragraphs, 48 highlights", b);
}
{
  const b = base("fx-invalid-report");
  b.report.paragraphs[0].spans[0].end = 99999;
  add("invalid-report", "INTENTIONALLY INVALID: a span runs past its paragraph, so the report schema rejects it", b, false);
}

// The saved real response from the live backend, with and without its debug field.
const live = JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", "real", "live-run-degraded.json"), "utf8"));
add("real-degraded", "REAL backend response (embeddings quota exhausted: no drift, genericness, benchmark or claim map)", { report: live.report, extras: live.extras });
add("real-degraded-debug", "The same real response including the debug field", live);

const manifest: { name: string; valid: boolean; note: string }[] = [];
for (const e of entries) {
  const r = parseBundle(e.bundle && typeof e.bundle === "object" && "report" in (e.bundle as object) ? { report: (e.bundle as AnalysisBundle).report, extras: (e.bundle as AnalysisBundle).extras } : e.bundle);
  const ok = r.ok;
  if (ok !== e.valid) {
    console.error(`UNEXPECTED: ${e.name} validity is ${ok} but ${e.valid} was intended${r.ok ? "" : ` (${r.error})`}`);
    process.exitCode = 1;
  }
  writeFileSync(path.join(out, `${e.name}.json`), JSON.stringify(e.bundle));
  manifest.push({ name: e.name, valid: e.valid, note: e.note });
  console.log(`${ok ? "valid  " : "INVALID"} ${e.name.padEnd(24)} ${e.note}`);
}
writeFileSync(path.join(out, "index.json"), JSON.stringify(manifest, null, 2));
void (mockExtras as ReportExtras);
