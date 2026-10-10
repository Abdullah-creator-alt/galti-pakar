/**
 * Small adapters between steps that were built separately. Nothing here changes a step; it only reconciles shapes
 * (sentence ids, paragraph ids, offsets) and wires dependencies the orchestrator needs.
 */
import { COACH, EMBED_TEXT_BUDGET, GEMINI_STRUCTURE_MODELS } from "../config.ts";
import { GeminiError, generateText } from "../gemini.ts";
import type { CompleteFn } from "../structure/index.ts";
import type { BenchmarkResult } from "./benchmark.types.ts";
import type { BlendedAnalysis, SentenceRef } from "./blend.types.ts";
import { templateFix } from "./coachTemplates.ts";
import { selectFixes } from "./selectFixes.ts";
import { cutWords } from "./verifyCoach.ts";
import type { Fix } from "../types.ts";
import { countCliches } from "./cliches.ts";
import type { MeasuredFindings } from "./findings.types.ts";
import { countTextWords, splitSentences } from "./sentences.ts";
import type { RequestEmbed } from "./sharedEmbed.ts";
import type { TranscribedEssay } from "./transcribe.types.ts";

/** Word count of the transcript, computed in code from the paragraph text (never taken from a model). */
export function essayWordCount(essay: Pick<TranscribedEssay, "paragraphs">): number {
  return essay.paragraphs.reduce((n, p) => n + countTextWords(p.text), 0);
}

/** The "rule checks" stage: cheap deterministic facts about the essay. Needs no embeddings and cannot fail. */
export function ruleChecks(essay: Pick<TranscribedEssay, "paragraphs">): NonNullable<MeasuredFindings["rules"]> {
  return {
    wordCount: essayWordCount(essay),
    paragraphCount: essay.paragraphs.length,
    clicheHits: essay.paragraphs.reduce((n, p) => n + countCliches(p.text), 0),
    missingIntro: !essay.paragraphs.some((p) => p.kind === "intro"),
    missingConclusion: !essay.paragraphs.some((p) => p.kind === "conclusion"),
  };
}

/**
 * The texts to embed up front: the topic, every paragraph, and the sentences that fit the embedding budget (longest
 * first), chosen by the same rule analyseGenericnessAndDrift uses so that stage finds them already cached.
 */
export function embedPlan(essay: Pick<TranscribedEssay, "paragraphs">, topic: string, budget: number = EMBED_TEXT_BUDGET): string[] {
  const all = essay.paragraphs.flatMap((p, pi) => splitSentences(p.text).map((s, si) => ({ pi, si, text: s.text, words: countTextWords(s.text) })));
  const room = Math.max(budget - 1 - essay.paragraphs.length, 0);
  const chosen = all.length <= room ? all : [...all].sort((x, y) => y.words - x.words || x.pi - y.pi || x.si - y.si).slice(0, room);
  const keep = new Set(chosen.map((c) => `${c.pi}:${c.si}`));
  return [topic, ...essay.paragraphs.map((p) => p.text), ...all.filter((c) => keep.has(`${c.pi}:${c.si}`)).map((c) => c.text)];
}

/** Fills sentence vectors from the request cache, with no network call. Sentences not cached stay without a vector. */
export function withCachedVectors(refs: SentenceRef[], embed: Pick<RequestEmbed, "peek">): SentenceRef[] {
  return refs.map((r) => {
    const vec = embed.peek(r.text);
    return vec ? { ...r, vec } : r;
  });
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Model call for the structure step, with fallback models. The structure module's own default uses a single model,
 * so one quota-exhausted model would lose the whole Argument X-Ray. Errors keep their `status` for the module.
 */
export const structureComplete: CompleteFn = async (req) => {
  let last: unknown;
  const started = Date.now();
  for (let i = 0; i < GEMINI_STRUCTURE_MODELS.length; i++) {
    const remaining = req.timeoutMs - (Date.now() - started);
    if (remaining < 2000) break;
    try {
      return await generateText({
        model: GEMINI_STRUCTURE_MODELS[i],
        system: req.system,
        prompt: req.prompt,
        responseSchema: req.responseSchema,
        temperature: 0,
        maxOutputTokens: 8192,
        timeoutMs: i < GEMINI_STRUCTURE_MODELS.length - 1 ? Math.min(remaining, 15_000) : remaining,
      });
    } catch (e) {
      last = e;
      if (!(e instanceof GeminiError) || e.status === undefined || !RETRYABLE.has(e.status)) throw e;
    }
  }
  throw last ?? new GeminiError("No model answered in time.", 504);
};

/** A benchmark result is only passed on when it has something to say. */
export function usableBenchmark(b?: BenchmarkResult): BenchmarkResult | undefined {
  return b && b.status !== "unavailable" ? b : undefined;
}

/** Fixes written from code templates, used only when the coach step could not produce any. Same findings, no model. */
export function templateFixesFrom(blended: BlendedAnalysis, benchmark?: BenchmarkResult): Fix[] {
  const { targets } = selectFixes(blended, benchmark);
  const number = (id: string | null) => {
    const i = id ? blended.reportParts.paragraphs.findIndex((p) => p.id === id) : -1;
    return i >= 0 ? i + 1 : null;
  };
  return targets.map((t, i) => {
    const tpl = templateFix(t, number(t.paragraphId));
    return {
      rank: (i + 1) as 1 | 2 | 3,
      title: cutWords(tpl.title, COACH.TITLE_MAX_WORDS).text,
      body: cutWords(tpl.body, COACH.BODY_MAX_WORDS).text,
      ...(t.paragraphId ? { paragraphId: t.paragraphId } : {}),
    };
  });
}
