/**
 * Phase 3 Runner: Evaluates Gemini Structure Extractor on a batch of PERSUADE validation essays
 * with persistent file caching to respect quota, outputting per-essay sentence extractions.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { normalizeEssay } from "../../../lib/structure/normalize.ts";
import { analyzeEssayStructure } from "../../../lib/structure/analyze.ts";
import { EXTRACTION_PROMPT_VERSION } from "../../../lib/structure/prompt.ts";

const VAL_JSONL = path.resolve(process.env.HOME || "~", "galti-pakar-data/persuade/prepared/val.jsonl");
const CACHE_DIR = path.resolve("training/persuade/artifacts/gemini_cache");

fs.mkdirSync(CACHE_DIR, { recursive: true });

function getEssayHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function runGeminiEval(limit = 10) {
  if (!fs.existsSync(VAL_JSONL)) {
    console.error(`Error: Validation file not found at ${VAL_JSONL}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(VAL_JSONL, "utf-8").split("\n").filter(Boolean);
  console.log(`=== Phase 3: Gemini Evaluation Cache Runner ===`);
  console.log(`Processing up to ${limit} validation essays...`);

  let processed = 0;
  for (const line of lines) {
    if (processed >= limit) break;
    const item = JSON.parse(line);
    const { essay_id, text, prompt_name } = item;
    const cacheFile = path.join(CACHE_DIR, `${essay_id}.json`);

    if (fs.existsSync(cacheFile)) {
      console.log(`[Cache Hit] Essay ${essay_id}`);
      processed++;
      continue;
    }

    console.log(`[Cache Miss] Calling Gemini for Essay ${essay_id} (${text.length} chars)...`);
    const normalized = normalizeEssay(text);
    const started = Date.now();
    
    try {
      const res = await analyzeEssayStructure({ text });
      const latencyMs = Date.now() - started;

      if (!res.ok) {
        console.warn(`Extraction failed for ${essay_id}: ${res.error.message}`);
        fs.writeFileSync(cacheFile, JSON.stringify({
          essay_id,
          prompt_name,
          hash: getEssayHash(text),
          ok: false,
          error: res.error.message,
          latencyMs
        }, null, 2));
      } else {
        // Collect sentence-level roles
        const sentenceRoles: Record<string, string> = {};
        for (const el of res.result.argumentElements) {
          for (const sId of el.sentenceIds) {
            sentenceRoles[sId] = el.role;
          }
        }

        const cacheData = {
          essay_id,
          prompt_name,
          hash: getEssayHash(text),
          ok: true,
          model: res.result.analysisMetadata.extractor.name,
          promptVersion: EXTRACTION_PROMPT_VERSION,
          latencyMs,
          attempts: res.result.analysisMetadata.extractor.attempts,
          elements: res.result.argumentElements,
          sentenceRoles,
          sentences: normalized.sentences.map(s => ({
            id: s.id,
            start: s.start,
            end: s.end,
            text: s.text
          }))
        };

        fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
        console.log(`[OK] Saved ${essay_id} in ${latencyMs}ms (${res.result.argumentElements.length} elements)`);
      }
    } catch (err: any) {
      console.error(`Unexpected failure on ${essay_id}: ${err.message}`);
    }

    processed++;
    // Small delay to respect rate limits
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`Finished processing ${processed} essays into ${CACHE_DIR}`);
}

const limitArg = process.argv.find(a => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 5;
await runGeminiEval(limit);
