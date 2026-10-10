/**
 * Stage B: turn the model's JSON into validated argument elements. The model only ever sees and returns
 * sentence ids, so it cannot rewrite the essay. Bad elements are rejected one by one with a reason; a
 * response that is not usable as a whole becomes a typed failure. Nothing here calls a provider directly:
 * the caller injects a `CompleteFn`, which keeps this testable with canned responses.
 */
import { z } from "zod";
import { EXTRACTION_MAX_ATTEMPTS, EXTRACTION_TIMEOUT_MS } from "./config.ts";
import { buildExtractionPrompt, EXTRACTION_RESPONSE_SCHEMA, EXTRACTION_SYSTEM } from "./prompt.ts";
import type { NormalizedEssay } from "./normalize.ts";
import { ARGUMENT_ROLES, type ArgumentRole, type RejectedElement, type StructureFailure } from "./types.ts";

export interface CompletionRequest {
  system: string;
  prompt: string;
  responseSchema: unknown;
  timeoutMs: number;
}
/** Returns the raw model text. Throw to signal a provider failure; set `status` for HTTP-like errors. */
export type CompleteFn = (req: CompletionRequest) => Promise<string>;

export interface ExtractedElement {
  sentenceIds: string[];
  role: ArgumentRole;
  modelConfidence: number;
  alternativeRole?: ArgumentRole;
}

export type ExtractionOutcome =
  | { ok: true; elements: ExtractedElement[]; rejected: RejectedElement[]; attempts: number }
  | { ok: false; error: StructureFailure };

const envelopeSchema = z.object({ elements: z.array(z.unknown()) });
const rawElementSchema = z.object({
  sentenceIds: z.array(z.string()).min(1),
  role: z.string(),
  confidence: z.number().finite(),
  alternativeRole: z.string().optional(),
});

const isRole = (v: string): v is ArgumentRole => (ARGUMENT_ROLES as readonly string[]).includes(v);

/** Pulls the JSON object out of the model text, tolerating code fences and surrounding prose. */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
    throw new Error("response is not JSON");
  }
}

/** Validates the model's elements against the real sentences. Pure and deterministic. */
export function validateRawElements(raw: unknown[], essay: NormalizedEssay): { elements: ExtractedElement[]; rejected: RejectedElement[] } {
  const sentenceById = new Map(essay.sentences.map((s) => [s.id, s]));
  const accepted: { el: ExtractedElement; first: number }[] = [];
  const rejected: RejectedElement[] = [];
  const reject = (index: number, code: string, message: string) => rejected.push({ index, code, message });

  raw.forEach((item, index) => {
    const parsed = rawElementSchema.safeParse(item);
    if (!parsed.success) return reject(index, "malformed_element", "Element is missing sentenceIds, role or confidence.");
    const { sentenceIds, role, confidence, alternativeRole } = parsed.data;
    if (!isRole(role)) return reject(index, "invalid_role", `Unsupported role "${role}".`);
    if (alternativeRole !== undefined && !isRole(alternativeRole)) return reject(index, "invalid_role", `Unsupported alternativeRole "${alternativeRole}".`);
    if (confidence < 0 || confidence > 1) return reject(index, "invalid_confidence", `Confidence ${confidence} is outside 0-1.`);
    if (new Set(sentenceIds).size !== sentenceIds.length) return reject(index, "duplicate_sentence_ids", "Element repeats a sentence id.");
    const unknown = sentenceIds.filter((id) => !sentenceById.has(id));
    if (unknown.length) return reject(index, "unknown_sentence_id", `Unknown sentence id(s): ${unknown.join(", ")}.`);

    const nodes = sentenceIds.map((id) => sentenceById.get(id)!);
    if (new Set(nodes.map((n) => n.paragraphId)).size > 1) return reject(index, "cross_paragraph_span", "Element spans more than one paragraph.");
    const contiguous = nodes.every((n, i) => i === 0 || n.index === nodes[i - 1].index + 1);
    if (!contiguous) return reject(index, "non_contiguous_span", "Element sentences are not adjacent and in order.");

    accepted.push({
      el: { sentenceIds, role, modelConfidence: confidence, ...(alternativeRole && alternativeRole !== role ? { alternativeRole } : {}) },
      first: nodes[0].index,
    });
  });

  // A sentence belongs to at most one element: keep the earlier span, then the more confident one.
  const order = accepted.map((a, i) => ({ ...a, i })).sort((a, b) => a.first - b.first || b.el.modelConfidence - a.el.modelConfidence || a.i - b.i);
  const used = new Set<string>();
  const kept: typeof order = [];
  for (const a of order) {
    if (a.el.sentenceIds.some((id) => used.has(id))) {
      reject(a.i, "overlapping_element", "Element reuses a sentence already assigned to another element.");
      continue;
    }
    a.el.sentenceIds.forEach((id) => used.add(id));
    kept.push(a);
  }
  return { elements: kept.map((k) => k.el), rejected: rejected.sort((a, b) => a.index - b.index) };
}

function providerFailure(e: unknown): StructureFailure {
  const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : undefined;
  const retryable = status === undefined || status === 429 || status >= 500;
  return { code: "provider_error", message: "The language model could not be reached or refused the request.", retryable, details: [String((e as Error)?.message ?? e).slice(0, 300)] };
}

export async function extractElements(
  essay: NormalizedEssay,
  topic: string | undefined,
  complete: CompleteFn,
  opts: { maxAttempts?: number; timeoutMs?: number } = {},
): Promise<ExtractionOutcome> {
  const maxAttempts = opts.maxAttempts ?? EXTRACTION_MAX_ATTEMPTS;
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let text: string;
    try {
      text = await complete({
        system: EXTRACTION_SYSTEM,
        prompt: buildExtractionPrompt(essay, topic, attempt > 1 ? lastError : undefined),
        responseSchema: EXTRACTION_RESPONSE_SCHEMA,
        timeoutMs: opts.timeoutMs ?? EXTRACTION_TIMEOUT_MS,
      });
    } catch (e) {
      return { ok: false, error: providerFailure(e) };
    }
    let envelope: z.infer<typeof envelopeSchema>;
    try {
      const parsed = envelopeSchema.safeParse(parseModelJson(text));
      if (!parsed.success) throw new Error('response has no "elements" array');
      envelope = parsed.data;
    } catch (e) {
      lastError = (e as Error).message;
      continue;
    }
    const { elements, rejected } = validateRawElements(envelope.elements, essay);
    if (envelope.elements.length > 0 && elements.length === 0) {
      lastError = `none of the ${envelope.elements.length} elements were usable (${[...new Set(rejected.map((r) => r.code))].join(", ")})`;
      continue;
    }
    return { ok: true, elements, rejected, attempts: attempt };
  }
  return {
    ok: false,
    error: { code: "model_output_invalid", message: "The language model did not return a usable structure analysis.", retryable: true, details: [lastError] },
  };
}
