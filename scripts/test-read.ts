/**
 * Try handwriting transcription on real photos.
 * Run: npm run test:read -- path/to/page1.jpg path/to/page2.jpg
 * Optional: TOPIC="Your topic" npm run test:read -- page1.jpg
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { prepareImages } from "../lib/pipeline/prepareImages.ts";
import { readHandwriting } from "../lib/pipeline/steps.ts";
import { ApiError } from "../lib/pipeline/validate.ts";

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: npm run test:read -- page1.jpg [page2.jpg ...]");
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set. Copy .env.example to .env.local and add your key.");
    process.exit(1);
  }
  const topic = process.env.TOPIC ?? "Not specified";

  const t0 = Date.now();
  const images = await Promise.all(files.map(async (f) => ({ data: await readFile(f), name: basename(f) })));
  const pages = await prepareImages(images);
  const t1 = Date.now();
  console.log(`Prepared ${pages.length} page(s) in ${t1 - t0} ms (${Math.round(pages.reduce((n, p) => n + p.data.length, 0) / 1024)} KB base64)`);

  const essay = await readHandwriting(pages, topic);
  const t2 = Date.now();

  console.log(`Gemini read in ${((t2 - t1) / 1000).toFixed(1)} s (total ${((t2 - t0) / 1000).toFixed(1)} s)`);
  console.log(`Legibility: ${essay.legibility}`);
  console.log(`Word count: ${essay.wordCount}`);
  console.log(`\nOutline (${essay.outline.length}):`);
  essay.outline.forEach((l) => console.log(`  - ${l}`));
  console.log(`\nParagraphs (${essay.paragraphs.length}):`);
  for (const p of essay.paragraphs) console.log(`\n[${p.id} · ${p.kind} · page ${p.pageIndex + 1}]\n${p.text}`);
  console.log(`\nUncertain words (${essay.uncertain.length}):`);
  essay.uncertain.forEach((u) => console.log(`  ${u.paragraphId}: "${u.word}" -> guess "${u.guess}"`));
  console.log(`\nWarnings (${essay.warnings.length}):`);
  essay.warnings.forEach((w) => console.log(`  - ${w}`));
}

main().catch((e) => {
  console.error(e instanceof ApiError ? `Error ${e.status}: ${e.message}` : e);
  process.exit(1);
});
