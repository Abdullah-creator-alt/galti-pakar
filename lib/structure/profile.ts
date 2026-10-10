/**
 * Optional, versioned CSS essay-analysis profile. It lets a deployment attach documented criterion ids
 * to structural findings. It never changes how elements, links or findings are produced and never
 * scores anything: with no profile, or an invalid or unverified one, the generic baseline runs unchanged.
 *
 * Provenance rules (enforced by the schema):
 *  - only profiles with provenance.status "verified" are applied;
 *  - every criterion that is not an "inferred_best_practice" must cite a document listed in provenance;
 *  - official requirements, rubric excerpts, examiner-report findings and inferred practices stay labelled
 *    as such and are never merged;
 *  - only criteria about organisation, thesis clarity, argument relevance, evidence support and
 *    counterarguments are applied here (see IN_SCOPE_AREAS); others are recorded as skipped.
 * The CSS English Essay profile that ships with the app lives in lib/profiles/cssEssay.ts (see CSS_PROFILE.md there).
 */
import { z } from "zod";
import {
  IN_SCOPE_AREAS,
  PROFILE_CHECKABILITY,
  PROFILE_CRITERION_AREAS,
  PROFILE_CRITERION_ORIGINS,
  STRUCTURAL_FINDING_TYPES,
  type AnalysisWarning,
  type AttachedCriterion,
  type ProfileApplication,
  type StructuralFinding,
} from "./types.ts";

const criterionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  area: z.enum(PROFILE_CRITERION_AREAS),
  origin: z.enum(PROFILE_CRITERION_ORIGINS),
  checkability: z.enum(PROFILE_CHECKABILITY),
  sourceDocumentId: z.string().min(1).optional(),
  sourceLocator: z.string().optional(),
  // Registry metadata (optional so older profiles stay valid):
  description: z.string().min(1).optional(),
  introducedIn: z.string().min(1).optional(),
  /** Exact wording from the cited source. Only for criteria that quote an official document. */
  sourceQuote: z.string().min(1).optional(),
  /** What this criterion's signal cannot show. */
  limitations: z.string().min(1).optional(),
});

export const analysisProfileSchema = z
  .object({
    profileId: z.string().min(1),
    version: z.string().min(1),
    provenance: z.object({
      status: z.enum(["verified", "draft"]),
      verifiedBy: z.string().optional(),
      documents: z.array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          issuer: z.string().optional(),
          version: z.string().optional(),
          url: z.string().url().optional(),
          /** Page where the document is listed. */
          listedAt: z.string().url().optional(),
          retrievedOn: z.string().optional(),
          sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
          notes: z.string().optional(),
        }),
      ),
    }),
    criteria: z.array(criterionSchema),
    mappings: z.array(
      z.object({
        diagnostic: z.enum(STRUCTURAL_FINDING_TYPES),
        criterionIds: z.array(z.string().min(1)).min(1),
        explanation: z.string().min(1),
      }),
    ),
  })
  .superRefine((p, ctx) => {
    const docIds = new Set(p.provenance.documents.map((d) => d.id));
    const critIds = new Set<string>();
    p.criteria.forEach((c, i) => {
      if (critIds.has(c.id)) ctx.addIssue({ code: "custom", path: ["criteria", i, "id"], message: `duplicate criterion id ${c.id}` });
      critIds.add(c.id);
      if (c.origin !== "inferred_best_practice" && (!c.sourceDocumentId || !docIds.has(c.sourceDocumentId)))
        ctx.addIssue({ code: "custom", path: ["criteria", i, "sourceDocumentId"], message: `${c.origin} criterion must cite a document listed in provenance.documents` });
      // An official classification must be traceable: a public URL for the document, and where in it the wording is.
      if (c.origin === "official_requirement" || c.origin === "official_guidance") {
        const doc = p.provenance.documents.find((d) => d.id === c.sourceDocumentId);
        if (doc && !doc.url) ctx.addIssue({ code: "custom", path: ["criteria", i, "sourceDocumentId"], message: `${c.origin} criterion needs its document to have a url` });
        if (!c.sourceLocator) ctx.addIssue({ code: "custom", path: ["criteria", i, "sourceLocator"], message: `${c.origin} criterion needs a sourceLocator (page or section)` });
        if (!c.sourceQuote) ctx.addIssue({ code: "custom", path: ["criteria", i, "sourceQuote"], message: `${c.origin} criterion needs the quoted source wording` });
      }
      if (c.origin === "inferred_best_practice" && c.sourceQuote) ctx.addIssue({ code: "custom", path: ["criteria", i, "sourceQuote"], message: "an inferred best practice must not carry an official quotation" });
    });
    p.mappings.forEach((m, i) =>
      m.criterionIds.forEach((cid) => {
        if (!critIds.has(cid)) ctx.addIssue({ code: "custom", path: ["mappings", i, "criterionIds"], message: `unknown criterion id ${cid}` });
      }),
    );
  });

export type AnalysisProfile = z.infer<typeof analysisProfileSchema>;

export type ProfileResolution = { profile: AnalysisProfile | null; warnings: AnalysisWarning[] };

/** Validates an untrusted profile. Never throws: a bad profile yields null plus a warning. */
export function resolveProfile(raw: unknown): ProfileResolution {
  if (raw === undefined || raw === null) return { profile: null, warnings: [] };
  const parsed = analysisProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { profile: null, warnings: [{ code: "profile_invalid", message: `Profile ignored: ${first.path.join(".") || "(root)"}: ${first.message}` }] };
  }
  if (parsed.data.provenance.status !== "verified")
    return { profile: null, warnings: [{ code: "profile_not_verified", message: `Profile ${parsed.data.profileId} is not verified and was not applied.` }] };
  return { profile: parsed.data, warnings: [] };
}

/** Returns findings with criteria attached (copies; input is not mutated) and a record of what was applied. */
export function applyProfile(findings: StructuralFinding[], profile: AnalysisProfile | null): { findings: StructuralFinding[]; application: ProfileApplication | null } {
  if (!profile) return { findings, application: null };
  const byId = new Map(profile.criteria.map((c) => [c.id, c]));
  const applied = new Set<string>();
  const skipped = new Set<string>();
  const out = findings.map((f) => {
    const criteria: AttachedCriterion[] = [];
    for (const m of profile.mappings.filter((x) => x.diagnostic === f.type)) {
      for (const cid of m.criterionIds) {
        const c = byId.get(cid)!;
        if (!IN_SCOPE_AREAS.includes(c.area)) {
          skipped.add(cid);
          continue;
        }
        applied.add(cid);
        criteria.push({
          criterionId: c.id,
          title: c.title,
          area: c.area,
          origin: c.origin,
          checkability: c.checkability,
          explanation: m.explanation,
          ...(c.limitations ? { limitations: c.limitations } : {}),
          ...(c.sourceDocumentId ? { sourceDocumentId: c.sourceDocumentId } : {}),
          ...(c.sourceLocator ? { sourceLocator: c.sourceLocator } : {}),
        });
      }
    }
    return criteria.length ? { ...f, criteria } : f;
  });
  return {
    findings: out,
    application: { profileId: profile.profileId, profileVersion: profile.version, appliedCriterionIds: [...applied].sort(), skippedCriterionIds: [...skipped].sort() },
  };
}
