/** Default provider wiring: reuses the project's existing Gemini client. The only file here that imports it. */
import { GEMINI_TEXT_MODEL } from "../config.ts";
import { generateText } from "../gemini.ts";
import type { CompleteFn } from "./extract.ts";

export const DEFAULT_EXTRACTOR_NAME = GEMINI_TEXT_MODEL;

export const geminiComplete: CompleteFn = (req) =>
  generateText({
    model: GEMINI_TEXT_MODEL,
    system: req.system,
    prompt: req.prompt,
    responseSchema: req.responseSchema,
    temperature: 0,
    maxOutputTokens: 8192,
    thinkingBudget: 0,
    timeoutMs: req.timeoutMs,
  });
