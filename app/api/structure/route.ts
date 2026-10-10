import { NextResponse } from "next/server";
import { analyzeEssayStructure, type StructureFailureCode } from "@/lib/structure";
import { embedTexts } from "@/lib/pipeline/embed";

export const runtime = "nodejs";
export const maxDuration = 60;

const STATUS: Record<StructureFailureCode, number> = {
  invalid_input: 400,
  empty_input: 400,
  input_too_large: 413,
  provider_error: 502,
  model_output_invalid: 502,
  integrity_error: 500,
};

/**
 * Thin HTTP wrapper around the structure-analysis module. Body: { text, topic?, useSemanticSimilarity? }.
 * A CSS profile is deliberately not accepted from the client: a verified profile is server-side configuration.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_input", message: "Send a JSON body with a text field." } }, { status: 400 });
  }
  const { text, topic, useSemanticSimilarity } = (body ?? {}) as Record<string, unknown>;
  try {
    const outcome = await analyzeEssayStructure(
      { text: text as string, topic: typeof topic === "string" ? topic : undefined, useSemanticSimilarity: useSemanticSimilarity === true },
      { embed: (texts) => embedTexts(texts) },
    );
    if (outcome.ok) return NextResponse.json(outcome.result);
    return NextResponse.json({ error: outcome.error }, { status: STATUS[outcome.error.code] });
  } catch (e) {
    console.error("structure analysis failed", e);
    return NextResponse.json({ error: { code: "integrity_error", message: "Something went wrong while analysing the essay structure." } }, { status: 500 });
  }
}
