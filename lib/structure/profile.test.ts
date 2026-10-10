import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEssayStructure } from "./analyze.ts";
import { resolveProfile } from "./profile.ts";
import { ESSAY_A, ESSAY_A_SPECS, mockComplete } from "./testkit.ts";

/**
 * TEST FIXTURE ONLY. Ids, titles and document names are invented to exercise the mechanism.
 * They are not real CSS requirements, rubric text or FPSC findings.
 */
const fixture = () => ({
  profileId: "fixture-profile",
  version: "0.0.1",
  provenance: { status: "verified", documents: [{ id: "doc-fixture", title: "Fixture document" }] },
  criteria: [
    { id: "FX-ORG-1", title: "Fixture: organisation", area: "organization", origin: "rubric_excerpt", checkability: "requires_judgment", sourceDocumentId: "doc-fixture", sourceLocator: "p. 1" },
    { id: "FX-THESIS-1", title: "Fixture: thesis present", area: "thesis_clarity", origin: "inferred_best_practice", checkability: "machine_checkable" },
    { id: "FX-LANG-1", title: "Fixture: language", area: "language", origin: "rubric_excerpt", checkability: "requires_judgment", sourceDocumentId: "doc-fixture" },
  ],
  mappings: [
    { diagnostic: "missing_thesis", criterionIds: ["FX-THESIS-1", "FX-LANG-1"], explanation: "No identifiable thesis." },
    { diagnostic: "missing_conclusion", criterionIds: ["FX-ORG-1"], explanation: "No identifiable conclusion." },
  ],
});

const specs = ESSAY_A_SPECS.filter((s) => s.role !== "thesis" && s.role !== "conclusion");

test("a verified profile attaches in-scope criteria with provenance and skips out-of-scope ones", async () => {
  const out = await analyzeEssayStructure({ text: ESSAY_A, profile: fixture() }, { complete: mockComplete(specs) });
  assert.ok(out.ok);
  if (!out.ok) return;
  const thesis = out.result.structuralFindings.find((f) => f.type === "missing_thesis")!;
  assert.deepEqual(thesis.criteria?.map((c) => [c.criterionId, c.origin, c.checkability]), [["FX-THESIS-1", "inferred_best_practice", "machine_checkable"]]);
  const concl = out.result.structuralFindings.find((f) => f.type === "missing_conclusion")!;
  assert.equal(concl.criteria?.[0].sourceDocumentId, "doc-fixture");
  assert.deepEqual(out.result.analysisMetadata.profile, {
    profileId: "fixture-profile",
    profileVersion: "0.0.1",
    appliedCriterionIds: ["FX-ORG-1", "FX-THESIS-1"],
    skippedCriterionIds: ["FX-LANG-1"],
  });
});

test("the profile never changes elements, links or finding detection", async () => {
  const [a, b] = await Promise.all([
    analyzeEssayStructure({ text: ESSAY_A }, { complete: mockComplete(specs), now: () => new Date(0) }),
    analyzeEssayStructure({ text: ESSAY_A, profile: fixture() }, { complete: mockComplete(specs), now: () => new Date(0) }),
  ]);
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) {
    assert.deepEqual(a.result.argumentElements, b.result.argumentElements);
    assert.deepEqual(a.result.argumentLinks, b.result.argumentLinks);
    assert.deepEqual(a.result.structuralFindings.map((f) => [f.type, f.confidence]), b.result.structuralFindings.map((f) => [f.type, f.confidence]));
  }
});

test("no profile, an unverified one, or an invalid one all fall back to the generic baseline", async () => {
  const draft = { ...fixture(), provenance: { ...fixture().provenance, status: "draft" } };
  const uncited = { ...fixture(), criteria: [{ ...fixture().criteria[0], sourceDocumentId: undefined }] };
  const dangling = { ...fixture(), mappings: [{ diagnostic: "missing_thesis", criterionIds: ["NOPE"], explanation: "x" }] };
  for (const [profile, warning] of [[undefined, null], [draft, "profile_not_verified"], [uncited, "profile_invalid"], [dangling, "profile_invalid"], ["junk", "profile_invalid"]] as const) {
    const out = await analyzeEssayStructure({ text: ESSAY_A, profile }, { complete: mockComplete(specs) });
    assert.ok(out.ok);
    if (!out.ok) continue;
    assert.equal(out.result.analysisMetadata.profile, null);
    assert.ok(out.result.structuralFindings.every((f) => !f.criteria));
    assert.equal(out.result.analysisMetadata.warnings.some((w) => w.code === warning), warning !== null);
  }
});

test("resolveProfile never throws on arbitrary input", () => {
  for (const v of [null, undefined, 1, [], {}, { profileId: 3 }]) assert.doesNotThrow(() => resolveProfile(v));
});
