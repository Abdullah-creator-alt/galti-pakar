/**
 * Verification layer: every span and carried quote is checked before output, and the examiner is cross-checked
 * against the measurements. Anything that fails is dropped and counted, never emitted.
 */
import type { RubricKey } from "../types.ts";
import { CROSS_CHECK } from "./blendConfig.ts";
import type { ConflictRecord, SentenceRef, XRayStats } from "./blend.types.ts";
import type { SecondOpinion, VerifiedQuote } from "./findings.types.ts";
import { toneSchema } from "./schema.ts";
import type { ProposedSpan } from "./xray.ts";

export interface DroppedSpan {
  span: ProposedSpan;
  why: string;
}

/**
 * Span invariants: inside the paragraph, text equals the source sentence(s), allowed tone, non-empty reason,
 * sorted and non-overlapping. A failing span is dropped.
 */
export function verifySpans(proposed: ProposedSpan[], paragraphs: { id: string; text: string }[], sentences: SentenceRef[]): { valid: ProposedSpan[]; dropped: DroppedSpan[] } {
  const byParagraph = new Map(paragraphs.map((p) => [p.id, p.text]));
  const byId = new Map(sentences.map((s) => [s.id, s]));
  const dropped: DroppedSpan[] = [];
  const ok: ProposedSpan[] = [];

  for (const sp of proposed) {
    const text = byParagraph.get(sp.paragraphId);
    const fail = (why: string) => dropped.push({ span: sp, why });
    if (text === undefined) { fail("unknown paragraph"); continue; }
    if (!Number.isInteger(sp.start) || !Number.isInteger(sp.end) || sp.start < 0 || sp.end <= sp.start || sp.end > text.length) { fail(`offsets ${sp.start}-${sp.end} outside the paragraph (length ${text.length})`); continue; }
    if (!toneSchema.safeParse(sp.tone).success) { fail(`tone "${sp.tone}" is not allowed`); continue; }
    if (!sp.reason || !sp.reason.trim()) { fail("empty reason"); continue; }
    const cs = sp.trace.sentenceIds.map((id) => byId.get(id));
    if (cs.length === 0 || cs.some((c) => !c || c.paragraphId !== sp.paragraphId)) { fail("source sentence missing or in another paragraph"); continue; }
    const sents = cs as SentenceRef[];
    if (sents.some((c) => text.slice(c.start, c.end) !== c.text)) { fail("a source sentence does not match the paragraph text"); continue; }
    if (sents[0].start !== sp.start || sents[sents.length - 1].end !== sp.end) { fail("span does not match its source sentences"); continue; }
    if (sents.length === 1 && text.slice(sp.start, sp.end) !== sents[0].text) { fail("span text differs from its sentence"); continue; }
    ok.push(sp);
  }

  // Sorted and non-overlapping within each paragraph.
  const valid: ProposedSpan[] = [];
  const lastEnd = new Map<string, number>();
  for (const sp of [...ok].sort((a, b) => (a.paragraphId === b.paragraphId ? a.start - b.start : 0))) {
    if (sp.start < (lastEnd.get(sp.paragraphId) ?? -1)) { dropped.push({ span: sp, why: "overlaps an earlier span" }); continue; }
    lastEnd.set(sp.paragraphId, sp.end);
    valid.push(sp);
  }
  // Restore the original paragraph order.
  const order = new Map(proposed.map((s, i) => [s, i]));
  valid.sort((a, b) => (order.get(a)! - order.get(b)!));
  return { valid, dropped };
}

/** Re-checks that examiner quotes still resolve to the same text at the same offsets. */
export function recheckQuotes(examiner: SecondOpinion, sources: { id: string; text: string }[]): { valid: Map<RubricKey, VerifiedQuote[]>; failed: number } {
  const byId = new Map(sources.map((s) => [s.id, s.text]));
  const valid = new Map<RubricKey, VerifiedQuote[]>();
  let failed = 0;
  for (const d of examiner.dimensions) {
    const good: VerifiedQuote[] = [];
    for (const q of d.verifiedQuotes) {
      const t = byId.get(q.paragraphId);
      if (t !== undefined && t.slice(q.start, q.end) === q.text) good.push(q);
      else failed++;
    }
    valid.set(d.key, good);
  }
  return { valid, failed };
}

