import type { EssayReport, RubricKey, Tone } from "../types.ts";
import type { EssayAnalysis } from "./analyse.ts";
import type { BenchmarkResult } from "./benchmark.types.ts";
import type { SecondOpinion } from "./findings.types.ts";
import type { TranscribedEssay } from "./transcribe.types.ts";

/** Sentence labels used by the X-Ray. (The structure module's own roles are mapped to these in structureLabels.ts.) */
export type SentenceLabelName = "Lead" | "Position" | "Claim" | "Evidence" | "Counterclaim" | "Rebuttal" | "Conclusion" | "Other";

export interface SentenceRef {
  /** "p3-s2": paragraph id plus 1-based sentence number. */
  id: string;
  paragraphId: string;
  /** Offsets inside the paragraph text. */
  start: number;
  end: number;
  text: string;
  vec?: number[];
}

export interface SentenceLabel {
  sentenceId: string;
  label: SentenceLabelName;
  source: "llm" | "classifier" | "consensus";
  confidence?: number;
}

export interface BlendInput {
  essay: TranscribedEssay;
  topic: string;
  sentences: SentenceRef[];
  structure?: { sentences: SentenceLabel[]; labelAgreementRate?: number };
  /** Drift and genericness, as returned by analyseGenericnessAndDrift. */
  analysis?: EssayAnalysis;
  benchmark?: BenchmarkResult;
  /** The examiner second opinion (named SecondOpinion; lib/types.ts already has an ExaminerResult row type). */
  examiner?: SecondOpinion;
  /** Outline line vectors, if already embedded. Otherwise blend embeds them in one batch when an embed function is given. */
  outlineVecs?: number[][];
}

/* ---------- X-Ray ---------- */

export type LinkStrength = "strong" | "weak" | "orphan";
export type LinkWindow = "same-paragraph" | "adjacent-paragraph" | "next-sentence-specific" | "none";

export interface ClaimLink {
  claimSentenceId: string;
  claimLabel: "Claim" | "Position";
  evidenceSentenceId: string | null;
  /** Cosine to the chosen evidence; for an orphan, the best cosine found (0 if there was no candidate). */
  similarity: number;
  strength: LinkStrength;
  windowUsed: LinkWindow;
}

export interface CounterResult {
  counterSentenceId: string;
  rebuttalSentenceId: string | null;
  status: "rebutted" | "unrebutted";
}

export interface XRayStats {
  claimsTotal: number;
  claimsStrong: number;
  claimsWeak: number;
  claimsOrphan: number;
  /** strong = 1, weak = 0.5, orphan = 0, over claims (Position sentences excluded). 0 when there are no claims. */
  claimsLinkedShare: number;
  orphanShare: number;
  unrebuttedCount: number;
  counterclaims: number;
}

export type IssueType = "orphan_claim" | "weak_link_claim" | "unrebutted_counterclaim" | "drift" | "generic" | "missing_counter" | "no_position" | "no_conclusion";

/* ---------- spans and trace ---------- */

export interface TraceEntry {
  paragraphId: string;
  start: number;
  end: number;
  tone: Tone;
  ruleIds: string[];
  sentenceIds: string[];
  /** "read -> labelled -> linked -> rule fired", one plain line per step. */
  chain: string[];
  inputs: {
    label?: string;
    labelSource?: string;
    labelConfidence?: number;
    genericLevel?: string;
    genericScore?: number | null;
    relevance?: number | null;
    linkedSentenceId?: string | null;
    similarity?: number;
    thresholds: { linkStrong: number; linkWeak: number; driftThreshold: number };
  };
}

/* ---------- conflicts, issues, output ---------- */

export type ConflictType =
  | "evidence_praised_but_orphans"
  | "coherence_praised_but_drift"
  | "counter_absent_but_found"
  | "counter_present_but_none"
  | "structure_label_disagreement"
  | "score_gap";

export interface ConflictRecord {
  id: string;
  type: ConflictType;
  dimension: RubricKey | null;
  examinerSays: string;
  measuredSays: string;
  numbers: Record<string, number>;
}

export interface RankedIssue {
  id: string;
  type: IssueType;
  paragraphId: string | null;
  sentenceIds: string[];
  /** The sentences' text, as data for the coach step. */
  sentences: { id: string; text: string }[];
  severity: number;
  dimension: RubricKey;
  /** severity x dimension weight x count. */
  impact: number;
  count: number;
  numbers: Record<string, number>;
}

export type Confidence = "high" | "medium" | "low";

export interface DimensionTrace {
  key: RubricKey;
  measured: number | null;
  measuredComponents: Record<string, number>;
  measuredExplanation: string;
  examiner: number | null;
  final: number;
  weightMeasured: number;
  mode: "blended" | "examiner-only" | "measured-only";
  confidence: Confidence;
  confidenceReasons: string[];
  flags: string[];
}

/** The parts of EssayReport this step can fill. id, analysedAt, pageCount, isExample, fixes and rewrite are set later. */
export type ReportParts = Pick<EssayReport, "topic" | "wordCount" | "overallScore" | "overallOutOf" | "verdict" | "dimensions" | "paragraphs" | "driftThreshold" | "examiners">;

export interface BlendMetrics {
  spansProposed: number;
  spansDropped: number;
  quotesProposed: number;
  quotesVerified: number;
  quotesRejected: number;
  quotesRecheckFailed: number;
  conflictsByType: Partial<Record<ConflictType, number>>;
  claimsTotal: number;
  claimsStrong: number;
  claimsWeak: number;
  claimsOrphan: number;
  labelAgreementRate?: number;
  examinerAgreementRate?: number;
}

export interface BlendedAnalysis {
  reportParts: ReportParts;
  trace: TraceEntry[];
  dimensionTrace: DimensionTrace[];
  links: ClaimLink[];
  counters: CounterResult[];
  xray: XRayStats | null;
  conflicts: ConflictRecord[];
  /** Sentence labels used by the X-Ray (empty when structure was unavailable). */
  labels: SentenceLabel[];
  rankedIssues: RankedIssue[];
  weakestParagraphId: string | null;
  metrics: BlendMetrics;
  warnings: string[];
}
