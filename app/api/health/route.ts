import { NextResponse } from "next/server";
import { GEMINI_EMBEDDING_MODEL, GEMINI_EXAMINER_MODEL, GEMINI_COACH_MODEL, GEMINI_VISION_MODEL, GEMINI_STRUCTURE_MODELS } from "@/lib/config";
import { REQUIRED_ASSETS, assetStatus } from "@/lib/pipeline/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Is this deployment able to analyse an essay? Reports presence only: no keys, no file contents. */
export async function GET() {
  const assets = assetStatus();
  const geminiKeyPresent = Boolean(process.env.GEMINI_API_KEY);
  const ok = geminiKeyPresent && REQUIRED_ASSETS.every((k) => assets[k]);
  return NextResponse.json(
    {
      ok,
      geminiKeyPresent,
      assets,
      // The structure step labels sentences with an LLM plus rules; there is no trained structure classifier.
      structure: { method: "llm-labels-plus-rules", trainedClassifier: false },
      models: { vision: GEMINI_VISION_MODEL, examiner: GEMINI_EXAMINER_MODEL, coach: GEMINI_COACH_MODEL, embedding: GEMINI_EMBEDDING_MODEL, structure: GEMINI_STRUCTURE_MODELS[0] },
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
