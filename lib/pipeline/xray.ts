/**
 * Argument X-Ray: claim-to-evidence links, per-sentence colour rules, spans and the trace behind each span.
 * Pure code. Every reason string is a template filled with real numbers; no LLM is involved.
 */
import { EVIDENCE_WINDOW, LINK_STRONG, LINK_WEAK, REBUTTAL_WINDOW } from "./blendConfig.ts";
import type {
  ClaimLink,
  CounterResult,
  IssueType,
  LinkStrength,
  LinkWindow,
  SentenceLabel,
  SentenceRef,
  TraceEntry,
  XRayStats,
} from "./blend.types.ts";
import type { GenericLevel } from "./genericness.ts";
import type { ParagraphRole, Tone } from "../types.ts";
import { cosine } from "./vecmath.ts";

/** Everything the rules know about one sentence. */
export interface SentenceInfo {
  ref: SentenceRef;
  paragraphIndex: number;
  indexInParagraph: number;
  label?: SentenceLabel;
  genericLevel?: GenericLevel;
  genericScore?: number | null;
  genericCodes?: string[];
}

export interface Thresholds {
  strong: number;
  weak: number;
}

/* ---------- linking ---------- */

export interface Candidate {
  id: string;
  vec?: number[];
  sameParagraph: boolean;
}

export interface LinkDecision {
  evidenceId: string | null;
  similarity: number;
  strength: LinkStrength;
  window: LinkWindow;
}

/**
 * Pure link decision for one claim. Strong: a same-paragraph Evidence sentence at or above `strong`.
 * Weak: the best candidate anywhere in the window at or above `weak`. Otherwise orphan (similarity = best found, or 0).
 */
export function decideLink(claimVec: number[] | undefined, candidates: Candidate[], t: Thresholds = { strong: LINK_STRONG, weak: LINK_WEAK }): LinkDecision {
  const scored = claimVec ? candidates.filter((c) => c.vec).map((c) => ({ c, s: cosine(claimVec, c.vec!) })) : [];
  const best = scored.reduce<(typeof scored)[number] | null>((a, b) => (!a || b.s > a.s ? b : a), null);
  const bestSame = scored.filter((x) => x.c.sameParagraph).reduce<(typeof scored)[number] | null>((a, b) => (!a || b.s > a.s ? b : a), null);
  if (bestSame && bestSame.s >= t.strong) return { evidenceId: bestSame.c.id, similarity: bestSame.s, strength: "strong", window: "same-paragraph" };
  if (best && best.s >= t.weak) return { evidenceId: best.c.id, similarity: best.s, strength: "weak", window: best.c.sameParagraph ? "same-paragraph" : "adjacent-paragraph" };
  return { evidenceId: null, similarity: best?.s ?? 0, strength: "orphan", window: "none" };
}

const isClaimLike = (i: SentenceInfo) => i.label?.label === "Claim" || i.label?.label === "Position";

export function linkClaims(infos: SentenceInfo[], t: Thresholds = { strong: LINK_STRONG, weak: LINK_WEAK }): ClaimLink[] {
  const links: ClaimLink[] = [];
  infos.forEach((info, idx) => {
    if (!isClaimLike(info)) return;
    const claimLabel = info.label!.label as "Claim" | "Position";
    const candidates: Candidate[] = infos
      .filter((o) => o.ref.id !== info.ref.id && o.label?.label === "Evidence" && Math.abs(o.paragraphIndex - info.paragraphIndex) <= EVIDENCE_WINDOW.weakParagraphs)
      .map((o) => ({ id: o.ref.id, vec: o.ref.vec, sameParagraph: o.paragraphIndex === info.paragraphIndex }));
    let d = decideLink(info.ref.vec, candidates, t);
    // No Evidence label anywhere nearby: a specific sentence right after the claim is accepted as weak support.
    if (d.strength === "orphan" && candidates.length === 0) {
      const next = infos[idx + 1];
      if (next && next.paragraphIndex === info.paragraphIndex && next.genericLevel === "specific") {
        const sim = info.ref.vec && next.ref.vec ? cosine(info.ref.vec, next.ref.vec) : 0;
        d = { evidenceId: next.ref.id, similarity: sim, strength: "weak", window: "next-sentence-specific" };
      }
    }
    links.push({ claimSentenceId: info.ref.id, claimLabel, evidenceSentenceId: d.evidenceId, similarity: round(d.similarity), strength: d.strength, windowUsed: d.window });
  });
  return links;
}

