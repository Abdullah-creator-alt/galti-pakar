/**
 * Verify, blend, score. Plain code: builds the Argument X-Ray, verifies every finding, cross-checks the examiner
 * against the measurements, blends measured signals with the examiner's scores, and derives the overall score and
 * verdict. The only optional outside call is one batched embedding request for sentences or outline lines that
 * arrived without vectors. Everything it outputs is traceable to a rule and numbers.
 */
import { DRIFT_THRESHOLD } from "../config.ts";
import { bandForScore } from "../derive.ts";
import type { Band, DimensionScore, Paragraph, RubricKey } from "../types.ts";
import { BLEND_WEIGHT_MEASURED, CONFLICT_GAP, DIMENSION_WEIGHTS, LINK_STRONG, LINK_WEAK, EXPECTED_WORDS, VERDICT_THRESHOLDS } from "./blendConfig.ts";
import type { BlendInput, BlendedAnalysis, Confidence, ConflictRecord, DimensionTrace, SentenceRef } from "./blend.types.ts";
import { buildRankedIssues } from "./coachInput.ts";
import type { EmbedFn } from "./embed.ts";
import { RUBRIC_KEYS } from "./findings.types.ts";
import { measuredSignals } from "./measured.ts";
import { labelFor, SCALE_OUT_OF } from "./rubric.ts";
import { reportPartsSchema } from "./schema.ts";
import { crossChecks, recheckQuotes, verifySpans } from "./verifyFindings.ts";
import { normalize } from "./vecmath.ts";
import { buildSpans, colourSentences, essayFindings, findRebuttals, linkClaims, paragraphRole, paragraphSummary, xrayStats, type SentenceInfo } from "./xray.ts";

export interface BlendDeps {
  /** Used once, in one batch, for sentences/outline lines/paragraphs that have no vector. */
  embed?: EmbedFn;
  driftThreshold?: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, max: number) => Math.min(max, Math.max(0, x));

/** Verdict from an overall score and the scale. Same cut-offs as bandForScore; kept separate so they can be tuned. */
export function verdictFromScore(score: number, outOf: number): Band {
  const f = score / outOf;
  return f >= VERDICT_THRESHOLDS.competitive ? "competitive" : f >= VERDICT_THRESHOLDS.borderline ? "borderline" : "below-pass";
}

export function confidenceFor(args: { sources: number; unverified: boolean; runsDisagree: boolean; conflicts: number; lowReason?: string }): { level: Confidence; reasons: string[] } {
  const reasons: string[] = [];
  let level = 2;
  if (args.sources === 0) { level = 0; reasons.push("no data"); }
  else if (args.sources < 2) { level = Math.min(level, 1); reasons.push("only one source of evidence"); }
  if (args.unverified) { level--; reasons.push("the examiner's evidence could not be verified"); }
  if (args.runsDisagree) { level--; reasons.push("examiner runs disagree"); }
  if (args.conflicts > 0) { level--; reasons.push(`${args.conflicts} conflict${args.conflicts > 1 ? "s" : ""} between examiner and measurements`); }
  if (args.lowReason) { level = 0; reasons.push(args.lowReason); }
  return { level: (["low", "medium", "high"] as const)[Math.max(0, Math.min(2, level))], reasons };
}

