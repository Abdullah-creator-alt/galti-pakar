/** Runtime schemas for the module's input and output contract (zod, matching types.ts). */
import { z } from "zod";
import {
  ARGUMENT_ROLES,
  LINK_SIGNAL_KINDS,
  LINK_TYPES,
  PROFILE_CHECKABILITY,
  PROFILE_CRITERION_AREAS,
  PROFILE_CRITERION_ORIGINS,
  REVIEW_CATEGORIES,
  STRUCTURAL_FINDING_TYPES,
  SUGGESTED_SEVERITIES,
} from "./types.ts";

const unit = z.number().min(0).max(1);
const id = z.string().min(1);
const offset = z.number().int().min(0);

export const roleSchema = z.enum(ARGUMENT_ROLES);

export const structureInputSchema = z.object({
  text: z.string(),
  topic: z.string().max(300).optional(),
  useSemanticSimilarity: z.boolean().optional(),
  profile: z.unknown().optional(),
});

const paragraphSchema = z.object({ id, index: offset, start: offset, end: offset, text: z.string().min(1), sentenceIds: z.array(id).min(1) });
const sentenceSchema = z.object({ id, index: offset, paragraphId: id, indexInParagraph: offset, start: offset, end: offset, text: z.string().min(1) });
const elementSchema = z.object({
  id,
  role: roleSchema,
  sentenceIds: z.array(id).min(1),
  paragraphId: id,
  text: z.string().min(1),
  start: offset,
  end: offset,
  modelConfidence: unit,
  alternativeRole: roleSchema.optional(),
});
const signalSchema = z.object({ kind: z.enum(LINK_SIGNAL_KINDS), value: z.number().min(-1).max(1), detail: z.string() });
const linkSchema = z.object({
  id,
  type: z.enum(LINK_TYPES),
  sourceId: id,
  targetId: id,
  status: z.literal("candidate"),
  strength: unit,
  signals: z.array(signalSchema),
  methods: z.array(z.enum(LINK_SIGNAL_KINDS)),
});
const criterionSchema = z.object({
  criterionId: id,
  title: z.string(),
  area: z.enum(PROFILE_CRITERION_AREAS),
  origin: z.enum(PROFILE_CRITERION_ORIGINS),
  checkability: z.enum(PROFILE_CHECKABILITY),
  explanation: z.string(),
  limitations: z.string().optional(),
  sourceDocumentId: z.string().optional(),
  sourceLocator: z.string().optional(),
});
const findingSchema = z.object({
  id,
  type: z.enum(STRUCTURAL_FINDING_TYPES),
  reasonCode: z.string().min(1),
  description: z.string().min(1),
  paragraphIds: z.array(id),
  sentenceIds: z.array(id),
  elementIds: z.array(id),
  linkIds: z.array(id),
  confidence: unit,
  suggestedSeverity: z.enum(SUGGESTED_SEVERITIES),
  reviewCategory: z.enum(REVIEW_CATEGORIES),
  criteria: z.array(criterionSchema).optional(),
});

export const structureAnalysisSchema = z.object({
  schemaVersion: z.string().min(1),
  essayMetadata: z.object({
    charCount: offset,
    wordCount: offset,
    paragraphCount: offset,
    sentenceCount: offset,
    topic: z.string().optional(),
  }),
  paragraphs: z.array(paragraphSchema),
  sentences: z.array(sentenceSchema),
  argumentElements: z.array(elementSchema),
  argumentLinks: z.array(linkSchema),
  structuralFindings: z.array(findingSchema),
  analysisMetadata: z.object({
    generatedAt: z.string(),
    extractor: z.object({ kind: z.literal("llm"), name: z.string(), attempts: z.number().int().min(1) }),
    linking: z.object({ method: z.enum(["rule_based", "rule_based+embedding"]), embeddingUsed: z.boolean() }),
    rejectedElements: z.array(z.object({ index: offset, code: z.string(), message: z.string() })),
    warnings: z.array(z.object({ code: z.string(), message: z.string() })),
    profile: z
      .object({ profileId: z.string(), profileVersion: z.string(), appliedCriterionIds: z.array(z.string()), skippedCriterionIds: z.array(z.string()) })
      .nullable(),
    confidenceCalibration: z.literal("uncalibrated_heuristic"),
    integrity: z.object({ passed: z.literal(true), checks: offset }),
  }),
});
