import { z } from "zod";
import { BENCHMARK } from "../config.ts";

export const POINT_TYPES = [
  "cause",
  "effect",
  "pakistan-context",
  "global-comparison",
  "data",
  "counter-argument",
  "rebuttal",
  "way-forward",
  "institution",
] as const;
export const pointTypeSchema = z.enum(POINT_TYPES);
export type PointType = z.infer<typeof pointTypeSchema>;

export const QUALITY_BASES = ["qualifier-model", "academy-sample", "op-ed-proxy", "self-written", "other"] as const;
export const qualityBasisSchema = z.enum(QUALITY_BASES);
export type QualityBasis = z.infer<typeof qualityBasisSchema>;

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** What the model returns for one essay (or one theme checklist). */
export const extractedPointsSchema = z.object({
  points: z
    .array(
      z.object({
        point: z.string().min(5).refine((s) => wordCount(s) <= BENCHMARK.MAX_POINT_WORDS, { message: `point must be at most ${BENCHMARK.MAX_POINT_WORDS} words` }),
        type: pointTypeSchema,
        specifics: z.array(z.string()),
      }),
    )
    .min(1)
    .max(BENCHMARK.MAX_POINTS_PER_ESSAY),
});
export type ExtractedPoints = z.infer<typeof extractedPointsSchema>;

export const extractedPointsResponseSchema = {
  type: "OBJECT",
  properties: {
    points: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          point: { type: "STRING" },
          type: { type: "STRING", enum: [...POINT_TYPES] },
          specifics: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["point", "type", "specifics"],
      },
    },
  },
  required: ["points"],
} as const;

/* ---------- benchmark.json ---------- */

const vec = z.array(z.number());

export const benchmarkPointSchema = z.object({
  point: z.string().refine((s) => wordCount(s) <= BENCHMARK.MAX_POINT_WORDS, { message: "stored point is too long" }),
  type: pointTypeSchema,
  origin: z.enum(["reference", "llm-checklist"]),
  madeByCount: z.number().int().min(1).nullable(),
  ofN: z.number().int().min(1).nullable(),
  sourceQualityBases: z.array(qualityBasisSchema),
  centroid: vec,
});
export type BenchmarkPoint = z.infer<typeof benchmarkPointSchema>;

export const distributionSchema = z.object({
  n: z.number().int().min(0),
  median: z.number(),
  q1: z.number(),
  q3: z.number(),
  min: z.number(),
  max: z.number(),
});
export type Distribution = z.infer<typeof distributionSchema>;

export const PROFILE_FEATURES = ["specifics", "cliches", "meanGenericness", "genericShare", "meanSentenceLength", "typeTokenRatio"] as const;
export type ProfileFeature = (typeof PROFILE_FEATURES)[number];

export const benchmarkSchema = z.object({
  meta: z.object({
    builtAt: z.string(),
    nEssays: z.number().int().min(0),
    countsByQualityBasis: z.record(z.string(), z.number()),
    countsByTheme: z.record(z.string(), z.number()),
    embedding: z.object({ model: z.string(), dimensions: z.number() }),
    clusterThreshold: z.number(),
  }),
  themes: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      centroid: vec,
      nEssays: z.number().int().min(0),
      points: z.array(benchmarkPointSchema),
    }),
  ),
  profile: z.object({
    nEssays: z.number().int().min(0),
    features: z.record(z.string(), distributionSchema),
  }),
});
export type Benchmark = z.infer<typeof benchmarkSchema>;

/* ---------- runtime result ---------- */

export const coveragePointSchema = z.object({
  point: z.string(),
  type: pointTypeSchema,
  madeByCount: z.number().nullable(),
  ofN: z.number().nullable(),
  origin: z.enum(["reference", "llm-checklist"]),
  bestSimilarity: z.number(),
});
export type CoveragePoint = z.infer<typeof coveragePointSchema>;

export const profileRowSchema = z.object({
  feature: z.string(),
  label: z.string(),
  value: z.number(),
  refMedian: z.number(),
  refQ1: z.number(),
  refQ3: z.number(),
  position: z.enum(["below", "within", "above"]),
  betterDirection: z.enum(["higher", "lower", "neutral"]),
  note: z.string(),
});
export type ProfileRow = z.infer<typeof profileRowSchema>;

export const benchmarkResultSchema = z.object({
  status: z.enum(["ok", "partial", "unavailable"]),
  /** Why the status is not "ok". */
  reason: z.string().optional(),
  theme: z.object({ key: z.string(), label: z.string(), similarity: z.number() }).optional(),
  coverage: z
    .object({
      basis: z.enum(["reference", "mixed", "llm-checklist"]),
      nReferences: z.number(),
      total: z.number(),
      covered: z.number(),
      missing: z.array(coveragePointSchema),
      coveredPoints: z.array(coveragePointSchema),
    })
    .optional(),
  profile: z.array(profileRowSchema),
  nProfileEssays: z.number(),
  disclaimers: z.array(z.string()),
});
export type BenchmarkResult = z.infer<typeof benchmarkResultSchema>;

/** Throws if any stored point is longer than the paraphrase limit. */
export function assertNoLongPoints(b: Benchmark): void {
  for (const t of b.themes) for (const p of t.points) if (wordCount(p.point) > BENCHMARK.MAX_POINT_WORDS) throw new Error(`Point too long in ${t.key}: "${p.point.slice(0, 60)}..."`);
}
