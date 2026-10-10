import type {
  Band,
  EssayReport,
  ExaminerResult,
  Paragraph,
  ParagraphRole,
  RubricKey,
  Tone,
} from "./types.ts";

export const BAND_LABEL: Record<Band, string> = {
  competitive: "Competitive",
  borderline: "Borderline",
  "below-pass": "Below pass",
};

const BAND_RANK: Record<Band, number> = { "below-pass": 0, borderline: 1, competitive: 2 };

/** The one place a score becomes a band. */
export function bandForScore(score: number, outOf: number): Band {
  const ratio = score / outOf;
  if (ratio >= 0.7) return "competitive";
  if (ratio >= 0.5) return "borderline";
  return "below-pass";
}

export function driftingParagraphs(paragraphs: Paragraph[], threshold: number): Paragraph[] {
  return paragraphs.filter((p) => p.relevance < threshold);
}

export const EXPECTED_ROLES: ParagraphRole[] = [
  "position",
  "claim",
  "evidence",
  "counter-argument",
  "conclusion",
];

export function missingRoles(paragraphs: Paragraph[]): ParagraphRole[] {
  const present = new Set(paragraphs.map((p) => p.role));
  return EXPECTED_ROLES.filter((r) => !present.has(r));
}

export interface Agreement {
  /** Examiners sharing the most common overall band. */
  modalCount: number;
  total: number;
  /** Dimensions where the examiners' bands are not all identical. */
  differing: RubricKey[];
  agree: boolean;
  /** Maps to the stat-tile icon: tick, clock or dash. */
  state: "ok" | "partial" | "absent";
  /** Lowest and highest overall band across examiners. */
  range: [Band, Band];
}

export function examinerAgreement(examiners: ExaminerResult[]): Agreement {
  const total = examiners.length;
  if (total === 0) {
    return { modalCount: 0, total: 0, differing: [], agree: false, state: "absent", range: ["borderline", "borderline"] };
  }
  const counts = new Map<Band, number>();
  for (const e of examiners) counts.set(e.band, (counts.get(e.band) ?? 0) + 1);
  const modalCount = Math.max(...counts.values());

  const keys = Object.keys(examiners[0].dimensions) as RubricKey[];
  const differing = keys.filter((k) => new Set(examiners.map((e) => e.dimensions[k])).size > 1);

  const ranks = examiners.map((e) => BAND_RANK[e.band]);
  const bandOf = (rank: number) =>
    (Object.keys(BAND_RANK) as Band[]).find((b) => BAND_RANK[b] === rank) as Band;
  const range: [Band, Band] = [bandOf(Math.min(...ranks)), bandOf(Math.max(...ranks))];

  if (total === 1) return { modalCount, total, differing: [], agree: false, state: "absent", range };
  const agree = modalCount === total && differing.length === 0;
  return { modalCount, total, differing, agree, state: agree ? "ok" : "partial", range };
}

export function highlightCounts(paragraphs: Paragraph[]): Record<Tone, number> {
  const counts: Record<Tone, number> = { strong: 0, weak: 0, offtopic: 0 };
  for (const p of paragraphs) for (const s of p.spans) counts[s.tone]++;
  return counts;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function findParagraph(report: EssayReport, id: string): number {
  return report.paragraphs.findIndex((p) => p.id === id) + 1;
}
