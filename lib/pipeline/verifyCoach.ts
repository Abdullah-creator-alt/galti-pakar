/**
 * Verification of everything the coach LLM writes. Quotes must exist in the transcript, figures must come from the
 * original paragraph, slots are capped, length is bounded and the final result is validated against the report schema.
 */
import { z } from "zod";
import { COACH } from "../config.ts";
import type { Fix, Rewrite } from "../types.ts";
import { fixSchema, rewriteSchema } from "./schema.ts";
import { countTextWords } from "./sentences.ts";
import type { FixTarget } from "./selectFixes.ts";
import { normalizeText, verifyQuote } from "./verifyQuotes.ts";
import type { VerifiedQuote } from "./findings.types.ts";

/* ---------- fixes ---------- */

export const fixesOutputSchema = z.object({
  fixes: z.array(z.object({ issueKey: z.string(), title: z.string(), body: z.string(), evidenceQuote: z.string() })),
});
export type FixesOutput = z.infer<typeof fixesOutputSchema>;

export const fixesResponseSchema = {
  type: "OBJECT",
  properties: {
    fixes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { issueKey: { type: "STRING" }, title: { type: "STRING" }, body: { type: "STRING" }, evidenceQuote: { type: "STRING" } },
        required: ["issueKey", "title", "body", "evidenceQuote"],
      },
    },
  },
  required: ["fixes"],
} as const;

export function cutWords(text: string, max: number): { text: string; cut: boolean } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return { text: text.trim(), cut: false };
  // Prefer a sentence boundary.
  const sentences = text.trim().match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [text.trim()];
  let out = "";
  for (const s of sentences) {
    const next = `${out}${s}`.trim();
    if (countTextWords(next) > max) break;
    out = `${out}${s}`;
  }
  if (out.trim()) return { text: out.trim(), cut: true };
  return { text: `${words.slice(0, max).join(" ").replace(/[,;:\s]+$/, "")}.`, cut: true };
}

export interface VerifiedFix {
  target: FixTarget;
  title: string;
  body: string;
  quote?: VerifiedQuote;
  quoteProposed: boolean;
  quoteUnverified: boolean;
  /** Paragraph from the quote's location, else the problem's own paragraph. */
  paragraphId: string | null;
  notes: string[];
}

/**
 * Checks the model's fixes against the problems it was given. Returns problems that justify one retry
 * (wrong or missing keys, empty text). Over-long text is cut, and a quote that is not in the essay is dropped
 * with the fix kept and flagged.
 */
export function checkFixes(raw: unknown, targets: FixTarget[], paragraphs: { id: string; text: string }[]): { fixes: VerifiedFix[]; problems: string[] } {
  const parsed = fixesOutputSchema.safeParse(raw);
  if (!parsed.success) return { fixes: [], problems: [`The reply did not match the required format: ${parsed.error.issues[0]?.message ?? "invalid"}`] };
  const problems: string[] = [];
  const keys = targets.map((t) => t.key);
  const got = parsed.data.fixes.map((f) => f.issueKey);
  const missing = keys.filter((k) => !got.includes(k));
  const extra = got.filter((k) => !keys.includes(k));
  const dup = got.filter((k, i) => got.indexOf(k) !== i);
  if (missing.length) problems.push(`Missing fixes for: ${missing.join(", ")}.`);
  if (extra.length) problems.push(`Unknown issueKeys: ${extra.join(", ")}. Use exactly: ${keys.join(", ")}.`);
  if (dup.length) problems.push(`Duplicate issueKeys: ${[...new Set(dup)].join(", ")}.`);

  const fixes: VerifiedFix[] = [];
  for (const target of targets) {
    const f = parsed.data.fixes.find((x) => x.issueKey === target.key);
    if (!f) continue;
    const notes: string[] = [];
    const t = cutWords(f.title.replace(/\s+/g, " "), COACH.TITLE_MAX_WORDS);
    const b = cutWords(f.body.replace(/\s+/g, " "), COACH.BODY_MAX_WORDS);
    if (!t.text || !b.text) { problems.push(`The fix for ${target.key} has an empty title or body.`); continue; }
    if (t.cut) notes.push("title cut to the word limit");
    if (b.cut) notes.push("body cut to the word limit");
    const quoteProposed = f.evidenceQuote.trim().length > 0;
    const quote = quoteProposed ? verifyQuote(f.evidenceQuote, paragraphs) ?? undefined : undefined;
    const quoteUnverified = quoteProposed && !quote;
    if (quoteUnverified) notes.push("quote unverified");
    if (!quoteProposed && target.sentences.length > 0) notes.push("no quote given");
    fixes.push({ target, title: t.text.replace(/[.]+$/, ""), body: b.text, ...(quote ? { quote } : {}), quoteProposed, quoteUnverified, paragraphId: quote?.paragraphId ?? target.paragraphId, notes });
  }
  return { fixes, problems };
}