export async function blendAnalysis(input: BlendInput, deps: BlendDeps = {}): Promise<BlendedAnalysis> {
  const warnings: string[] = [];
  const outOf = SCALE_OUT_OF;
  const driftThreshold = deps.driftThreshold ?? DRIFT_THRESHOLD;
  const { essay, analysis, examiner } = input;
  const paragraphs = essay.paragraphs;
  const pIndex = new Map(paragraphs.map((p, i) => [p.id, i]));

  const labels = new Map((input.structure?.sentences ?? []).map((l) => [l.sentenceId, l]));
  const structureAvailable = !!input.structure;
  if (!structureAvailable) warnings.push("structure labels unavailable: X-Ray limited");
  if (!analysis) warnings.push("drift and genericness unavailable: those colours and signals were skipped");
  if (!examiner) warnings.push("examiner second opinion unavailable: scores are measured-only");

  /* ---- vectors: embed only what is missing, in one batch ---- */
  const refs: SentenceRef[] = input.sentences.map((s) => ({ ...s }));
  const idxInPara = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const r of refs) { const k = counts.get(r.paragraphId) ?? 0; idxInPara.set(r.id, k); counts.set(r.paragraphId, k + 1); }

  const needsVec = (i: number) => {
    const l = labels.get(refs[i].id)?.label;
    const prev = i > 0 && refs[i - 1].paragraphId === refs[i].paragraphId ? labels.get(refs[i - 1].id)?.label : undefined;
    return l === "Claim" || l === "Position" || l === "Evidence" || prev === "Claim";
  };
  const embedSentences = refs.map((r, i) => (!r.vec && structureAvailable && needsVec(i) ? i : -1)).filter((i) => i >= 0);
  const wantOutline = essay.outline.length > 0 && !input.outlineVecs;
  const paraFull = paragraphs.map((p) => refs.filter((r) => r.paragraphId === p.id).every((r) => r.vec));
  const embedParas = essay.outline.length > 0 ? paragraphs.map((_, i) => i).filter((i) => !paraFull[i]) : [];
  let outlineVecs = input.outlineVecs;
  const paraVecOverride = new Map<number, number[]>();
  const texts = [...embedSentences.map((i) => refs[i].text), ...(wantOutline ? essay.outline : []), ...embedParas.map((i) => paragraphs[i].text)];
  if (texts.length) {
    if (!deps.embed) warnings.push("embeddings unavailable: sentences, outline or paragraphs without vectors were not compared");
    else {
      const vecs = await deps.embed(texts);
      if (vecs.length !== texts.length) throw new Error(`Embedding returned ${vecs.length} vectors for ${texts.length} texts.`);
      let k = 0;
      for (const i of embedSentences) refs[i].vec = vecs[k++];
      if (wantOutline) { outlineVecs = vecs.slice(k, k + essay.outline.length); k += essay.outline.length; }
      for (const i of embedParas) paraVecOverride.set(i, vecs[k++]);
    }
  }
  const paragraphVecs = paragraphs.map((p, i) => {
    if (paraVecOverride.has(i)) return paraVecOverride.get(i);
    const vs = refs.filter((r) => r.paragraphId === p.id && r.vec).map((r) => r.vec!);
    return vs.length && vs.length === refs.filter((r) => r.paragraphId === p.id).length ? normalize(vs[0].map((_, d) => vs.reduce((s, v) => s + v[d], 0))) : undefined;
  });

  /* ---- genericness and relevance lookups ---- */
  const relevance = new Map<string, number>((analysis?.paragraphs ?? []).map((p) => [p.id, p.relevance]));
  const generic = new Map<string, { level: SentenceInfo["genericLevel"]; score: number | null; codes: string[] }>();
  for (const p of analysis?.paragraphs ?? []) for (const s of p.sentences) generic.set(`${p.id}:${s.start}:${s.end}`, { level: s.level, score: s.genericScore, codes: s.reasonCodes });

  const infos: SentenceInfo[] = refs.map((ref) => {
    const g = generic.get(`${ref.paragraphId}:${ref.start}:${ref.end}`);
    return {
      ref,
      paragraphIndex: pIndex.get(ref.paragraphId) ?? 0,
      indexInParagraph: idxInPara.get(ref.id) ?? 0,
      label: labels.get(ref.id),
      ...(g ? { genericLevel: g.level, genericScore: g.score, genericCodes: g.codes } : {}),
    };
  });

  /* ---- X-Ray ---- */
  const linkable = infos.filter((i) => i.label && ["Claim", "Position", "Evidence"].includes(i.label.label));
  const linksAvailable = structureAvailable && linkable.every((i) => i.ref.vec);
  if (structureAvailable && !linksAvailable) warnings.push("sentence vectors unavailable: claim-to-evidence linking skipped");
  const thresholds = { strong: LINK_STRONG, weak: LINK_WEAK };
  const links = linksAvailable ? linkClaims(infos, thresholds) : [];
  const counters = structureAvailable ? findRebuttals(infos) : [];
  const stats = linksAvailable ? xrayStats(links, counters) : null;
  const kinds = paragraphs.map((p) => p.kind);
  const findings = essayFindings(infos, kinds, structureAvailable);

  const colours = colourSentences(infos, { structureAvailable, linksAvailable, links, counters, relevance, driftThreshold, thresholds });
  const proposed = buildSpans(colours);
  const { valid, dropped } = verifySpans(proposed, paragraphs.map((p) => ({ id: p.id, text: p.text })), refs);
  for (const d of dropped) warnings.push(`Dropped an invalid span in ${d.span.paragraphId}: ${d.why}`);

  if (essay.wordCount < EXPECTED_WORDS.min || essay.wordCount > EXPECTED_WORDS.max) {
    warnings.push(`Essay length ${essay.wordCount} words is outside the expected ${EXPECTED_WORDS.min}-${EXPECTED_WORDS.max} (warning only; scores are unchanged)`);
  }

  /* ---- paragraphs ---- */
  if (!analysis) warnings.push("relevance unavailable: paragraph relevance defaulted to 100");
  const outParagraphs: Paragraph[] = paragraphs.map((p) => {
    const ps = colours.filter((c) => c.info.ref.paragraphId === p.id);
    const role = paragraphRole(ps.map((c) => c.info.label?.label), p.kind);
    const rel = relevance.get(p.id);
    return {
      id: p.id,
      text: p.text,
      role,
      relevance: Math.round(rel ?? 100),
      summary: paragraphSummary(role, ps, rel, driftThreshold),
      spans: valid.filter((s) => s.paragraphId === p.id).map((s) => ({ start: s.start, end: s.end, tone: s.tone, reason: s.reason })),
    };
  });

  /* ---- examiner cross-checks ---- */
  const sources = [...paragraphs.map((p) => ({ id: p.id, text: p.text })), ...(essay.outline.length ? [{ id: "outline", text: essay.outline.join("\n") }] : [])];
  const quotes = examiner ? recheckQuotes(examiner, sources) : null;
  const driftingParagraphs = [...relevance.values()].filter((r) => r < driftThreshold).length;
  const conflicts: ConflictRecord[] = crossChecks({
    examiner, outOf, structureAvailable,
    hasCounterLabel: infos.some((i) => i.label?.label === "Counterclaim" || i.label?.label === "Rebuttal"),
    stats, driftingParagraphs, labelAgreementRate: input.structure?.labelAgreementRate,
  });

  /* ---- measured signals and blend ---- */
  const measured = measuredSignals({ essay, outOf, infos, analysis, structureAvailable, linksAvailable, stats, counters, relevance, driftThreshold, outlineVecs, paragraphVecs });
  const dimensions: DimensionScore[] = [];
  const dimensionTrace: DimensionTrace[] = [];

  for (const key of RUBRIC_KEYS) {
    const m = measured[key];
    const exDim = examiner?.dimensions.find((d) => d.key === key);
    const e = exDim?.medianScore ?? null;
    const mv = m.value === null ? null : clamp(m.value, outOf);
    const w = BLEND_WEIGHT_MEASURED[key];
    const flags: string[] = [];
    let mode: DimensionTrace["mode"];
    let final: number;
    if (mv !== null && e !== null) { mode = "blended"; final = w * mv + (1 - w) * e; }
    else if (e !== null) { mode = "examiner-only"; final = e; flags.push("examiner-only"); }
    else if (mv !== null) { mode = "measured-only"; final = mv; flags.push("measured-only"); }
    else { mode = "measured-only"; final = 0; flags.push("no-data"); warnings.push(`No data for ${labelFor(key)}; scored 0 (not assessed).`); }
    final = round1(clamp(final, outOf));

    if (mv !== null && e !== null && Math.abs(mv - e) >= CONFLICT_GAP * outOf) {
      conflicts.push({
        id: `score_gap:${key}`, type: "score_gap", dimension: key,
        examinerSays: `${labelFor(key)} ${e} out of ${outOf}`, measuredSays: `${m.explanation} (measured ${round1(mv)} out of ${outOf})`,
        numbers: { examinerScore: e, measuredScore: round1(mv), gap: round1(Math.abs(mv - e)), allowedGap: CONFLICT_GAP * outOf },
      });
    }
    const myConflicts = conflicts.filter((c) => c.dimension === key).length + (examiner?.conflicts.filter((c) => c.key === key).length ?? 0);
    if (myConflicts) flags.push("conflict");
    if (exDim?.flags.unverified) flags.push("unverified");
    if (exDim?.flags.runsDisagree) flags.push("runs-disagree");

    const conf = confidenceFor({
      sources: (mv !== null ? 1 : 0) + (e !== null ? 1 : 0),
      unverified: !!exDim?.flags.unverified, runsDisagree: !!exDim?.flags.runsDisagree, conflicts: myConflicts, lowReason: m.lowConfidenceReason,
    });

    // Note: the examiner's reason when its evidence was verified, otherwise the measured explanation.
    const goodQuotes = quotes?.valid.get(key)?.length ?? 0;
    const absenceOk = !!examiner?.runs.some((r) => r.dimensions[key].absence) && !exDim?.flags.conflict;
    const examinerTrusted = !!exDim && !exDim.flags.unverified && (goodQuotes > 0 || absenceOk);
    let note = examinerTrusted ? exDim!.reasons[0] : m.value !== null ? m.explanation : exDim?.reasons[0] ?? "Not assessed (no data).";
    if (note.length > 200) note = note.slice(0, 197) + "...";
    if (conf.level === "low") note += ` Low confidence: ${conf.reasons.slice(0, 2).join("; ")}.`;

    dimensions.push({ key, label: labelFor(key), score: final, outOf, band: bandForScore(final, outOf), note });
    dimensionTrace.push({
      key, measured: mv === null ? null : round1(mv), measuredComponents: m.components, measuredExplanation: m.explanation,
      examiner: e, final, weightMeasured: w, mode, confidence: conf.level, confidenceReasons: conf.reasons, flags,
    });
  }

  const wSum = RUBRIC_KEYS.reduce((s, k) => s + DIMENSION_WEIGHTS[k], 0);
  const overallScore = round1(dimensions.reduce((s, d) => s + DIMENSION_WEIGHTS[d.key] * d.score, 0) / wSum);

  /* ---- hand-off ---- */
  const { issues, weakestParagraphId } = buildRankedIssues(colours, findings, paragraphs.map((p) => p.id));
  const conflictsByType: BlendedAnalysis["metrics"]["conflictsByType"] = {};
  for (const c of conflicts) conflictsByType[c.type] = (conflictsByType[c.type] ?? 0) + 1;

  // Final check against the report schema: a malformed result must never reach the UI.
  const reportParts = reportPartsSchema.parse({
    topic: input.topic,
    wordCount: essay.wordCount,
    overallScore,
    overallOutOf: outOf,
    verdict: verdictFromScore(overallScore, outOf),
    dimensions,
    paragraphs: outParagraphs,
    driftThreshold,
    examiners: examiner?.examiners ?? [],
  });

  return {
    reportParts,
    trace: valid.map((s) => s.trace),
    dimensionTrace,
    links,
    counters,
    xray: stats,
    conflicts,
    labels: [...labels.values()],
    rankedIssues: issues,
    weakestParagraphId,
    metrics: {
      spansProposed: proposed.length,
      spansDropped: dropped.length,
      quotesProposed: examiner?.quotesProposed ?? 0,
      quotesVerified: examiner?.quotesVerified ?? 0,
      quotesRejected: examiner?.quotesRejected ?? 0,
      quotesRecheckFailed: quotes?.failed ?? 0,
      conflictsByType,
      claimsTotal: stats?.claimsTotal ?? 0,
      claimsStrong: stats?.claimsStrong ?? 0,
      claimsWeak: stats?.claimsWeak ?? 0,
      claimsOrphan: stats?.claimsOrphan ?? 0,
      ...(input.structure?.labelAgreementRate !== undefined ? { labelAgreementRate: input.structure.labelAgreementRate } : {}),
      ...(examiner && examiner.agreement.total ? { examinerAgreementRate: examiner.agreement.agreedCount / examiner.agreement.total } : {}),
    },
    warnings,
  };
}
