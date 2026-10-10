/**
 * Stage D: transparent structural diagnostics from the extracted elements and candidate links.
 * Each rule is a small pure function; findings are observations for later review, never verdicts.
 * A missing rebuttal is only reported when a counterclaim exists, and absence of a link means "no
 * identifiable candidate in this essay", not "the claim is false". Deterministic: same input, same output.
 */
import { AMBIGUOUS_MODEL_CONFIDENCE, LOW_MODEL_CONFIDENCE, WEAK_SUPPORT_STRENGTH } from "./config.ts";
import type {
  ArgumentElement,
  ArgumentLink,
  ParagraphNode,
  ReviewCategory,
  StructuralFinding,
  StructuralFindingType,
  SuggestedSeverity,
} from "./types.ts";

export interface DiagnosisInput {
  paragraphs: ParagraphNode[];
  elements: ArgumentElement[];
  links: ArgumentLink[];
  /** True when an embedding comparison was available to the linker. Only changes the wording of one finding. */
  semanticChecked?: boolean;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const BASE_SEVERITY: Record<StructuralFindingType, SuggestedSeverity> = {
  potential_orphan_claim: "medium",
  potentially_unsupported_reasoning: "low",
  unanswered_counterclaim: "medium",
  missing_thesis: "high",
  missing_conclusion: "medium",
  weak_thesis_connection: "low",
  uncertain_classification: "info",
};

const CATEGORY: Record<StructuralFindingType, ReviewCategory> = {
  potential_orphan_claim: "evidence",
  potentially_unsupported_reasoning: "evidence",
  unanswered_counterclaim: "counterargument",
  missing_thesis: "thesis",
  missing_conclusion: "organization",
  weak_thesis_connection: "thesis",
  uncertain_classification: "classification",
};

const SEVERITY_ORDER: SuggestedSeverity[] = ["info", "low", "medium", "high"];

/** Findings the analysis itself is unsure about are suggested one level lower (never below "info"). */
function severityFor(type: StructuralFindingType, confidence: number): SuggestedSeverity {
  const base = SEVERITY_ORDER.indexOf(BASE_SEVERITY[type]);
  return SEVERITY_ORDER[Math.max(0, confidence < 0.5 ? base - 1 : base)];
}

type Draft = Omit<StructuralFinding, "id" | "suggestedSeverity" | "reviewCategory">;

const confident = (e: ArgumentElement) => e.modelConfidence >= LOW_MODEL_CONFIDENCE;

export function diagnose(input: DiagnosisInput): StructuralFinding[] {
  const { paragraphs, elements, links } = input;
  const drafts: { type: StructuralFindingType; draft: Draft }[] = [];
  const add = (type: StructuralFindingType, draft: Draft) => drafts.push({ type, draft });
  const hasEvidenceElements = elements.some((e) => e.role === "evidence" || e.role === "premise");
  const confidentTheses = elements.filter((e) => e.role === "thesis" && confident(e));
  const firstParagraph = paragraphs[0];
  const lastParagraph = paragraphs[paragraphs.length - 1];

  // 1. Missing thesis.
  if (confidentTheses.length === 0 && firstParagraph) {
    const weak = elements.filter((e) => e.role === "thesis");
    add("missing_thesis", {
      type: "missing_thesis",
      reasonCode: weak.length ? "THESIS_LOW_MODEL_CONFIDENCE" : "NO_THESIS_ELEMENT",
      description: weak.length
        ? "A possible thesis was found but the model was not confident enough to treat it as the central position."
        : "No clear central position was identified in the essay.",
      paragraphIds: [firstParagraph.id],
      sentenceIds: weak.flatMap((e) => e.sentenceIds),
      elementIds: weak.map((e) => e.id),
      linkIds: [],
      confidence: r2(weak.length ? 0.55 : elements.some((e) => e.role === "claim") ? 0.75 : 0.6),
    });
  }

  // 2. Orphan claims and 3. weakly supported claims.
  for (const claim of elements.filter((e) => e.role === "claim")) {
    const support = links.filter((l) => l.type === "supports" && l.targetId === claim.id);
    if (support.length === 0) {
      add("potential_orphan_claim", {
        type: "potential_orphan_claim",
        reasonCode: "CLAIM_NO_CANDIDATE_EVIDENCE",
        description: "No supporting evidence or reasoning was identified for this claim. It may be supported implicitly or elsewhere.",
        paragraphIds: [claim.paragraphId],
        sentenceIds: claim.sentenceIds,
        elementIds: [claim.id],
        linkIds: [],
        confidence: r2(claim.modelConfidence * (hasEvidenceElements ? 0.8 : 0.9)),
      });
      continue;
    }
    const best = Math.max(...support.map((l) => l.strength));
    // A weak direct link is not "unsupported" when it comes from a premise that is itself backed by a solid
    // candidate link (claim <- premise <- evidence): there is a candidate support chain.
    const chained = support.some((l) => {
      const src = elements.find((e) => e.id === l.sourceId);
      return src?.role === "premise" && links.some((x) => x.type === "supports" && x.targetId === src.id && x.strength >= WEAK_SUPPORT_STRENGTH);
    });
    if (best < WEAK_SUPPORT_STRENGTH && !chained) {
      add("potentially_unsupported_reasoning", {
        type: "potentially_unsupported_reasoning",
        reasonCode: "CLAIM_ONLY_WEAK_SUPPORT_SIGNALS",
        description: "Candidate support exists but rests only on weak structural signals such as nearness, so the support is uncertain.",
        paragraphIds: [...new Set([claim.paragraphId, ...support.map((l) => elements.find((e) => e.id === l.sourceId)!.paragraphId)])],
        sentenceIds: [...new Set([...claim.sentenceIds, ...support.flatMap((l) => elements.find((e) => e.id === l.sourceId)!.sentenceIds)])],
        elementIds: [claim.id, ...support.map((l) => l.sourceId)],
        linkIds: support.map((l) => l.id),
        confidence: r2(clamp01(0.5 * claim.modelConfidence + 0.5 * (1 - best / WEAK_SUPPORT_STRENGTH))),
      });
    }
  }

  // 4. Unanswered counterclaims (only when the essay raises one).
  for (const counter of elements.filter((e) => e.role === "counterclaim")) {
    if (links.some((l) => l.type === "rebuts" && l.targetId === counter.id)) continue;
    add("unanswered_counterclaim", {
      type: "unanswered_counterclaim",
      reasonCode: "COUNTERCLAIM_NO_CANDIDATE_REBUTTAL",
      description: "An opposing view is raised but no response to it was identified.",
      paragraphIds: [counter.paragraphId],
      sentenceIds: counter.sentenceIds,
      elementIds: [counter.id],
      linkIds: links.filter((l) => l.type === "challenges" && l.sourceId === counter.id).map((l) => l.id),
      confidence: r2(counter.modelConfidence * 0.85),
    });
  }

  // 5. Missing conclusion.
  if (!elements.some((e) => e.role === "conclusion" && confident(e)) && lastParagraph) {
    const weak = elements.filter((e) => e.role === "conclusion");
    add("missing_conclusion", {
      type: "missing_conclusion",
      reasonCode: weak.length ? "CONCLUSION_LOW_MODEL_CONFIDENCE" : "NO_CONCLUSION_ELEMENT",
      description: weak.length
        ? "A possible conclusion was found but the model was not confident enough to treat it as one."
        : "No clear concluding element was identified.",
      paragraphIds: [lastParagraph.id],
      sentenceIds: weak.flatMap((e) => e.sentenceIds),
      elementIds: weak.map((e) => e.id),
      linkIds: [],
      confidence: r2(paragraphs.length >= 2 ? 0.7 : 0.5),
    });
  }

  // 6. Claims with no identifiable tie to a confident thesis. This is an "unconfirmed relevance" observation, not
  // a verdict of irrelevance: wording overlap misses paraphrases, and embeddings only add weak positive evidence.
  // A claim is NOT reported when the graph gives a candidate connection: a direct relevant_to link, or a premise or
  // evidence element that supports the claim and is itself linked to the thesis (an indirect chain).
  if (confidentTheses.length > 0) {
    const thesisIds = new Set(confidentTheses.map((t) => t.id));
    const tiedToThesis = (id: string) => links.some((l) => l.type === "relevant_to" && l.sourceId === id && thesisIds.has(l.targetId));
    const checked = input.semanticChecked
      ? "Wording, nearness, support links and an embedding comparison found no tie"
      : "Wording, nearness and support links found no tie (no embedding comparison ran)";
    for (const claim of elements.filter((e) => e.role === "claim")) {
      if (tiedToThesis(claim.id)) continue;
      const supporters = links.filter((l) => l.type === "supports" && l.targetId === claim.id);
      if (supporters.some((l) => tiedToThesis(l.sourceId))) continue;
      add("weak_thesis_connection", {
        type: "weak_thesis_connection",
        reasonCode: "CLAIM_NO_THESIS_RELEVANCE_SIGNAL",
        description: `${checked}. This does not show the claim is off-topic; a paraphrase or implicit link may be missed.`,
        paragraphIds: [claim.paragraphId],
        sentenceIds: claim.sentenceIds,
        elementIds: [claim.id, ...confidentTheses.map((t) => t.id)],
        linkIds: supporters.map((l) => l.id),
        // Capped well below the model's own confidence: neither wording nor embeddings can establish irrelevance.
        confidence: r2(Math.min(0.35, claim.modelConfidence * 0.35)),
      });
    }
  }

  // 7. Elements whose role the model was unsure about.
  for (const el of elements) {
    let reasonCode: string | undefined;
    let confidence = 0;
    if (el.role === "other") {
      reasonCode = "ELEMENT_ROLE_OTHER";
      confidence = 0.9;
    } else if (!confident(el)) {
      reasonCode = "ELEMENT_LOW_MODEL_CONFIDENCE";
      confidence = 1 - el.modelConfidence;
    } else if (el.alternativeRole && el.modelConfidence < AMBIGUOUS_MODEL_CONFIDENCE) {
      reasonCode = "ELEMENT_AMBIGUOUS_ROLE";
      confidence = 0.6;
    }
    if (!reasonCode) continue;
    add("uncertain_classification", {
      type: "uncertain_classification",
      reasonCode,
      description: `The role of this passage (${el.role}${el.alternativeRole ? `, possibly ${el.alternativeRole}` : ""}) is uncertain.`,
      paragraphIds: [el.paragraphId],
      sentenceIds: el.sentenceIds,
      elementIds: [el.id],
      linkIds: [],
      confidence: r2(confidence),
    });
  }

  return drafts.map(({ type, draft }, i) => ({
    id: `f${i + 1}`,
    ...draft,
    suggestedSeverity: severityFor(type, draft.confidence),
    reviewCategory: CATEGORY[type],
  }));
}