/* ---------- rewrite ---------- */

export const rewriteOutputSchema = z.object({
  improved: z.string(),
  changeNotes: z.array(z.object({ what: z.string(), why: z.string() })),
});
export type RewriteOutput = z.infer<typeof rewriteOutputSchema>;

export const rewriteResponseSchema = {
  type: "OBJECT",
  properties: {
    improved: { type: "STRING" },
    changeNotes: { type: "ARRAY", items: { type: "OBJECT", properties: { what: { type: "STRING" }, why: { type: "STRING" } }, required: ["what", "why"] } },
  },
  required: ["improved", "changeNotes"],
} as const;

/** Generic names of kinds of source that a slot may mention without asserting any fact. */
const SLOT_NAME_ALLOWLIST = new Set(
  "Pakistan Pakistani Economic Survey State Bank Bureau Statistics Federal Board Revenue Ministry Finance Planning Commission World International Monetary Fund United Nations Development Programme Human Report Annual National Assembly Senate Supreme Court Constitution Federal".split(" "),
);

const SLOT_RE = /\[[^\[\]]+\]/g;
const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const core = (n: string) => n.replace(/,/g, "");

/** Slots in `text` that were not already in the original paragraph. */
export function findSlots(text: string, original: string): string[] {
  return (text.match(SLOT_RE) ?? []).filter((s) => !original.includes(s));
}

/** Figures (digit sequences, percentages, years) in `improved` that the original paragraph does not contain. */
export function unsupportedNumbers(improved: string, original: string): string[] {
  const have = new Set((original.match(NUMBER_RE) ?? []).map(core));
  return [...new Set((improved.match(NUMBER_RE) ?? []).filter((n) => !have.has(core(n))))];
}

