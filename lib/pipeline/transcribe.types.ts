import { z } from "zod";

/** Internal to the pipeline. Not part of the UI contract. */

export const paragraphKindSchema = z.enum(["intro", "body", "conclusion"]);
export const legibilitySchema = z.enum(["good", "fair", "poor"]);

/** What the model returns. Ids and word count are NOT asked of the model. */
export const rawTranscriptionSchema = z.object({
  outline: z.array(z.string()),
  paragraphs: z.array(
    z.object({
      kind: paragraphKindSchema,
      text: z.string(),
      pageIndex: z.number().int().min(0),
    }),
  ),
  uncertain: z.array(
    z.object({
      /** 1-based position in the model's paragraph list. Mapped to an id in code. */
      paragraphNumber: z.number().int().min(1),
      word: z.string().min(1),
      guess: z.string(),
    }),
  ),
  legibility: legibilitySchema,
  warnings: z.array(z.string()),
});
export type RawTranscription = z.infer<typeof rawTranscriptionSchema>;

export const transcribedEssaySchema = z.object({
  outline: z.array(z.string()),
  paragraphs: z.array(
    z.object({
      id: z.string().regex(/^p\d+$/),
      kind: paragraphKindSchema,
      text: z.string().min(1),
      pageIndex: z.number().int().min(0),
    }),
  ),
  uncertain: z.array(z.object({ paragraphId: z.string(), word: z.string(), guess: z.string() })),
  legibility: legibilitySchema,
  wordCount: z.number().int().min(0),
  warnings: z.array(z.string()),
});
export type TranscribedEssay = z.infer<typeof transcribedEssaySchema>;

/** Gemini responseSchema (OpenAPI subset) mirroring rawTranscriptionSchema. */
export const rawTranscriptionResponseSchema = {
  type: "OBJECT",
  properties: {
    outline: { type: "ARRAY", items: { type: "STRING" } },
    paragraphs: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: ["intro", "body", "conclusion"] },
          text: { type: "STRING" },
          pageIndex: { type: "INTEGER" },
        },
        required: ["kind", "text", "pageIndex"],
      },
    },
    uncertain: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { paragraphNumber: { type: "INTEGER" }, word: { type: "STRING" }, guess: { type: "STRING" } },
        required: ["paragraphNumber", "word", "guess"],
      },
    },
    legibility: { type: "STRING", enum: ["good", "fair", "poor"] },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["outline", "paragraphs", "uncertain", "legibility", "warnings"],
} as const;
