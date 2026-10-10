export type Band = "competitive" | "borderline" | "below-pass";
export type Tone = "strong" | "weak" | "offtopic";
export type ParagraphRole = "position" | "claim" | "evidence" | "counter-argument" | "conclusion";

export type RubricKey =
  | "thesis"
  | "outline"
  | "argument"
  | "evidence"
  | "counter-argument"
  | "coherence"
  | "language";

export interface DimensionScore {
  key: RubricKey;
  label: string;
  score: number;
  outOf: number;
  band: Band;
  note?: string;
}

/** Character offsets into the paragraph text. */
export interface HighlightSpan {
  start: number;
  end: number;
  tone: Tone;
  reason: string;
}

export interface Paragraph {
  id: string;
  text: string;
  role: ParagraphRole;
  /** 0-100, relevance to the topic. */
  relevance: number;
  summary: string;
  spans: HighlightSpan[];
}

export interface Fix {
  rank: 1 | 2 | 3;
  title: string;
  body: string;
  paragraphId?: string;
}

export interface Rewrite {
  paragraphId: string;
  original: string;
  improved: string;
  /** Phrases in `original` to mark as removed or weak in the optional diff. */
  removed?: string[];
  /** Phrases in `improved` to mark as added in the optional diff. */
  added?: string[];
}

export interface ExaminerResult {
  id: string;
  label: string;
  overall: number;
  band: Band;
  dimensions: Record<RubricKey, Band>;
}

export interface EssayReport {
  id: string;
  topic: string;
  analysedAt: string;
  wordCount: number;
  pageCount: number;
  overallScore: number;
  overallOutOf: number;
  verdict: Band;
  dimensions: DimensionScore[];
  paragraphs: Paragraph[];
  driftThreshold: number;
  fixes: Fix[];
  rewrite: Rewrite;
  examiners: ExaminerResult[];
  isExample: boolean;
}

export interface HistoryItem {
  id: string;
  topic: string;
  analysedAt: string;
  overallScore: number;
  overallOutOf: number;
  verdict: Band;
  isExample: boolean;
}
