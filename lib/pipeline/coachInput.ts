/** Hand-off to the coach step: ranked issues and the weakest paragraph, picked by code (the LLM does not choose). */
import type { RubricKey } from "../types.ts";
import { DIMENSION_WEIGHTS, ISSUE_DIMENSION, ISSUE_SEVERITY } from "./blendConfig.ts";
import type { IssueType, RankedIssue } from "./blend.types.ts";
import type { EssayFinding, SentenceColour } from "./xray.ts";

const ISSUE_FOR_RULE: Record<string, IssueType> = {
  off_topic_paragraph: "drift",
  orphan_claim: "orphan_claim",
  weak_link_claim: "weak_link_claim",
  unrebutted_counterclaim: "unrebutted_counterclaim",
  generic_sentence: "generic",
  generic_evidence: "generic",
};

/** Dimension weight scaled so equal weights give 1. */
function weightOf(key: RubricKey): number {
  const ws = Object.values(DIMENSION_WEIGHTS);
  return DIMENSION_WEIGHTS[key] / (ws.reduce((a, b) => a + b, 0) / ws.length);
}

export function impactOf(type: IssueType, count: number): number {
  return ISSUE_SEVERITY[type] * weightOf(ISSUE_DIMENSION[type]) * count;
}

export function buildRankedIssues(colours: SentenceColour[], findings: EssayFinding[], paragraphIds: string[]): { issues: RankedIssue[]; weakestParagraphId: string | null } {
  const groups = new Map<string, RankedIssue>();
  for (const c of colours) {
    for (const rule of c.ruleIds) {
      const type = ISSUE_FOR_RULE[rule];
      if (!type) continue;
      const key = `${type}|${c.info.ref.paragraphId}`;
      let issue = groups.get(key);
      if (!issue) {
        issue = { id: key, type, paragraphId: c.info.ref.paragraphId, sentenceIds: [], sentences: [], severity: ISSUE_SEVERITY[type], dimension: ISSUE_DIMENSION[type], impact: 0, count: 0, numbers: {} };
        groups.set(key, issue);
      }
      issue.sentenceIds.push(c.info.ref.id);
      issue.sentences.push({ id: c.info.ref.id, text: c.info.ref.text });
      issue.count++;
      const t = c.trace;
      if (t.relevance !== null && t.relevance !== undefined) issue.numbers.relevance = Math.round(t.relevance);
      if (t.similarity !== undefined) issue.numbers.bestSimilarity = t.similarity;
      if (c.info.genericScore !== undefined && c.info.genericScore !== null && type === "generic") issue.numbers.genericScore = Math.round(c.info.genericScore * 100) / 100;
    }
  }
  const issues: RankedIssue[] = [...groups.values()];
  for (const f of findings) {
    issues.push({ id: `${f.type}|essay`, type: f.type, paragraphId: null, sentenceIds: [], sentences: [], severity: ISSUE_SEVERITY[f.type], dimension: ISSUE_DIMENSION[f.type], impact: 0, count: 1, numbers: {} });
  }
  for (const i of issues) {
    i.impact = Math.round(impactOf(i.type, i.count) * 100) / 100;
    i.numbers.count = i.count;
  }
  issues.sort((a, b) => b.impact - a.impact || b.severity - a.severity || a.id.localeCompare(b.id));

  const perParagraph = new Map<string, number>();
  for (const i of issues) if (i.paragraphId) perParagraph.set(i.paragraphId, (perParagraph.get(i.paragraphId) ?? 0) + i.impact);
  let weakest: string | null = null;
  let best = -1;
  for (const id of paragraphIds) {
    const v = perParagraph.get(id) ?? 0;
    if (v > best) { best = v; weakest = id; }
  }
  return { issues, weakestParagraphId: best > 0 ? weakest : null };
}