export function findRebuttals(infos: SentenceInfo[]): CounterResult[] {
  const out: CounterResult[] = [];
  infos.forEach((info, idx) => {
    if (info.label?.label !== "Counterclaim") return;
    const hit = infos.slice(idx + 1).find((o) => {
      if (o.label?.label !== "Rebuttal") return false;
      if (o.paragraphIndex === info.paragraphIndex) return o.indexInParagraph - info.indexInParagraph <= REBUTTAL_WINDOW.sentences;
      return o.paragraphIndex - info.paragraphIndex <= REBUTTAL_WINDOW.paragraphs;
    });
    out.push({ counterSentenceId: info.ref.id, rebuttalSentenceId: hit?.ref.id ?? null, status: hit ? "rebutted" : "unrebutted" });
  });
  return out;
}

export function xrayStats(links: ClaimLink[], counters: CounterResult[]): XRayStats {
  const claims = links.filter((l) => l.claimLabel === "Claim");
  const strong = claims.filter((l) => l.strength === "strong").length;
  const weak = claims.filter((l) => l.strength === "weak").length;
  const orphan = claims.filter((l) => l.strength === "orphan").length;
  return {
    claimsTotal: claims.length,
    claimsStrong: strong,
    claimsWeak: weak,
    claimsOrphan: orphan,
    claimsLinkedShare: claims.length ? (strong + 0.5 * weak) / claims.length : 0,
    orphanShare: claims.length ? orphan / claims.length : 0,
    unrebuttedCount: counters.filter((c) => c.status === "unrebutted").length,
    counterclaims: counters.length,
  };
}

const round = (x: number) => Math.round(x * 100) / 100;

/* ---------- colour rules ---------- */

type Tier = "red" | "amber" | "green";
const TIER_RANK: Record<Tier, number> = { red: 3, amber: 2, green: 1 };
const TONE_FOR_TIER: Record<Tier, Tone> = { red: "offtopic", amber: "weak", green: "strong" };

interface Hit {
  ruleId: string;
  tier: Tier;
  reason: string;
}

export interface ColourContext {
  structureAvailable: boolean;
  /** Links were computed (structure present and vectors available). */
  linksAvailable: boolean;
  links: ClaimLink[];
  counters: CounterResult[];
  /** paragraphId -> relevance 0-100, when the drift result exists. */
  relevance: Map<string, number>;
  driftThreshold: number;
  thresholds: Thresholds;
}

export interface SentenceColour {
  info: SentenceInfo;
  tone: Tone | null;
  ruleIds: string[];
  reasons: string[];
  trace: TraceEntry["inputs"];
  chain: string[];
}