export interface CrossCheckInput {
  examiner?: SecondOpinion;
  outOf: number;
  structureAvailable: boolean;
  hasCounterLabel: boolean;
  stats: XRayStats | null;
  driftingParagraphs: number;
  labelAgreementRate?: number;
}

/** Cross-checks between the examiner and the measurements. Each conflict carries the numbers behind it. */
export function crossChecks(c: CrossCheckInput): ConflictRecord[] {
  const out: ConflictRecord[] = [];
  const ex = c.examiner;
  const score = (k: RubricKey) => ex?.dimensions.find((d) => d.key === k)?.medianScore;
  const frac = (x: number) => x / c.outOf;

  const evidence = score("evidence");
  if (evidence !== undefined && c.stats && c.stats.claimsTotal > 0 && frac(evidence) >= CROSS_CHECK.PRAISE_MIN && c.stats.orphanShare >= CROSS_CHECK.ORPHAN_SHARE_MIN) {
    out.push({
      id: "evidence_praised_but_orphans", type: "evidence_praised_but_orphans", dimension: "evidence",
      examinerSays: `Evidence ${evidence} out of ${c.outOf}`,
      measuredSays: `${c.stats.claimsOrphan} of ${c.stats.claimsTotal} claims have no linked evidence`,
      numbers: { examinerScore: evidence, orphanShare: round(c.stats.orphanShare), orphanCount: c.stats.claimsOrphan, claims: c.stats.claimsTotal },
    });
  }

  const coherence = score("coherence");
  if (coherence !== undefined && frac(coherence) >= CROSS_CHECK.PRAISE_MIN && c.driftingParagraphs >= CROSS_CHECK.DRIFT_PARAGRAPHS_MIN) {
    out.push({
      id: "coherence_praised_but_drift", type: "coherence_praised_but_drift", dimension: "coherence",
      examinerSays: `Coherence ${coherence} out of ${c.outOf}`,
      measuredSays: `${c.driftingParagraphs} paragraphs drift from the topic`,
      numbers: { examinerScore: coherence, driftingParagraphs: c.driftingParagraphs },
    });
  }

  if (ex && c.structureAvailable) {
    const counterScore = score("counter-argument")!;
    const absent = ex.runs.some((r) => r.dimensions["counter-argument"].absence);
    if (absent && c.hasCounterLabel) {
      out.push({
        id: "counter_absent_but_found", type: "counter_absent_but_found", dimension: "counter-argument",
        examinerSays: "No counter-argument in the essay", measuredSays: "The structure labels found a counterclaim or rebuttal",
        numbers: { examinerScore: counterScore },
      });
    }
    if (!absent && frac(counterScore) >= CROSS_CHECK.COUNTER_PRESENT_MIN && !c.hasCounterLabel) {
      out.push({
        id: "counter_present_but_none", type: "counter_present_but_none", dimension: "counter-argument",
        examinerSays: `Counter-argument ${counterScore} out of ${c.outOf}`, measuredSays: "The structure labels found no counterclaim",
        numbers: { examinerScore: counterScore },
      });
    }
  }

  if (c.labelAgreementRate !== undefined && c.labelAgreementRate < CROSS_CHECK.LABEL_AGREEMENT_FLOOR) {
    out.push({
      id: "structure_label_disagreement", type: "structure_label_disagreement", dimension: null,
      examinerSays: "n/a", measuredSays: `Structure label sources agree on ${(c.labelAgreementRate * 100).toFixed(0)}% of sentences (floor ${CROSS_CHECK.LABEL_AGREEMENT_FLOOR * 100}%)`,
      numbers: { labelAgreementRate: c.labelAgreementRate, floor: CROSS_CHECK.LABEL_AGREEMENT_FLOOR },
    });
  }
  return out;
}

const round = (x: number) => Math.round(x * 100) / 100;
