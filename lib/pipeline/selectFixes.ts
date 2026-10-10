/**
 * CODE chooses the three problems worth a fix and their order. The LLM later only explains them.
 * Order: the top 3 distinct issue types by impact; if fewer than 3, fill from weak dimensions, then benchmark gaps,
 * then the weakest remaining dimension. Nothing is invented: fewer fixes are returned (with a warning) if needed.
 */
import { COACH } from "../config.ts";
import type { RubricKey } from "../types.ts";
import type { BlendedAnalysis, IssueType } from "./blend.types.ts";
import { ISSUE_DIMENSION } from "./blendConfig.ts";
import type { BenchmarkResult } from "./benchmark.types.ts";

export type FixSource = "issue" | "dimension" | "benchmark";

export interface FixTarget {
  /** Stable key the model must echo back: "issue:orphan_claim", "dimension:evidence", "benchmark:0". */
  key: string;
  source: FixSource;
  /** Issue type, or the dimension/benchmark label for fallbacks. */
  type: IssueType | "dimension" | "benchmark";
  severity: number;
  impact: number;
  issueIds: string[];
  /** Paragraph the problem sits in, when it has one. */
  paragraphId: string | null;
  /** 1 to 3 sentences copied from the essay, with ids. */
  sentences: { id: string; text: string }[];
  /** The real numbers behind the problem (counts, similarities, relevance). */
  numbers: Record<string, number>;
  dimension?: RubricKey;
  /** For dimension and benchmark fixes: a plain statement of the problem. */
  statement?: string;
}

export interface Selection {
  targets: FixTarget[];
  warnings: string[];
  issuesSelected: number;
}

const WEAK_BANDS = new Set(["borderline", "below-pass"]);

export function selectFixes(analysis: BlendedAnalysis, benchmark?: BenchmarkResult): Selection {
  const warnings: string[] = [];
  const targets: FixTarget[] = [];
  const want = COACH.FIX_COUNT;

  // 1. Top distinct issue types, in the order of their highest-impact issue (rankedIssues is already sorted).
  const byType = new Map<IssueType, typeof analysis.rankedIssues>();
  for (const issue of analysis.rankedIssues) byType.set(issue.type, [...(byType.get(issue.type) ?? []), issue]);
  for (const [type, issues] of byType) {
    if (targets.length >= want) break;
    const top = issues[0];
    const sentences: FixTarget["sentences"] = [];
    for (const i of issues) for (const s of i.sentences) if (sentences.length < COACH.MAX_TARGET_SENTENCES && !sentences.some((x) => x.id === s.id)) sentences.push(s);
    targets.push({
      key: `issue:${type}`,
      source: "issue",
      type,
      severity: top.severity,
      impact: top.impact,
      issueIds: issues.map((i) => i.id),
      paragraphId: top.paragraphId,
      sentences,
      numbers: { ...top.numbers, issuesOfThisType: issues.length, sentencesAffected: issues.reduce((n, i) => n + i.count, 0) },
      dimension: ISSUE_DIMENSION[type],
    });
  }
  const issuesSelected = targets.length;

  // Dimensions already addressed by a chosen issue are not repeated as dimension fixes.
  const covered = new Set<RubricKey>(targets.map((t) => t.dimension).filter((d): d is RubricKey => !!d));
  const dims = [...analysis.reportParts.dimensions].sort((a, b) => a.score / a.outOf - b.score / b.outOf);

  // 2. Lowest-scoring dimensions that are genuinely weak (borderline or below).
  for (const d of dims) {
    if (targets.length >= want) break;
    if (covered.has(d.key) || !WEAK_BANDS.has(d.band)) continue;
    covered.add(d.key);
    targets.push(dimensionTarget(d, targets.length));
  }

  // 3. Benchmark: key points reference essays make that this essay lacks (only with real reference data).
  if (targets.length < want && benchmark?.status === "ok" && benchmark.coverage) {
    const missing = [...benchmark.coverage.missing].sort((a, b) => (b.madeByCount ?? -1) - (a.madeByCount ?? -1));
    for (const [i, m] of missing.entries()) {
      if (targets.length >= want) break;
      targets.push({
        key: `benchmark:${i}`,
        source: "benchmark",
        type: "benchmark",
        severity: 1,
        impact: 0.5,
        issueIds: [],
        paragraphId: null,
        sentences: [],
        numbers: { ...(m.madeByCount !== null ? { madeByCount: m.madeByCount } : {}), ...(m.ofN !== null ? { ofEssays: m.ofN } : {}) },
        statement: `The essay does not make this point, which strong essays on the theme make: ${m.point}`,
      });
    }
  }

  // 4. The weakest remaining dimension, whatever its band, using its examiner or measured note.
  for (const d of dims) {
    if (targets.length >= want) break;
    if (covered.has(d.key)) continue;
    covered.add(d.key);
    targets.push(dimensionTarget(d, targets.length));
  }

  if (targets.length < want) warnings.push(`Only ${targets.length} fix${targets.length === 1 ? "" : "es"} could be grounded in measured findings; none were invented to fill the gap.`);
  return { targets: targets.slice(0, want), warnings, issuesSelected };
}

function dimensionTarget(d: BlendedAnalysis["reportParts"]["dimensions"][number], position: number): FixTarget {
  return {
    key: `dimension:${d.key}`,
    source: "dimension",
    type: "dimension",
    severity: 1,
    // Below any real issue so ranks stay in impact order: earlier fallbacks rank higher.
    impact: Math.max(0.1, 0.9 - position * 0.1),
    issueIds: [],
    paragraphId: null,
    sentences: [],
    numbers: { score: d.score, outOf: d.outOf },
    dimension: d.key,
    statement: `${d.label} is one of the weaker parts of the essay. Assessment: ${d.note ?? "no further detail"}`,
  };
}