/** Capitalised words inside new slots that are neither in the original nor generic names of kinds of source. */
export function unsupportedSlotNames(improved: string, original: string): string[] {
  const words = new Set(original.match(/[A-Za-z][A-Za-z'-]*/g) ?? []);
  const bad: string[] = [];
  for (const slot of findSlots(improved, original)) {
    const inner = slot.slice(1, -1);
    [...inner.matchAll(/\b[A-Z][A-Za-z'-]*/g)].forEach((m) => {
      const first = m.index === 0;
      if (!first && !words.has(m[0]) && !SLOT_NAME_ALLOWLIST.has(m[0]) && !bad.includes(m[0])) bad.push(m[0]);
    });
  }
  return bad;
}

export interface GuardResult {
  numbers: string[];
  names: string[];
  slots: string[];
}

export function guardRewrite(improved: string, original: string): GuardResult {
  return { numbers: unsupportedNumbers(improved, original), names: unsupportedSlotNames(improved, original), slots: findSlots(improved, original) };
}

/** Replaces unsupported figures and names with neutral slots. Used only after the retry has failed. */
export function neutralise(improved: string, original: string): { text: string; replaced: number } {
  let replaced = 0;
  const have = new Set((original.match(NUMBER_RE) ?? []).map(core));
  const badNames = new Set(unsupportedSlotNames(improved, original));
  // 1. Slots that hold a figure or an unsupported name become a plain slot.
  let text = improved.replace(SLOT_RE, (slot) => {
    if (original.includes(slot)) return slot;
    const hasBadNumber = (slot.match(NUMBER_RE) ?? []).some((n) => !have.has(core(n)));
    const hasBadName = [...slot.matchAll(/\b[A-Z][A-Za-z'-]*/g)].some((m) => badNames.has(m[0]));
    if (hasBadNumber || hasBadName) { replaced++; return hasBadNumber ? "[add a verified figure]" : "[add a verified source]"; }
    return slot;
  });
  // 2. Figures in the running text.
  const parts = text.split(/(\[[^\[\]]+\])/);
  text = parts.map((p) => (p.startsWith("[") ? p : p.replace(/\d+(?:[.,]\d+)*(?:\s?%|\s?percent)?/g, (m) => {
    if (have.has(core(m.replace(/\s?(%|percent)$/, "")))) return m;
    replaced++;
    return "[add a verified figure]";
  }))).join("");
  return { text, replaced };
}

export interface RewriteCheck {
  problems: string[];
  /** Empty, identical or the wrong length: cannot be repaired in code. */
  hard: boolean;
  ratio: number;
  guard: GuardResult;
}

/** Hard checks that justify one retry: empty, identical, wrong length, unsupported figures or names, too many slots. */
export function checkRewrite(improved: string, original: string): RewriteCheck {
  const problems: string[] = [];
  let hard = false;
  const text = improved.trim();
  const wo = countTextWords(original);
  const wi = countTextWords(text);
  const ratio = wo ? wi / wo : 0;
  if (!text) { hard = true; problems.push("The improved paragraph is empty."); }
  else if (normalizeText(text) === normalizeText(original)) { hard = true; problems.push("The improved paragraph is identical to the original; it must change to fix the listed problems."); }
  if (text && Math.abs(ratio - 1) > COACH.LENGTH_TOLERANCE) hard = true;
  if (text && Math.abs(ratio - 1) > COACH.LENGTH_TOLERANCE) problems.push(`The improved paragraph has ${wi} words but must be within ${COACH.LENGTH_TOLERANCE * 100}% of the original's ${wo} words.`);
  const guard = guardRewrite(text, original);
  if (guard.numbers.length) problems.push(`The improved paragraph contains figures that are not in the original: ${guard.numbers.join(", ")}. Remove them; use a bracketed slot naming the kind of evidence to look up instead.`);
  if (guard.names.length) problems.push(`Slots must not contain proper names that are not in the original: ${guard.names.join(", ")}.`);
  if (guard.slots.length > COACH.MAX_SLOTS) problems.push(`The improved paragraph has ${guard.slots.length} bracketed slots; use at most ${COACH.MAX_SLOTS}.`);
  return { problems, hard, ratio, guard };
}

/** Drops slots beyond the cap (keeping the first ones) after the retry has failed. */
export function capSlots(text: string, original: string): { text: string; dropped: number } {
  let seen = 0;
  let dropped = 0;
  const out = text.replace(SLOT_RE, (slot) => {
    if (original.includes(slot)) return slot;
    seen++;
    if (seen <= COACH.MAX_SLOTS) return slot;
    dropped++;
    return "";
  });
  return { text: out.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1"), dropped };
}

export function cleanNotes(notes: RewriteOutput["changeNotes"]): { what: string; why: string }[] {
  return notes
    .slice(0, COACH.MAX_CHANGE_NOTES)
    .map((n) => ({ what: cutWords(n.what, COACH.CHANGE_NOTE_MAX_WORDS).text, why: cutWords(n.why, COACH.CHANGE_NOTE_MAX_WORDS).text }))
    .filter((n) => n.what && n.why);
}

/* ---------- final validation ---------- */

export const coachResultSchema = z.object({ fixes: z.array(fixSchema).max(COACH.FIX_COUNT), rewrite: rewriteSchema });

/** Validates the final result against the report schema pieces and the transcript. Throws with a clear message. */
export function validateCoach(result: { fixes: Fix[]; rewrite: Rewrite }, paragraphs: { id: string; text: string }[]): void {
  coachResultSchema.parse(result);
  const ids = new Set(paragraphs.map((p) => p.id));
  result.fixes.forEach((f, i) => {
    if (f.rank !== i + 1) throw new Error(`Fix ranks must run 1, 2, 3 in order; got ${f.rank} at position ${i + 1}.`);
    if (f.paragraphId && !ids.has(f.paragraphId)) throw new Error(`fix.paragraphId "${f.paragraphId}" is not a paragraph of the essay.`);
  });
  const p = paragraphs.find((x) => x.id === result.rewrite.paragraphId);
  if (!p) throw new Error(`rewrite.paragraphId "${result.rewrite.paragraphId}" is not a paragraph of the essay.`);
  if (result.rewrite.original !== p.text) throw new Error("rewrite.original must be the paragraph text exactly as transcribed.");
}
