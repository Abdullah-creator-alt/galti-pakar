/**
 * Compares two analyses of the SAME text (for example a live-model run against the hand-labelled baseline).
 * Pure and offline. It reports differences; it does not decide which run is right.
 */
import type { StructureAnalysis } from "./types.ts";

export interface SentenceRoleRow {
  sentenceId: string;
  text: string;
  baseline: string | null;
  candidate: string | null;
  kind: "agree" | "role_differs" | "missed_by_candidate" | "extra_in_candidate";
}

export interface RunComparison {
  sentences: SentenceRoleRow[];
  counts: { agree: number; roleDiffers: number; missedByCandidate: number; extraInCandidate: number; labelledByEither: number };
  /** `type: roleFirstSentence -> roleFirstSentence` keys, using sentence ids so runs line up. */
  links: { shared: string[]; onlyBaseline: string[]; onlyCandidate: string[] };
  findings: { shared: string[]; onlyBaseline: string[]; onlyCandidate: string[] };
}

function roleBySentence(a: StructureAnalysis): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of a.argumentElements) for (const id of e.sentenceIds) m.set(id, e.role);
  return m;
}

function linkKeys(a: StructureAnalysis): string[] {
  const el = new Map(a.argumentElements.map((e) => [e.id, e]));
  return a.argumentLinks.map((l) => `${l.type}: ${el.get(l.sourceId)!.sentenceIds[0]} -> ${el.get(l.targetId)!.sentenceIds[0]}`);
}

function findingKeys(a: StructureAnalysis): string[] {
  return a.structuralFindings.map((f) => `${f.type}: ${f.sentenceIds.join(",") || f.paragraphIds.join(",")}`);
}

const diff = (base: string[], cand: string[]) => {
  const b = new Set(base);
  const c = new Set(cand);
  return { shared: base.filter((x) => c.has(x)), onlyBaseline: base.filter((x) => !c.has(x)), onlyCandidate: cand.filter((x) => !b.has(x)) };
};

export function compareRuns(baseline: StructureAnalysis, candidate: StructureAnalysis): RunComparison {
  if (baseline.sentences.length !== candidate.sentences.length || baseline.sentences.some((s, i) => s.text !== candidate.sentences[i].text))
    throw new Error("compareRuns needs analyses of identical text");
  const b = roleBySentence(baseline);
  const c = roleBySentence(candidate);
  const rows: SentenceRoleRow[] = [];
  for (const s of baseline.sentences) {
    const br = b.get(s.id) ?? null;
    const cr = c.get(s.id) ?? null;
    if (!br && !cr) continue;
    const kind = br && cr ? (br === cr ? "agree" : "role_differs") : br ? "missed_by_candidate" : "extra_in_candidate";
    rows.push({ sentenceId: s.id, text: s.text.slice(0, 60), baseline: br, candidate: cr, kind });
  }
  const n = (k: SentenceRoleRow["kind"]) => rows.filter((r) => r.kind === k).length;
  return {
    sentences: rows,
    counts: { agree: n("agree"), roleDiffers: n("role_differs"), missedByCandidate: n("missed_by_candidate"), extraInCandidate: n("extra_in_candidate"), labelledByEither: rows.length },
    links: diff(linkKeys(baseline), linkKeys(candidate)),
    findings: diff(findingKeys(baseline), findingKeys(candidate)),
  };
}
