import { countTextWords } from "./sentences.ts";
import type { MeasuredFindings, RunDimension, VerifiedQuote } from "./findings.types.ts";
import { bandFromScore, clampScore } from "./rubric.ts";
import type { RubricKey } from "../types.ts";

/** Quotes longer than this are rejected: a quote must be a snippet, not a paragraph. */
export const MAX_QUOTE_WORDS = 25;

const CURLY_SINGLE = /[‘’‚‛′]/;
const CURLY_DOUBLE = /[“”„‟″]/;
const DASHES = /[‐-―−]/;

/**
 * Normalises for matching only: unifies curly and straight quotes and dashes, collapses whitespace, lowercases.
 * `map[i]` is the index in the ORIGINAL text of normalised character i, so matches can be turned back into offsets.
 */
export function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  const push = (s: string, at: number) => {
    for (const ch of s) {
      norm += ch;
      map.push(at);
    }
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c) || c === " ") {
      if (norm.length && norm[norm.length - 1] !== " ") push(" ", i);
    } else if (CURLY_SINGLE.test(c)) push("'", i);
    else if (CURLY_DOUBLE.test(c)) push('"', i);
    else if (DASHES.test(c)) push("-", i);
    else if (c === "…") push("...", i);
    else push(c.toLowerCase(), i);
  }
  return { norm, map };
}

export const normalizeText = (s: string): string => normalizeWithMap(s).norm.trim();

function stripWrappingQuotes(q: string): string {
  const m = q.match(/^["'](.*)["']$/s);
  return m ? m[1].trim() : q;
}

/**
 * Finds a quote in the transcript. Returns offsets in the ORIGINAL paragraph text, or null.
 * Matching is exact after normalisation; there is no fuzzy matching. A quote cannot span paragraphs.
 */
export function verifyQuote(quote: string, paragraphs: { id: string; text: string }[]): VerifiedQuote | null {
  const candidates = [normalizeText(quote)];
  const stripped = stripWrappingQuotes(candidates[0]);
  if (stripped !== candidates[0]) candidates.push(stripped);
  for (const q of candidates) {
    if (!q || countTextWords(q) > MAX_QUOTE_WORDS) continue;
    for (const p of paragraphs) {
      const { norm, map } = normalizeWithMap(p.text);
      const at = norm.indexOf(q);
      if (at < 0) continue;
      const start = map[at];
      const end = map[at + q.length - 1] + 1;
      return { text: p.text.slice(start, end), paragraphId: p.id, start, end };
    }
  }
  return null;
}

/**
 * An absence claim ("no counter-argument") is valid only if the measured findings do not contradict it.
 * Returns a note describing the contradiction, or null.
 */
export function absenceConflict(key: RubricKey, findings: MeasuredFindings): string | null {
  const labels = new Set(findings.structure?.map((s) => s.label));
  if (key === "counter-argument" && (labels.has("Counter-argument") || labels.has("Rebuttal")))
    return "The structure analysis found a counter-argument or rebuttal.";
  if (key === "thesis" && labels.has("Position")) return "The structure analysis found a stated position.";
  if (key === "evidence") {
    if (labels.has("Evidence")) return "The structure analysis found evidence paragraphs.";
    if (findings.links?.some((l) => !l.orphan && l.evidenceParagraphId)) return "The evidence links found claims with supporting evidence.";
  }
  return null;
}

export interface RawDimension {
  score: number;
  reason: string;
  quotes: string[];
  absence: boolean;
  disagreesWith?: string;
}

/** Verifies one dimension of one run and derives everything the model must not decide (band, flags, confidence). */
export function verifyDimension(
  key: RubricKey,
  raw: RawDimension,
  paragraphs: { id: string; text: string }[],
  findings: MeasuredFindings,
): RunDimension {
  const score = clampScore(raw.score);
  const verified: VerifiedQuote[] = [];
  let rejected = 0;
  for (const q of raw.quotes) {
    const v = verifyQuote(q, paragraphs);
    if (!v) rejected++;
    else if (!verified.some((x) => x.paragraphId === v.paragraphId && x.start === v.start && x.end === v.end)) verified.push(v);
  }
  // Judgments with no verifiable evidence are flagged; absence claims are the only judgments allowed to have no quote.
  const unverified = (raw.quotes.length > 0 && verified.length === 0) || (raw.quotes.length === 0 && !raw.absence);
  const conflictNote = raw.absence ? absenceConflict(key, findings) ?? undefined : undefined;
  const conflict = conflictNote !== undefined;
  const confidence = unverified || conflict ? "low" : raw.absence ? "medium" : rejected > 0 ? "medium" : "high";
  return {
    key,
    score,
    band: bandFromScore(score),
    reason: raw.reason.trim(),
    absence: raw.absence,
    ...(raw.disagreesWith ? { disagreesWith: raw.disagreesWith } : {}),
    quotesProposed: raw.quotes.length,
    verifiedQuotes: verified,
    quotesRejected: rejected,
    unverified,
    conflict,
    ...(conflictNote ? { conflictNote } : {}),
    confidence,
  };
}
