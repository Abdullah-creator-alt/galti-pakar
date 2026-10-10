/**
 * Pipeline step contracts. Each step is a pure async function with typed input
 * and output so it can be tested alone. Bodies are not implemented yet.
 */
import type { ExaminerResult, Fix, Paragraph, Rewrite, DimensionScore } from "../types.ts";
import { GeminiError, generateText, type GenerateOptions, type InlineImage } from "../gemini.ts";
import { GEMINI_VISION_FALLBACKS, GEMINI_VISION_MODEL } from "../config.ts";
import { buildPrompt, describeParseError, parseModelOutput, postProcess, TRANSCRIBE_SYSTEM } from "./transcribe.ts";
import { rawTranscriptionResponseSchema, type TranscribedEssay } from "./transcribe.types.ts";
import { ApiError } from "./validate.ts";

export class NotImplementedError extends Error {
  constructor(step: string) {
    super(`Pipeline step "${step}" is not implemented yet.`);
  }
}

export interface PageImage extends InlineImage {
  pageNumber: number;
}

/** Step 1: handwriting to text. One vision call with every page, in order. */
export type GenerateFn = (opts: GenerateOptions) => Promise<string>;
export const READ_TIMEOUT_MS = 40_000;
const PER_MODEL_TIMEOUT_MS = 20_000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function readHandwriting(
  pages: PageImage[],
  topic: string,
  deps: { generate?: GenerateFn; timeoutMs?: number } = {},
): Promise<TranscribedEssay> {
  const generate = deps.generate ?? generateText;
  const deadline = Date.now() + (deps.timeoutMs ?? READ_TIMEOUT_MS);
  const models = [GEMINI_VISION_MODEL, ...GEMINI_VISION_FALLBACKS];
  let modelIdx = 0;
  let parseFailures = 0;
  let lastError = "";
  let lastStatus: number | undefined;

  while (modelIdx < models.length && parseFailures < 2) {
    const remaining = deadline - Date.now();
    if (remaining < 2000) break;
    let text: string;
    try {
      text = await generate({
        model: models[modelIdx],
        system: TRANSCRIBE_SYSTEM,
        prompt: buildPrompt(topic, pages.length, parseFailures ? lastError : undefined),
        images: pages.map((p) => ({ mimeType: p.mimeType, data: p.data })),
        temperature: 0,
        maxOutputTokens: 16384,
        responseSchema: rawTranscriptionResponseSchema,
        // Leave room for a fallback model if this one is slow or overloaded.
        timeoutMs: modelIdx < models.length - 1 ? Math.min(remaining, PER_MODEL_TIMEOUT_MS) : remaining,
      });
    } catch (e) {
      lastStatus = e instanceof GeminiError ? e.status : undefined;
      console.error("readHandwriting: Gemini call failed", models[modelIdx], lastStatus ?? "", (e as Error).message.slice(0, 200));
      if (lastStatus !== undefined && RETRYABLE.has(lastStatus)) {
        modelIdx++; // overloaded or slow: try the next model
        continue;
      }
      throw new ApiError(502, "We could not read your photos just now. Please try again in a moment.");
    }
    try {
      return postProcess(parseModelOutput(text), pages.length);
    } catch (e) {
      if (e instanceof ApiError) throw e; // unreadable essay: a retry will not help
      parseFailures++;
      lastError = describeParseError(e);
    }
  }
  if (parseFailures >= 2) {
    console.error("readHandwriting: invalid model output", lastError);
    throw new ApiError(502, "We could not make sense of the handwriting reading. Please try again, or retake the photos in better light.");
  }
  throw new ApiError(lastStatus === 504 ? 504 : 503, "Our reader is very busy right now. Your photos are fine; please try again in a minute.");
}

/** Step 2: split into paragraphs and label each paragraph's role. */
export type StructuredParagraph = Pick<Paragraph, "id" | "text" | "role" | "summary">;
export async function labelStructure(_topic: string, _text: string): Promise<StructuredParagraph[]> {
  throw new NotImplementedError("labelStructure");
}

/** Step 3: drift and genericness. Implemented in analyse.ts; re-exported here. */
export { analyseGenericnessAndDrift, toSpans } from "./analyse.ts";
export type { EssayAnalysis, ParagraphAnalysis, SentenceResult } from "./analyse.ts";

/** Step 4: several independent examiner runs scoring the seven rubric dimensions. */
export interface ExaminerOutput {
  examiner: ExaminerResult;
  dimensions: DimensionScore[];
}
export async function scoreExaminers(_topic: string, _paragraphs: StructuredParagraph[], _count: number): Promise<ExaminerOutput[]> {
  throw new NotImplementedError("scoreExaminers");
}

/** Step 5: fixes and a rewrite of the weakest paragraph. Depends on steps 2-4. */
export async function suggestFixes(
  _topic: string,
  _paragraphs: Paragraph[],
  _dimensions: DimensionScore[],
): Promise<{ fixes: Fix[]; rewrite: Rewrite }> {
  throw new NotImplementedError("suggestFixes");
}
