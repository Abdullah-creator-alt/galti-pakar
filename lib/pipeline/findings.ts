import type { EssayAnalysis } from "./analyse.ts";
import type { BenchmarkResult } from "./benchmark.types.ts";
import { countCliches } from "./cliches.ts";
import type { MeasuredFindings, StructureLabel } from "./findings.types.ts";
import { LOW_MODEL_CONFIDENCE, type ArgumentRole, type StructureAnalysis } from "../structure/index.ts";
import type { TranscribedEssay } from "./transcribe.types.ts";

/** Adapters from earlier pipeline steps to MeasuredFindings. Each returns only the fields it can fill. */

export function findingsFromAnalysis(analysis: EssayAnalysis, essay: Pick<TranscribedEssay, "paragraphs" | "wordCount">): Pick<MeasuredFindings, "drift" | "genericness" | "rules"> {
  return {
    drift: analysis.paragraphs.map((p) => ({ paragraphId: p.id, relevance: p.relevance, drifts: p.driftFlag })),
    genericness: analysis.paragraphs.map((p) => {
      const count = (level: string) => p.sentences.filter((s) => s.level === level).length;
      return { paragraphId: p.id, avgGenericScore: p.avgGenericScore, generic: count("generic"), mixed: count("mixed"), specific: count("specific"), unassessed: count("unassessed") };
    }),
    rules: {
      wordCount: essay.wordCount,
      paragraphCount: essay.paragraphs.length,
      clicheHits: essay.paragraphs.reduce((n, p) => n + countCliches(p.text), 0),
      missingIntro: !essay.paragraphs.some((p) => p.kind === "intro"),
      missingConclusion: !essay.paragraphs.some((p) => p.kind === "conclusion"),
    },
  };
}

export function findingsFromBenchmark(r: BenchmarkResult): Pick<MeasuredFindings, "benchmark"> {
  return {
    benchmark: {
      missingPoints: r.coverage?.missing.map((m) => m.point) ?? [],
      profileGaps: r.profile.filter((p) => p.position !== "within").map((p) => `${p.label}: ${p.position} the reference range`),
    },
  };
}

/* ---------- structure analysis ---------- */

const collapse = (t: string) => t.replace(/\s+/g, " ").trim();

/**
 * The text handed to the structure module: paragraphs joined by a blank line, with newlines inside a paragraph
 * collapsed to spaces so the module's paragraph split cannot disagree with the transcript's.
 */
export function structureInputText(paragraphs: { text: string }[]): string {
  return paragraphs.map((p) => collapse(p.text)).join("\n\n");
}

/**
 * Role mapping for the examiner's paragraph-level view. `premise` and `other` are deliberately left out:
 * a premise is a reason without concrete specifics, and labelling it "Evidence" would let it veto a true
 * "no evidence" claim in absenceConflict.
 */
const LABEL_FOR_ROLE: Partial<Record<ArgumentRole, StructureLabel>> = {
  thesis: "Position",
  claim: "Claim",
  evidence: "Evidence",
  counterclaim: "Counter-argument",
  rebuttal: "Rebuttal",
  conclusion: "Conclusion",
};

/**
 * Maps the structure analysis' paragraph ids to the transcript's. Paragraph i is matched to paragraph i, and only if the
 * texts are equal ignoring whitespace; otherwise null, so nothing is ever attached to the wrong paragraph.
 */
export function alignStructureParagraphs(analysis: StructureAnalysis, essay: Pick<TranscribedEssay, "paragraphs">): Map<string, string> | null {
  const theirs = analysis.paragraphs;
  const ours = essay.paragraphs;
  const aligned = theirs.length === ours.length && theirs.every((p, i) => collapse(p.text) === collapse(ours[i].text));
  return aligned ? new Map(theirs.map((p, i) => [p.id, ours[i].id])) : null;
}

export interface StructureFindings {
  findings: Pick<MeasuredFindings, "structure" | "links">;
  warnings: string[];
}

/**
 * Paragraph-level view of a structure analysis for the examiner. Only elements the model labelled with at least
 * LOW_MODEL_CONFIDENCE are used. Structure paragraph i is matched to transcript paragraph i; if the texts do not
 * line up (ignoring whitespace) nothing is emitted, so labels are never attached to the wrong paragraph.
 * In `links`, `similarity` carries the link's heuristic `strength` (0-1): a candidate-link score, not a verified
 * relationship and not an embedding similarity.
 */
export function findingsFromStructure(analysis: StructureAnalysis, essay: Pick<TranscribedEssay, "paragraphs">): StructureFindings {
  const idFor = alignStructureParagraphs(analysis, essay);
  if (!idFor) return { findings: {}, warnings: ["Structure paragraphs did not line up with the transcript; structure findings were not used."] };
  const confident = analysis.argumentElements.filter((e) => e.modelConfidence >= LOW_MODEL_CONFIDENCE);

  const seen = new Set<string>();
  const structure: NonNullable<MeasuredFindings["structure"]> = [];
  for (const e of confident) {
    const label = LABEL_FOR_ROLE[e.role];
    const paragraphId = idFor.get(e.paragraphId);
    if (!label || !paragraphId || seen.has(`${paragraphId}|${label}`)) continue;
    seen.add(`${paragraphId}|${label}`);
    structure.push({ paragraphId, label });
  }

  const elementById = new Map(analysis.argumentElements.map((e) => [e.id, e]));
  const links: NonNullable<MeasuredFindings["links"]> = [];
  for (const claim of confident.filter((e) => e.role === "claim")) {
    const claimParagraphId = idFor.get(claim.paragraphId);
    if (!claimParagraphId) continue;
    const best = analysis.argumentLinks
      .filter((l) => l.type === "supports" && l.targetId === claim.id)
      .sort((a, b) => b.strength - a.strength)[0];
    const source = best && elementById.get(best.sourceId);
    const evidenceParagraphId = source && idFor.get(source.paragraphId);
    links.push(best && evidenceParagraphId ? { claimParagraphId, evidenceParagraphId, similarity: best.strength, orphan: false } : { claimParagraphId, similarity: 0, orphan: true });
  }
  return { findings: { structure, links }, warnings: [] };
}
