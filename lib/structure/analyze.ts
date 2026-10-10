/**
 * Public entry point of the structure-analysis module. Orchestrates the stages and owns no I/O of its own:
 * the model call and the optional embedding call are injected, and nothing here knows about HTTP.
 */
import { MAX_SEMANTIC_TEXTS, STRUCTURE_LIMITS, STRUCTURE_SCHEMA_VERSION } from "./config.ts";
import { diagnose } from "./diagnose.ts";
import { extractElements, type CompleteFn } from "./extract.ts";
import { buildLinks } from "./link.ts";
import { hasLetterOrDigit, normalizeEssay } from "./normalize.ts";
import { applyProfile, resolveProfile } from "./profile.ts";
import { DEFAULT_EXTRACTOR_NAME, geminiComplete } from "./provider.ts";
import { structureInputSchema } from "./schema.ts";
import { cosine } from "../pipeline/vecmath.ts";
import { validateStructureAnalysis } from "./validate.ts";
import type { AnalysisWarning, ArgumentElement, StructureAnalysis, StructureAnalysisInput, StructureFailure, StructureOutcome } from "./types.ts";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export interface StructureDeps {
  /** Model call used for element extraction. Defaults to the project's Gemini client. */
  complete?: CompleteFn;
  /** Label recorded in metadata for an injected `complete`. */
  extractorName?: string;
  /** Embedding call for the optional semantic signal. Required for `useSemanticSimilarity` to take effect. */
  embed?: EmbedFn;
  now?: () => Date;
}

const fail = (code: StructureFailure["code"], message: string, retryable = false, details?: string[]): StructureOutcome => ({
  ok: false,
  error: { code, message, retryable, ...(details ? { details } : {}) },
});

async function semanticSimilarity(elements: ArgumentElement[], embed: EmbedFn | undefined, warnings: AnalysisWarning[]) {
  if (!embed) {
    warnings.push({ code: "semantic_unavailable", message: "Semantic similarity was requested but no embedding provider is configured; rule-based linking was used." });
    return undefined;
  }
  if (elements.length === 0) return undefined;
  if (elements.length > MAX_SEMANTIC_TEXTS) {
    warnings.push({ code: "semantic_skipped", message: `More than ${MAX_SEMANTIC_TEXTS} elements; semantic similarity was skipped.` });
    return undefined;
  }
  try {
    const vecs = await embed(elements.map((e) => e.text));
    if (vecs.length !== elements.length) throw new Error("embedding count mismatch");
    const byId = new Map(elements.map((e, i) => [e.id, vecs[i]]));
    return (a: string, b: string) => {
      const va = byId.get(a);
      const vb = byId.get(b);
      return va && vb ? cosine(va, vb) : undefined;
    };
  } catch (e) {
    warnings.push({ code: "semantic_failed", message: `Embedding failed (${(e as Error).message.slice(0, 120)}); rule-based linking was used.` });
    return undefined;
  }
}

export async function analyzeEssayStructure(input: StructureAnalysisInput, deps: StructureDeps = {}): Promise<StructureOutcome> {
  const parsed = structureInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", "Input must be an object with a text string.", false, parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`));
  const { text, topic } = parsed.data;
  if (!hasLetterOrDigit(text)) return fail("empty_input", "The essay text is empty.");
  if (text.length > STRUCTURE_LIMITS.maxChars) return fail("input_too_large", `The essay is longer than ${STRUCTURE_LIMITS.maxChars} characters.`);

  const essay = normalizeEssay(text);
  if (essay.sentences.length === 0) return fail("empty_input", "No sentences were found in the essay text.");
  if (essay.paragraphs.length > STRUCTURE_LIMITS.maxParagraphs || essay.sentences.length > STRUCTURE_LIMITS.maxSentences)
    return fail("input_too_large", `The essay has more than ${STRUCTURE_LIMITS.maxSentences} sentences or ${STRUCTURE_LIMITS.maxParagraphs} paragraphs.`);

  const warnings: AnalysisWarning[] = [...essay.warnings];
  const complete = deps.complete ?? geminiComplete;
  const extraction = await extractElements(essay, topic, complete);
  if (!extraction.ok) return { ok: false, error: extraction.error };

  const sentenceById = new Map(essay.sentences.map((s) => [s.id, s]));
  const elements: ArgumentElement[] = extraction.elements.map((x, i) => {
    const first = sentenceById.get(x.sentenceIds[0])!;
    const last = sentenceById.get(x.sentenceIds[x.sentenceIds.length - 1])!;
    return {
      id: `e${i + 1}`,
      role: x.role,
      sentenceIds: x.sentenceIds,
      paragraphId: first.paragraphId,
      text: text.slice(first.start, last.end),
      start: first.start,
      end: last.end,
      modelConfidence: x.modelConfidence,
      ...(x.alternativeRole ? { alternativeRole: x.alternativeRole } : {}),
    };
  });

  const wantSemantic = parsed.data.useSemanticSimilarity === true;
  const similarity = wantSemantic ? await semanticSimilarity(elements, deps.embed, warnings) : undefined;
  const links = buildLinks({ sentences: essay.sentences, elements, similarity });
  const baseFindings = diagnose({ paragraphs: essay.paragraphs, elements, links, semanticChecked: !!similarity });

  const resolved = resolveProfile(input.profile);
  warnings.push(...resolved.warnings);
  const { findings, application } = applyProfile(baseFindings, resolved.profile);

  const result: StructureAnalysis = {
    schemaVersion: STRUCTURE_SCHEMA_VERSION,
    essayMetadata: {
      charCount: text.length,
      wordCount: essay.wordCount,
      paragraphCount: essay.paragraphs.length,
      sentenceCount: essay.sentences.length,
      ...(topic ? { topic } : {}),
    },
    paragraphs: essay.paragraphs,
    sentences: essay.sentences,
    argumentElements: elements,
    argumentLinks: links,
    structuralFindings: findings,
    analysisMetadata: {
      generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
      extractor: { kind: "llm", name: deps.extractorName ?? (deps.complete ? "injected" : DEFAULT_EXTRACTOR_NAME), attempts: extraction.attempts },
      linking: { method: similarity ? "rule_based+embedding" : "rule_based", embeddingUsed: !!similarity },
      rejectedElements: extraction.rejected,
      warnings,
      profile: application,
      confidenceCalibration: "uncalibrated_heuristic",
      integrity: { passed: true, checks: 0 },
    },
  };

  const report = validateStructureAnalysis(result, text);
  if (report.issues.length > 0)
    return fail("integrity_error", "The analysis failed its own integrity checks and was discarded.", false, report.issues.slice(0, 5).map((i) => `${i.code}: ${i.message}`));
  result.analysisMetadata.integrity = { passed: true, checks: report.checks };
  return { ok: true, result };
}

