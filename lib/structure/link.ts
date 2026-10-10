/**
 * Stage C: claim-to-evidence map. Pure and deterministic given the same elements (and the same optional
 * embeddings). Every link is a *candidate*: a hypothesis with the signals that produced it. Strength is the
 * clamped sum of signals; no single weak signal (proximity, keyword overlap) can create a link on its own.
 *
 * Signal weights (support): proximity <= 0.40, discourse cue <= 0.35, order 0.10, lexical overlap <= 0.15,
 * semantic similarity <= 0.25 (optional), contrast cue in the supporter -0.15.
 */
import { MAX_LINKS_PER_TARGET, MIN_LINK_STRENGTH, MIN_RELEVANCE_STRENGTH, SEMANTIC_FLOOR, SEMANTIC_SPAN } from "./config.ts";
import { contentStems, hasCue, overlapCoefficient } from "./text.ts";
import type { ArgumentElement, ArgumentLink, LinkSignal, LinkType, SentenceNode } from "./types.ts";

export interface LinkingContext {
  sentences: SentenceNode[];
  elements: ArgumentElement[];
  /** Optional cosine similarity between two element ids; undefined when no embeddings are available. */
  similarity?: (aId: string, bId: string) => number | undefined;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

interface Geometry {
  sameParagraph: boolean;
  /** Sentences strictly between the two elements (same paragraph), or paragraphs apart (otherwise). */
  gap: number;
  /** True when `a` comes before `b` in reading order. */
  aFirst: boolean;
}

function geometry(a: ArgumentElement, b: ArgumentElement, ctx: LinkingContext): Geometry {
  const idx = new Map(ctx.sentences.map((s) => [s.id, s]));
  const aS = idx.get(a.sentenceIds[0])!;
  const aE = idx.get(a.sentenceIds[a.sentenceIds.length - 1])!;
  const bS = idx.get(b.sentenceIds[0])!;
  const bE = idx.get(b.sentenceIds[b.sentenceIds.length - 1])!;
  const aFirst = aE.index < bS.index;
  if (a.paragraphId === b.paragraphId) {
    const gap = aFirst ? bS.index - aE.index - 1 : aS.index - bE.index - 1;
    return { sameParagraph: true, gap: Math.max(0, gap), aFirst };
  }
  const pa = Number(a.paragraphId.slice(1));
  const pb = Number(b.paragraphId.slice(1));
  return { sameParagraph: false, gap: Math.abs(pa - pb), aFirst: pa < pb };
}

function proximitySignal(g: Geometry, max: number): LinkSignal {
  if (g.sameParagraph) {
    const v = max / (1 + 0.5 * g.gap);
    return { kind: "proximity", value: r3(v), detail: g.gap === 0 ? "adjacent sentences, same paragraph" : `${g.gap} sentence(s) apart, same paragraph` };
  }
  const v = g.gap === 1 ? max * 0.375 : max * 0.125;
  return { kind: "proximity", value: r3(v), detail: g.gap === 1 ? "adjacent paragraphs" : `${g.gap} paragraphs apart` };
}

function lexicalSignal(a: ArgumentElement, b: ArgumentElement, max: number): LinkSignal | undefined {
  const o = overlapCoefficient(contentStems(a.text), contentStems(b.text));
  const v = Math.min(max, (o / 0.5) * max);
  return v >= 0.01 ? { kind: "lexical_overlap", value: r3(v), detail: `content-word overlap ${r3(o)}` } : undefined;
}

function semanticSignal(a: ArgumentElement, b: ArgumentElement, ctx: LinkingContext, max: number): LinkSignal | undefined {
  const sim = ctx.similarity?.(a.id, b.id);
  if (sim === undefined) return undefined;
  const v = clamp01((sim - SEMANTIC_FLOOR) / SEMANTIC_SPAN) * max;
  return v >= 0.01 ? { kind: "semantic_similarity", value: r3(v), detail: `embedding cosine ${r3(sim)}` } : undefined;
}

function finish(type: LinkType, source: ArgumentElement, target: ArgumentElement, signals: LinkSignal[], min: number, needStructural: boolean): Omit<ArgumentLink, "id"> | null {
  const strength = r3(clamp01(signals.reduce((s, x) => s + x.value, 0)));
  const structural = signals.some((s) => (s.kind === "proximity" || s.kind === "discourse_cue") && s.value >= 0.1);
  if (strength < min || (needStructural && !structural)) return null;
  return {
    type,
    sourceId: source.id,
    targetId: target.id,
    status: "candidate",
    strength,
    signals,
    methods: [...new Set(signals.filter((s) => s.value > 0).map((s) => s.kind))],
  };
}

type Candidate = Omit<ArgumentLink, "id">;

/** evidence|premise -> claim|premise|rebuttal|counterclaim. */
function scoreSupport(support: ArgumentElement, claim: ArgumentElement, ctx: LinkingContext): Candidate | null {
  const g = geometry(support, claim, ctx);
  const signals: LinkSignal[] = [proximitySignal(g, 0.4)];
  const supportFirst = g.aFirst;
  if (!supportFirst) signals.push({ kind: "order", value: 0.1, detail: "support follows the claim" });
  else signals.push({ kind: "order", value: 0.03, detail: "support precedes the claim" });

  const own = hasCue(support.text, "example") ?? hasCue(support.text, "reason");
  const claimResult = supportFirst ? hasCue(claim.text, "result") : undefined;
  if (own) signals.push({ kind: "discourse_cue", value: own.fn === "example" ? 0.35 : 0.3, detail: `"${own.label}" in the supporting sentence` });
  else if (claimResult) signals.push({ kind: "discourse_cue", value: 0.3, detail: `"${claimResult.label}" in the claim, which follows the support` });
  if (hasCue(support.text, "contrast") && !own) signals.push({ kind: "contrast_penalty", value: -0.15, detail: "contrast cue in the supporting sentence suggests opposition, not support" });

  const lex = lexicalSignal(support, claim, 0.15);
  if (lex) signals.push(lex);
  const sem = semanticSignal(support, claim, ctx, 0.25);
  if (sem) signals.push(sem);
  return finish("supports", support, claim, signals, MIN_LINK_STRENGTH, true);
}

/** rebuttal -> counterclaim. */
function scoreRebuttal(rebuttal: ArgumentElement, counter: ArgumentElement, ctx: LinkingContext): Candidate | null {
  const g = geometry(counter, rebuttal, ctx); // a = counterclaim, b = rebuttal
  const signals: LinkSignal[] = [proximitySignal(g, 0.35)];
  if (g.aFirst) signals.push({ kind: "order", value: 0.15, detail: "rebuttal follows the counterclaim" });
  const contrast = hasCue(rebuttal.text, "contrast");
  if (contrast) signals.push({ kind: "discourse_cue", value: 0.35, detail: `"${contrast.label}" in the rebuttal` });
  const lex = lexicalSignal(rebuttal, counter, 0.15);
  if (lex) signals.push(lex);
  const sem = semanticSignal(rebuttal, counter, ctx, 0.25);
  if (sem) signals.push(sem);
  return finish("rebuts", rebuttal, counter, signals, MIN_LINK_STRENGTH, true);
}

/** counterclaim -> thesis|claim|premise it opposes. */
function scoreChallenge(counter: ArgumentElement, target: ArgumentElement, ctx: LinkingContext): Candidate | null {
  const g = geometry(target, counter, ctx);
  const signals: LinkSignal[] = [proximitySignal(g, 0.35)];
  if (g.aFirst) signals.push({ kind: "order", value: 0.15, detail: "counterclaim follows its target" });
  const concession = hasCue(counter.text, "concession");
  const contrast = hasCue(counter.text, "contrast");
  if (concession) signals.push({ kind: "discourse_cue", value: 0.35, detail: `"${concession.label}" introduces an opposing view` });
  else if (contrast) signals.push({ kind: "discourse_cue", value: 0.2, detail: `"${contrast.label}" in the counterclaim` });
  const lex = lexicalSignal(counter, target, 0.15);
  if (lex) signals.push(lex);
  const sem = semanticSignal(counter, target, ctx, 0.25);
  if (sem) signals.push(sem);
  return finish("challenges", counter, target, signals, MIN_LINK_STRENGTH, true);
}

/**
 * claim|premise|evidence -> thesis. Lexical overlap and (optional) semantic similarity are the main signals, so they
 * carry more weight than in other link types. Both are weak: wording can miss a paraphrase, and a shared phrase can
 * mislead. A relevance link is only a candidate; its absence does not show a claim is off-topic.
 */
function scoreRelevance(claim: ArgumentElement, thesis: ArgumentElement, ctx: LinkingContext): Candidate | null {
  const g = geometry(thesis, claim, ctx);
  const signals: LinkSignal[] = [];
  const o = overlapCoefficient(contentStems(claim.text), contentStems(thesis.text));
  const lexV = Math.min(0.45, (o / 0.5) * 0.45);
  if (lexV >= 0.01) signals.push({ kind: "lexical_overlap", value: r3(lexV), detail: `content-word overlap ${r3(o)}` });
  signals.push(proximitySignal(g, 0.2));
  if (g.aFirst) signals.push({ kind: "order", value: 0.05, detail: "claim follows the thesis" });
  const sem = semanticSignal(claim, thesis, ctx, 0.45);
  if (sem) signals.push(sem);
  return finish("relevant_to", claim, thesis, signals, MIN_RELEVANCE_STRENGTH, false);
}

function byStrength(a: Candidate, b: Candidate, order: Map<string, number>): number {
  return b.strength - a.strength || (order.get(a.sourceId)! - order.get(b.sourceId)!);
}

export function buildLinks(ctx: LinkingContext): ArgumentLink[] {
  const els = [...ctx.elements];
  const order = new Map(els.map((e, i) => [e.id, i]));
  const out: Candidate[] = [];
  const top = (cands: Candidate[], n: number) => cands.sort((a, b) => byStrength(a, b, order)).slice(0, n);

  const roleOf = (...roles: string[]) => els.filter((e) => roles.includes(e.role));
  const supporters = roleOf("evidence", "premise");
  const theses = roleOf("thesis");

  // Support: for each claim, premise, rebuttal or counterclaim, its best supporters. A premise is supported by
  // evidence in its own paragraph; a premise never supports itself or another premise.
  for (const claim of roleOf("claim", "premise", "rebuttal", "counterclaim")) {
    const cands: Candidate[] = [];
    for (const s of supporters) {
      if (s.id === claim.id) continue;
      if (claim.role === "premise" && (s.role === "premise" || s.paragraphId !== claim.paragraphId)) continue;
      if ((claim.role === "rebuttal" || claim.role === "counterclaim") && s.role === "premise" && s.paragraphId !== claim.paragraphId) continue;
      const c = scoreSupport(s, claim, ctx);
      if (c) cands.push(c);
    }
    out.push(...top(cands, MAX_LINKS_PER_TARGET));
  }

  // Rebuttal: for each counterclaim, its best answers.
  for (const counter of roleOf("counterclaim")) {
    const cands: Candidate[] = [];
    for (const r of roleOf("rebuttal")) {
      const c = scoreRebuttal(r, counter, ctx);
      if (c) cands.push(c);
    }
    out.push(...top(cands, MAX_LINKS_PER_TARGET));
  }

  // Challenge: each counterclaim opposes its single best-scoring thesis/claim/premise.
  for (const counter of roleOf("counterclaim")) {
    const cands: Candidate[] = [];
    for (const t of roleOf("thesis", "claim", "premise")) {
      const c = scoreChallenge(counter, t, ctx);
      if (c) cands.push(c);
    }
    out.push(...top(cands, 1));
  }

  // Relevance: each claim/premise/evidence to each thesis. Evidence is included so a support chain can carry relevance.
  for (const claim of roleOf("claim", "premise", "evidence")) {
    for (const t of theses) {
      const c = scoreRelevance(claim, t, ctx);
      if (c) out.push(c);
    }
  }

  const typeRank: Record<LinkType, number> = { supports: 0, challenges: 1, rebuts: 2, relevant_to: 3 };
  out.sort(
    (a, b) =>
      typeRank[a.type] - typeRank[b.type] ||
      order.get(a.targetId)! - order.get(b.targetId)! ||
      b.strength - a.strength ||
      order.get(a.sourceId)! - order.get(b.sourceId)!,
  );
  return out.map((l, i) => ({ id: `l${i + 1}`, ...l }));
}
