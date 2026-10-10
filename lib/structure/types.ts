/**
 * Public contract of the structure-analysis module (schema version in config.ts).
 *
 * Offsets: every `start`/`end` is a UTF-16 code-unit offset into the exact `text` string the caller
 * supplied. `start` is inclusive, `end` is exclusive, so `input.text.slice(start, end)` is the span.
 * The module never rewrites the essay: spans exclude surrounding whitespace but are otherwise verbatim.
 *
 * Two different "confidence" notions are kept apart:
 *  - `modelConfidence` (elements): the LLM's self-reported certainty 0-1 about a role label. Uncalibrated,
 *    ordinal at best; 0.5 means "unsure", not a 50 % probability.
 *  - `strength` (links): a deterministic heuristic score 0-1 from structural signals. It says how many
 *    independent signals agree that a relationship is plausible; it is not a probability and not proof.
 *  - `confidence` (findings): 0-1 confidence that the structural *observation* is accurate given the
 *    extracted elements. See diagnose.ts for the per-type formulas.
 */

export const ARGUMENT_ROLES = ["thesis", "claim", "premise", "evidence", "counterclaim", "rebuttal", "conclusion", "other"] as const;
export type ArgumentRole = (typeof ARGUMENT_ROLES)[number];

export const LINK_TYPES = ["supports", "challenges", "rebuts", "relevant_to"] as const;
/**
 * Direction is always source -> target:
 *  - supports:    evidence|premise  -> the claim|premise|thesis|rebuttal|counterclaim it may support
 *                 (evidence for a rebuttal or for an opposing view is expressed this way)
 *  - challenges:  counterclaim      -> the thesis|claim|premise it may oppose
 *  - rebuts:      rebuttal          -> the counterclaim it may answer
 *  - relevant_to: claim|premise|evidence -> the thesis it may serve (a hypothesis from wording and, optionally,
 *                 embedding similarity; a missing link never shows that an element is off-topic)
 */
export type LinkType = (typeof LINK_TYPES)[number];

export const STRUCTURAL_FINDING_TYPES = [
  "potential_orphan_claim",
  "potentially_unsupported_reasoning",
  "unanswered_counterclaim",
  "missing_thesis",
  "missing_conclusion",
  "weak_thesis_connection",
  "uncertain_classification",
] as const;
export type StructuralFindingType = (typeof STRUCTURAL_FINDING_TYPES)[number];

export const SUGGESTED_SEVERITIES = ["info", "low", "medium", "high"] as const;
export type SuggestedSeverity = (typeof SUGGESTED_SEVERITIES)[number];

export const REVIEW_CATEGORIES = ["thesis", "organization", "evidence", "counterargument", "classification"] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

export const LINK_SIGNAL_KINDS = ["proximity", "order", "discourse_cue", "contrast_penalty", "lexical_overlap", "semantic_similarity"] as const;
export type LinkSignalKind = (typeof LINK_SIGNAL_KINDS)[number];

/** Every signal that contributed to a link's strength; `value` is its signed contribution. */
export interface LinkSignal {
  kind: LinkSignalKind;
  value: number;
  detail: string;
}

export interface ParagraphNode {
  id: string;
  index: number;
  start: number;
  end: number;
  text: string;
  sentenceIds: string[];
}

export interface SentenceNode {
  id: string;
  index: number;
  paragraphId: string;
  indexInParagraph: number;
  start: number;
  end: number;
  text: string;
}

export interface ArgumentElement {
  id: string;
  role: ArgumentRole;
  /** One or more sentences: contiguous, in the same paragraph, in reading order. */
  sentenceIds: string[];
  paragraphId: string;
  /** Exact source text from the first sentence's start to the last sentence's end. */
  text: string;
  start: number;
  end: number;
  modelConfidence: number;
  /** Set when the model named a plausible second reading of this element. */
  alternativeRole?: ArgumentRole;
}

/** A link is always a hypothesis for later review. `status` is fixed to "candidate" in this stage. */
export interface ArgumentLink {
  id: string;
  type: LinkType;
  sourceId: string;
  targetId: string;
  status: "candidate";
  strength: number;
  signals: LinkSignal[];
  /** Distinct methods behind the signals, e.g. ["proximity", "discourse_cue"]. */
  methods: LinkSignalKind[];
}

/** A CSS criterion attached to a finding. Copied from the supplied profile so consumers need not hold it. */
export interface AttachedCriterion {
  criterionId: string;
  title: string;
  area: ProfileCriterionArea;
  origin: ProfileCriterionOrigin;
  checkability: ProfileCheckability;
  explanation: string;
  sourceDocumentId?: string;
  sourceLocator?: string;
}

