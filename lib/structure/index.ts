/**
 * Structure-analysis module: public surface. Import from here, not from internals.
 * Downstream stages (examiner second opinion, verification, report) consume `StructureAnalysis` only.
 */
export { analyzeEssayStructure } from "./analyze.ts";
export type { EmbedFn, StructureDeps } from "./analyze.ts";
export type { CompleteFn, CompletionRequest } from "./extract.ts";
export { structureAnalysisSchema, structureInputSchema } from "./schema.ts";
export { validateStructureAnalysis } from "./validate.ts";
export type { IntegrityIssue, IntegrityReport } from "./validate.ts";
export { analysisProfileSchema, resolveProfile } from "./profile.ts";
export type { AnalysisProfile } from "./profile.ts";
export { STRUCTURE_SCHEMA_VERSION } from "./config.ts";
export * from "./types.ts";
