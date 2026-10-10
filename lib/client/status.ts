/**
 * Plain-words status for a highlight, so colour is never the only signal. Prefers the rule id from the trace when there
 * is one, and otherwise falls back to the tone and a few cues in the reason text.
 */
import type { ClaimMap, LinkStrength, SpanTrace } from "../types.extras.ts";
import type { Tone } from "../types.ts";

export interface SpanStatus {
  label: string;
}

const BY_RULE: Record<string, string> = {
  orphan_claim: "No evidence found",
  weak_link_claim: "Weakly linked",
  unrebutted_counterclaim: "Rebuttal missing",
  off_topic_paragraph: "Off-topic",
  generic_sentence: "Generic wording",
  generic_evidence: "Generic wording",
  strong_link_claim: "Claim linked to evidence",
  strong_link_evidence: "Evidence for a claim",
  specific_evidence: "Specific evidence",
};

const BY_TONE: Record<Tone, string> = { strong: "Strong", weak: "Weak or generic", offtopic: "Off-topic or unsupported" };

export function spanStatus(tone: Tone, reason: string, trace?: Pick<SpanTrace, "ruleId">): SpanStatus {
  // A trace may carry several rules joined with "+" (highest precedence first).
  const rule = trace?.ruleId.split("+")[0]?.trim();
  if (rule && BY_RULE[rule]) return { label: BY_RULE[rule] };
  const r = reason.toLowerCase();
  if (/no linked evidence|no evidence/.test(r)) return { label: BY_RULE.orphan_claim };
  if (/weakly linked|only weakly/.test(r)) return { label: BY_RULE.weak_link_claim };
  if (/not answered|unanswered|rebuttal/.test(r)) return { label: BY_RULE.unrebutted_counterclaim };
  if (/drift|off-topic|off topic/.test(r)) return { label: BY_RULE.off_topic_paragraph };
  if (/generic/.test(r)) return { label: BY_RULE.generic_sentence };
  if (tone === "strong" && /backed by|linked/.test(r)) return { label: BY_RULE.strong_link_claim };
  if (tone === "strong" && /specific|evidence for/.test(r)) return { label: BY_RULE.specific_evidence };
  return { label: BY_TONE[tone] };
}

export const STAGE_LABEL = { read: "Read", label: "Label", link: "Link", rule: "Rule", verify: "Verify" } as const;

/** "similarity 0.31, needs 0.45" when both numbers exist; just the similarity when only that does; otherwise null. */
export function similarityText(trace: Pick<SpanTrace, "similarity" | "threshold">): string | null {
  const { similarity: s, threshold: t } = trace;
  if (s === undefined) return null;
  return t === undefined ? `similarity ${s.toFixed(2)}` : `similarity ${s.toFixed(2)}, needs ${t.toFixed(2)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "6 claims: 3 supported, 1 weak, 2 without evidence" (plus any opposing views left unanswered). */
export function claimSummaryLine(s: ClaimMap["summary"]): string {
  const base = `${plural(s.claimsTotal, "claim", "claims")}: ${s.strong} supported, ${s.weak} weak, ${s.orphan} without evidence`;
  return s.unrebutted > 0 ? `${base}; ${plural(s.unrebutted, "opposing view", "opposing views")} not answered` : base;
}

export interface LinkChip {
  label: string;
  tone: "good" | "flag" | "alert";
}

export function linkChip(kind: "claim" | "counterclaim", strength: LinkStrength): LinkChip {
  if (strength === "unrebutted") return { label: "Rebuttal missing", tone: "alert" };
  if (strength === "orphan") return { label: "No evidence found", tone: "alert" };
  if (strength === "weak") return { label: kind === "counterclaim" ? "Weakly answered" : "Weak link", tone: "flag" };
  return { label: kind === "counterclaim" ? "Answered" : "Supported", tone: "good" };
}

/** Where a value sits against a reference range, in words. No score. */
export function rangeSentence(label: string, value: number, q1: number, q3: number, position: "below" | "within" | "above"): string {
  const f = (x: number) => (Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(Math.abs(x) < 1 ? 2 : 1));
  const where = position === "within" ? "inside" : position;
  return `${label}: yours is ${f(value)}, which is ${where === "inside" ? "inside" : `${where} `}${where === "inside" ? " the typical range" : "the typical range"} (${f(q1)} to ${f(q3)}).`.replace("  ", " ");
}

/* ---------- degraded-analysis detection ---------- */

/** Warnings that mean a check or a stage did not run, so the report deserves a neutral heads-up at the top. */
const DEGRADED = /unavailable|fallback|degrad|skipped|left out|written from templates|could not be (written|measured)|not checked|did not pass checks|weaker model/i;
export function isDegraded(warnings: readonly string[] | undefined): boolean {
  return !!warnings?.some((w) => DEGRADED.test(w));
}

/** The backend defaults every paragraph's relevance to 100 when it could not measure drift, and says so in a warning. */
export function driftUnmeasured(warnings: readonly string[] | undefined): boolean {
  return !!warnings?.some((w) => /topic relevance could not be measured/i.test(w));
}

/** Two paragraphs are the same if only whitespace differs. */
export const sameText = (a: string, b: string): boolean => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

export interface DebugStage {
  name: string;
  status: string;
  ms: number;
  note?: string;
}
/** Gemini calls and tokens one model used during the run, as the backend measured them. */
export interface DebugUsage {
  model: string;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  embeddedTexts: number;
}
export interface DebugInfo {
  stages: DebugStage[];
  usage?: DebugUsage[];
  totalMs?: number;
}

const USAGE_KEYS = ["calls", "failed", "inputTokens", "outputTokens", "thinkingTokens", "embeddedTexts"] as const;

/** Defensive parse of the backend's optional debug field. Anything malformed is dropped. */
export function parseDebug(input: unknown): DebugInfo | undefined {
  const stages = (input as { stages?: unknown })?.stages;
  if (!Array.isArray(stages)) return undefined;
  const ok = stages.flatMap((s) => {
    const o = s as Partial<DebugStage>;
    return typeof o?.name === "string" && typeof o.status === "string" && typeof o.ms === "number" ? [{ name: o.name.slice(0, 40), status: o.status.slice(0, 20), ms: o.ms, ...(typeof o.note === "string" ? { note: o.note.slice(0, 200) } : {}) }] : [];
  });
  if (!ok.length) return undefined;
  const meta = (input as { meta?: { usage?: unknown; totalMs?: unknown } }).meta;
  const raw = meta?.usage && typeof meta.usage === "object" ? Object.entries(meta.usage as Record<string, unknown>) : [];
  const usage = raw.flatMap(([model, v]) => {
    const o = v as Record<string, unknown>;
    if (!o || !USAGE_KEYS.every((k) => typeof o[k] === "number")) return [];
    return [{ model: model.slice(0, 60), ...Object.fromEntries(USAGE_KEYS.map((k) => [k, o[k] as number])) } as DebugUsage];
  });
  return { stages: ok, ...(usage.length ? { usage } : {}), ...(typeof meta?.totalMs === "number" ? { totalMs: meta.totalMs } : {}) };
}