export interface StructuralFinding {
  id: string;
  type: StructuralFindingType;
  /** Machine-readable cause, e.g. CLAIM_NO_CANDIDATE_EVIDENCE. */
  reasonCode: string;
  /** One neutral sentence describing the observation. Not student-facing feedback. */
  description: string;
  paragraphIds: string[];
  sentenceIds: string[];
  elementIds: string[];
  /** Links that were considered when deciding (may be empty for "no link found" findings). */
  linkIds: string[];
  confidence: number;
  suggestedSeverity: SuggestedSeverity;
  reviewCategory: ReviewCategory;
  /** Present only when a verified analysis profile mapped this diagnostic to criteria. */
  criteria?: AttachedCriterion[];
}

export interface EssayMetadata {
  charCount: number;
  wordCount: number;
  paragraphCount: number;
  sentenceCount: number;
  topic?: string;
}

export interface RejectedElement {
  /** Position in the model's `elements` array. */
  index: number;
  code: string;
  message: string;
}

export interface AnalysisWarning {
  code: string;
  message: string;
}

export interface ProfileApplication {
  profileId: string;
  profileVersion: string;
  appliedCriterionIds: string[];
  /** Mapped criteria that were skipped because their area is outside this stage's scope. */
  skippedCriterionIds: string[];
}

export interface AnalysisMetadata {
  generatedAt: string;
  extractor: { kind: "llm"; name: string; attempts: number };
  linking: { method: "rule_based" | "rule_based+embedding"; embeddingUsed: boolean };
  rejectedElements: RejectedElement[];
  warnings: AnalysisWarning[];
  /**
   * Always "uncalibrated_heuristic": modelConfidence, link strength and finding confidence are heuristics.
   * They have not been validated against labelled data and must not be read as probabilities.
   */
  confidenceCalibration: "uncalibrated_heuristic";
  /** Null when no verified profile was supplied; the generic structural baseline still ran. */
  profile: ProfileApplication | null;
  /** Result of the module's own referential-integrity checks. Not proof of logical correctness. */
  integrity: { passed: true; checks: number };
}

export interface StructureAnalysis {
  schemaVersion: string;
  essayMetadata: EssayMetadata;
  paragraphs: ParagraphNode[];
  sentences: SentenceNode[];
  argumentElements: ArgumentElement[];
  argumentLinks: ArgumentLink[];
  structuralFindings: StructuralFinding[];
  analysisMetadata: AnalysisMetadata;
}

export interface StructureAnalysisInput {
  /** Parsed essay text, exactly as produced upstream. */
  text: string;
  topic?: string;
  /** Adds an embedding-similarity signal to linking. Off by default; falls back to rules if unavailable. */
  useSemanticSimilarity?: boolean;
  /** Optional CSS analysis profile. Ignored (with a warning) unless it validates and is verified. */
  profile?: unknown;
}

export const FAILURE_CODES = [
  "invalid_input",
  "empty_input",
  "input_too_large",
  "provider_error",
  "model_output_invalid",
  "integrity_error",
] as const;
export type StructureFailureCode = (typeof FAILURE_CODES)[number];

export interface StructureFailure {
  code: StructureFailureCode;
  message: string;
  retryable: boolean;
  details?: string[];
}

export type StructureOutcome = { ok: true; result: StructureAnalysis } | { ok: false; error: StructureFailure };

// ---- CSS analysis profile (optional, versioned, configurable) ----

export const PROFILE_CRITERION_AREAS = [
  "organization",
  "thesis_clarity",
  "argument_relevance",
  "evidence_support",
  "counterargument",
  // Recognised so a full profile can be supplied, but never applied by this stage:
  "language",
  "subject_knowledge",
  "other",
] as const;
export type ProfileCriterionArea = (typeof PROFILE_CRITERION_AREAS)[number];
/** Areas this stage may attach to findings. */
export const IN_SCOPE_AREAS: readonly ProfileCriterionArea[] = [
  "organization",
  "thesis_clarity",
  "argument_relevance",
  "evidence_support",
  "counterargument",
];

export const PROFILE_CRITERION_ORIGINS = ["official_requirement", "rubric_excerpt", "examiner_report_finding", "inferred_best_practice"] as const;
export type ProfileCriterionOrigin = (typeof PROFILE_CRITERION_ORIGINS)[number];

export const PROFILE_CHECKABILITY = ["machine_checkable", "requires_judgment"] as const;
export type ProfileCheckability = (typeof PROFILE_CHECKABILITY)[number];
