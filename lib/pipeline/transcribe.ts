import { ZodError } from "zod";
import { countWords } from "../derive.ts";
import { rawTranscriptionSchema, transcribedEssaySchema, type RawTranscription, type TranscribedEssay } from "./transcribe.types.ts";
import { ApiError } from "./validate.ts";

export const UNREADABLE_MESSAGE = "We couldn't read an essay from these photos. Try a brighter, flatter photo.";

export const TRANSCRIBE_SYSTEM = `You transcribe handwritten English exam essays from photos. Transcribe EXACTLY what is written. Do NOT correct spelling, grammar or punctuation, do NOT improve wording, do NOT add or remove words. Preserve the candidate's errors, because the essay will be graded on its language.
Pages are given in order. Join text that continues across pages.
Many candidates write an outline first (numbered or bulleted headings). Put those lines in "outline", not in "paragraphs".
Split the essay into paragraphs as the candidate did (new line or indentation).
Label each paragraph kind: intro (first), conclusion (last), otherwise body.
Ignore page numbers, headers, margin notes and crossed-out text.
If a word is hard to read, write your best guess in the text and add it to "uncertain" with your guess (paragraphNumber is the 1-based position of the paragraph in your list). If a word is unreadable, write [illegible].
Rate overall legibility: good, fair or poor. Do not judge the essay's quality.
If the images are not a handwritten essay, return empty paragraphs and add a warning explaining what you see.
For each paragraph give pageIndex: the 0-based index of the page where that paragraph starts.
Return only JSON matching the schema.`;

export function buildPrompt(topic: string, pageCount: number, previousError?: string): string {
  let p = `Transcribe the ${pageCount} page${pageCount === 1 ? "" : "s"} of this handwritten essay, in the order given.\nThe topic is "${topic}". It is provided only for context while reading ambiguous words. Do not invent content to fit the topic.`;
  if (previousError) p += `\n\nYour previous reply was invalid: ${previousError}\nReturn corrected JSON only.`;
  return p;
}

/** Strips code fences and surrounding prose, then parses and validates. Throws ZodError or SyntaxError. */
export function parseModelOutput(text: string): RawTranscription {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
  }
  return rawTranscriptionSchema.parse(JSON.parse(t));
}

export function describeParseError(e: unknown): string {
  if (e instanceof ZodError) return e.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  return (e as Error).message;
}

/** Code-side clean-up: ids, word count, hallucination guard. Throws a user-readable ApiError if no essay was found. */
export function postProcess(raw: RawTranscription, pageCount: number): TranscribedEssay {
  const warnings = [...raw.warnings];
  // Map the model's 1-based paragraph numbers to the ids assigned after dropping empties.
  const idByModelNumber = new Map<number, string>();
  const paragraphs: TranscribedEssay["paragraphs"] = [];
  raw.paragraphs.forEach((p, i) => {
    const text = p.text.trim();
    if (!text) return;
    const id = `p${paragraphs.length + 1}`;
    idByModelNumber.set(i + 1, id);
    paragraphs.push({ id, kind: p.kind, text, pageIndex: Math.min(p.pageIndex, Math.max(pageCount - 1, 0)) });
  });

  if (paragraphs.length === 0) {
    const why = warnings.length ? ` (${warnings.join(" ")})` : "";
    throw new ApiError(422, `${UNREADABLE_MESSAGE}${why}`);
  }

  const uncertain: TranscribedEssay["uncertain"] = [];
  for (const u of raw.uncertain) {
    const paragraphId = idByModelNumber.get(u.paragraphNumber);
    const para = paragraphs.find((p) => p.id === paragraphId);
    if (!para) continue;
    if (!para.text.toLowerCase().includes(u.word.trim().toLowerCase())) continue; // hallucination guard
    uncertain.push({ paragraphId: para.id, word: u.word.trim(), guess: u.guess });
  }

  return transcribedEssaySchema.parse({
    outline: raw.outline.map((l) => l.trim()).filter(Boolean),
    paragraphs,
    uncertain,
    legibility: raw.legibility,
    wordCount: paragraphs.reduce((n, p) => n + countWords(p.text), 0),
    warnings,
  });
}