export function colourSentences(infos: SentenceInfo[], ctx: ColourContext): SentenceColour[] {
  const linkBy = new Map(ctx.links.map((l) => [l.claimSentenceId, l]));
  const counterBy = new Map(ctx.counters.map((c) => [c.counterSentenceId, c]));
  // evidence sentence -> the claim it strongly supports
  const supports = new Map<string, ClaimLink>();
  for (const l of ctx.links) if (l.claimLabel === "Claim" && l.strength === "strong" && l.evidenceSentenceId) supports.set(l.evidenceSentenceId, l);
  const pn = (i: SentenceInfo) => i.paragraphIndex + 1;

  return infos.map((info) => {
    const label = info.label?.label;
    const rel = ctx.relevance.get(info.ref.paragraphId);
    const onTopic = rel !== undefined && rel >= ctx.driftThreshold;
    const hits: Hit[] = [];
    const chain: string[] = ["read from the transcript"];
    let linkedId: string | null = null;
    let similarity: number | undefined;

    if (info.label) chain.push(`labelled ${label} (${info.label.source}${info.label.confidence !== undefined ? `, confidence ${info.label.confidence.toFixed(2)}` : ""})`);

    if (rel !== undefined && rel < ctx.driftThreshold) {
      hits.push({ ruleId: "off_topic_paragraph", tier: "red", reason: `Paragraph ${pn(info)} drifts from the topic (relevance ${Math.round(rel)}, threshold ${ctx.driftThreshold})` });
    }

    if (ctx.linksAvailable && label === "Claim") {
      const l = linkBy.get(info.ref.id);
      if (l) {
        linkedId = l.evidenceSentenceId;
        similarity = l.similarity;
        chain.push(l.evidenceSentenceId ? `linked to ${l.evidenceSentenceId} (${l.strength}, similarity ${l.similarity.toFixed(2)})` : `no evidence link (best match ${l.similarity.toFixed(2)})`);
        if (l.strength === "orphan") {
          hits.push({ ruleId: "orphan_claim", tier: "red", reason: `Claim in paragraph ${pn(info)} has no linked evidence (best match ${l.similarity.toFixed(2)}, needs ${ctx.thresholds.weak})` });
        } else if (l.strength === "weak") {
          hits.push({ ruleId: "weak_link_claim", tier: "amber", reason: `Claim in paragraph ${pn(info)} is only weakly linked to ${l.evidenceSentenceId} (match ${l.similarity.toFixed(2)}, strong needs ${ctx.thresholds.strong})` });
        } else if (onTopic) {
          hits.push({ ruleId: "strong_link_claim", tier: "green", reason: `Claim in paragraph ${pn(info)} is backed by evidence in ${l.evidenceSentenceId} (match ${l.similarity.toFixed(2)}, needs ${ctx.thresholds.strong})` });
        }
      }
    }

    if (ctx.structureAvailable && label === "Counterclaim") {
      const c = counterBy.get(info.ref.id);
      if (c) {
        linkedId = c.rebuttalSentenceId;
        chain.push(c.rebuttalSentenceId ? `answered by ${c.rebuttalSentenceId}` : "no rebuttal found");
        if (c.status === "unrebutted") {
          hits.push({ ruleId: "unrebutted_counterclaim", tier: "red", reason: `Opposing view in paragraph ${pn(info)} is not answered in the next ${REBUTTAL_WINDOW.sentences} sentences or the next paragraph` });
        }
      }
    }

    if (label === "Evidence") {
      const claim = supports.get(info.ref.id);
      if (ctx.linksAvailable && claim && onTopic) {
        linkedId = claim.claimSentenceId;
        similarity = claim.similarity;
        hits.push({ ruleId: "strong_link_evidence", tier: "green", reason: `Evidence for the claim in ${claim.claimSentenceId} (match ${claim.similarity.toFixed(2)}, needs ${ctx.thresholds.strong})` });
      }
      if (info.genericLevel === "specific") {
        hits.push({ ruleId: "specific_evidence", tier: "green", reason: `Specific evidence (genericness ${fmt(info.genericScore)})` });
      }
    }

    const hasRed = hits.some((h) => h.tier === "red");
    if (info.genericLevel === "generic" && !hasRed) {
      chain.push(`genericness ${fmt(info.genericScore)} (generic)`);
      const detail = info.genericCodes?.length ? `: ${info.genericCodes.join(", ")}` : "";
      hits.push(
        label === "Evidence"
          ? { ruleId: "generic_evidence", tier: "amber", reason: `Evidence sentence is generic (score ${fmt(info.genericScore)}${detail})` }
          : { ruleId: "generic_sentence", tier: "amber", reason: `Reads as generic (score ${fmt(info.genericScore)}${detail})` },
      );
    }
    // A generic Evidence sentence is not also "specific evidence" or a strong support for a claim's green.
    const ordered = hits.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
    const top = ordered[0];
    if (top) chain.push(`rule fired: ${ordered.slice(0, 2).map((h) => h.ruleId).join(" + ")}`);
    return {
      info,
      tone: top ? TONE_FOR_TIER[top.tier] : null,
      ruleIds: ordered.slice(0, 2).map((h) => h.ruleId),
      reasons: ordered.slice(0, 2).map((h) => h.reason),
      trace: {
        ...(label ? { label } : {}),
        ...(info.label ? { labelSource: info.label.source, ...(info.label.confidence !== undefined ? { labelConfidence: info.label.confidence } : {}) } : {}),
        ...(info.genericLevel ? { genericLevel: info.genericLevel, genericScore: info.genericScore ?? null } : {}),
        relevance: rel ?? null,
        linkedSentenceId: linkedId,
        ...(similarity !== undefined ? { similarity } : {}),
        thresholds: { linkStrong: ctx.thresholds.strong, linkWeak: ctx.thresholds.weak, driftThreshold: ctx.driftThreshold },
      },
      chain,
    };
  });
}

function fmt(x: number | null | undefined): string {
  return x === null || x === undefined ? "n/a" : x.toFixed(2);
}

/* ---------- spans ---------- */

export interface ProposedSpan {
  paragraphId: string;
  start: number;
  end: number;
  tone: Tone;
  reason: string;
  trace: TraceEntry;
}

/**
 * One span per coloured sentence, so spans never overlap. Adjacent sentences merge only when tone and rule ids
 * are identical (e.g. every sentence of a drifting paragraph).
 */
