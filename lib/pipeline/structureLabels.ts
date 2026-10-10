import { LOW_MODEL_CONFIDENCE, type ArgumentRole, type StructureAnalysis } from "../structure/index.ts";
import type { SentenceLabel, SentenceLabelName, SentenceRef } from "./blend.types.ts";
import { splitSentences } from "./sentences.ts";
import type { TranscribedEssay } from "./transcribe.types.ts";

/** Sentence refs for every paragraph, from the shared splitter. Ids are "p3-s2". Vectors are filled in later. */
export function buildSentenceRefs(essay: Pick<TranscribedEssay, "paragraphs">): SentenceRef[] {
  return essay.paragraphs.flatMap((p) =>
    splitSentences(p.text).map((s, k) => ({ id: `${p.id}-s${k + 1}`, paragraphId: p.id, start: s.start, end: s.end, text: s.text })),
  );
}

/**
 * Role mapping from the structure module (lib/structure/types.ts) to X-Ray labels.
 * `premise` is a reason without concrete specifics and has no X-Ray label of its own, so it maps to Other.
 * There is no module role for Lead; Lead stays in the type for a future classifier.
 */
export const LABEL_FOR_ROLE: Record<ArgumentRole, SentenceLabelName> = {
  thesis: "Position",
  claim: "Claim",
  premise: "Other",
  evidence: "Evidence",
  counterclaim: "Counterclaim",
  rebuttal: "Rebuttal",
  conclusion: "Conclusion",
  other: "Other",
};

const collapse = (t: string) => t.replace(/\s+/g, " ").trim();

/**
 * Converts a StructureAnalysis to per-sentence labels on OUR sentence ids. The structure module splits the same
 * paragraphs with the same splitter, so sentence k of paragraph i lines up; this is checked on the text and
 * nothing is emitted for a paragraph that does not line up. Elements below LOW_MODEL_CONFIDENCE are ignored.
 */
export function labelsFromStructure(analysis: StructureAnalysis, essay: Pick<TranscribedEssay, "paragraphs">, refs: SentenceRef[]): { sentences: SentenceLabel[]; warnings: string[] } {
  const warnings: string[] = [];
  if (analysis.paragraphs.length !== essay.paragraphs.length) {
    return { sentences: [], warnings: ["Structure paragraphs did not line up with the transcript; structure labels were not used."] };
  }
  // structure sentence id -> our sentence id
  const ours = new Map<string, string>();
  analysis.paragraphs.forEach((sp, i) => {
    const mine = refs.filter((r) => r.paragraphId === essay.paragraphs[i].id);
    const theirs = analysis.sentences.filter((s) => s.paragraphId === sp.id).sort((a, b) => a.indexInParagraph - b.indexInParagraph);
    const aligned = theirs.length === mine.length && theirs.every((s, k) => collapse(s.text) === collapse(mine[k].text));
    if (!aligned) {
      warnings.push(`Structure sentences in paragraph ${i + 1} did not line up with the transcript; that paragraph was left unlabelled.`);
      return;
    }
    theirs.forEach((s, k) => ours.set(s.id, mine[k].id));
  });

  const out = new Map<string, SentenceLabel>();
  for (const el of analysis.argumentElements) {
    if (el.modelConfidence < LOW_MODEL_CONFIDENCE) continue;
    const label = LABEL_FOR_ROLE[el.role];
    for (const sid of el.sentenceIds) {
      const id = ours.get(sid);
      if (id && !out.has(id)) out.set(id, { sentenceId: id, label, source: "llm", confidence: el.modelConfidence });
    }
  }
  return { sentences: [...out.values()], warnings };
}