export function buildSpans(colours: SentenceColour[]): ProposedSpan[] {
  const spans: ProposedSpan[] = [];
  let open: { span: ProposedSpan; lastIdx: number; paragraphIndex: number; reasons: Set<string>; count: number; inputs: SentenceColour[] } | null = null;
  const flush = () => {
    if (!open) return;
    const s = open.span;
    if (open.count > 1 && open.reasons.size > 1) s.reason = `${s.reason} (same finding in ${open.count - 1} more adjacent sentence${open.count > 2 ? "s" : ""})`;
    s.trace.sentenceIds = open.inputs.map((c) => c.info.ref.id);
    spans.push(s);
    open = null;
  };
  colours.forEach((c, i) => {
    if (!c.tone) return flush();
    const key = c.ruleIds.join("+");
    if (open && open.lastIdx === i - 1 && open.paragraphIndex === c.info.paragraphIndex && open.span.tone === c.tone && open.span.trace.ruleIds.join("+") === key) {
      open.span.end = c.info.ref.end;
      open.span.trace.end = c.info.ref.end;
      open.lastIdx = i;
      open.count++;
      open.reasons.add(c.reasons.join("; "));
      open.inputs.push(c);
      return;
    }
    flush();
    const trace: TraceEntry = { paragraphId: c.info.ref.paragraphId, start: c.info.ref.start, end: c.info.ref.end, tone: c.tone, ruleIds: c.ruleIds, sentenceIds: [c.info.ref.id], chain: c.chain, inputs: c.trace };
    open = {
      span: { paragraphId: c.info.ref.paragraphId, start: c.info.ref.start, end: c.info.ref.end, tone: c.tone, reason: c.reasons.join("; "), trace },
      lastIdx: i,
      paragraphIndex: c.info.paragraphIndex,
      reasons: new Set([c.reasons.join("; ")]),
      count: 1,
      inputs: [c],
    };
  });
  flush();
  return spans;
}

/* ---------- paragraph fields ---------- */

const ROLE_WORD: Record<ParagraphRole, string> = { position: "Position", claim: "Claim", evidence: "Evidence", "counter-argument": "Counter-argument", conclusion: "Conclusion" };

/** Paragraph role from sentence labels and the transcription kind. First match wins (see PARAGRAPH_ROLE_RULES in blendConfig.ts). */
export function paragraphRole(labels: (string | undefined)[], kind: "intro" | "body" | "conclusion"): ParagraphRole {
  const has = (l: string) => labels.includes(l);
  const count = (l: string) => labels.filter((x) => x === l).length;
  if (has("Conclusion")) return "conclusion";
  if (has("Position")) return "position";
  if (has("Counterclaim") || has("Rebuttal")) return "counter-argument";
  if (count("Evidence") > 0 && count("Evidence") >= count("Claim")) return "evidence";
  if (has("Claim")) return "claim";
  return kind === "intro" ? "position" : kind === "conclusion" ? "conclusion" : "claim";
}

export function paragraphSummary(role: ParagraphRole, colours: SentenceColour[], relevance: number | undefined, driftThreshold: number): string {
  const q: string[] = [];
  const has = (rule: string) => colours.filter((c) => c.ruleIds.includes(rule)).length;
  if (relevance !== undefined && relevance < driftThreshold) q.push(`off-topic (relevance ${Math.round(relevance)})`);
  if (has("orphan_claim")) q.push("no linked evidence");
  if (has("weak_link_claim")) q.push("weakly linked evidence");
  if (has("strong_link_claim")) q.push("evidence linked");
  if (has("unrebutted_counterclaim")) q.push("opposing view not answered");
  const generic = has("generic_sentence") + has("generic_evidence");
  if (colours.length && generic / colours.length >= 0.5) q.push("mostly generic");
  return `${ROLE_WORD[role]}${q.length ? ", " + q.join(", ") : ""}`;
}

/* ---------- essay-level findings ---------- */

export interface EssayFinding {
  type: IssueType;
  message: string;
}

export function essayFindings(infos: SentenceInfo[], kindsByParagraph: ("intro" | "body" | "conclusion")[], structureAvailable: boolean): EssayFinding[] {
  if (!structureAvailable) return [];
  const out: EssayFinding[] = [];
  const labelled = (l: string) => infos.some((i) => i.label?.label === l);
  if (!labelled("Counterclaim")) out.push({ type: "missing_counter", message: "No counter-argument found anywhere in the essay" });
  const introIdx = Math.max(kindsByParagraph.indexOf("intro"), 0);
  if (!infos.some((i) => i.paragraphIndex === introIdx && i.label?.label === "Position")) out.push({ type: "no_position", message: "No clear position found in the introduction" });
  if (!labelled("Conclusion")) out.push({ type: "no_conclusion", message: "No concluding statement found" });
  return out;
}
