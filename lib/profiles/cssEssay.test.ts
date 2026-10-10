import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEssayStructure, analysisProfileSchema, resolveProfile, structureAnalysisSchema, validateStructureAnalysis, STRUCTURAL_FINDING_TYPES, type StructureAnalysis, type StructuralFinding } from "../structure/index.ts";
import { ESSAY_A, ESSAY_A_SPECS, mockComplete, type ElementSpec } from "../structure/testkit.ts";
import { renderFindings } from "../pipeline/examinerPrompt.ts";
import { findingsFromStructure, structureInputText } from "../pipeline/findings.ts";
import { measureEssay } from "../pipeline/measure.ts";
import { runPipeline } from "../pipeline/orchestrate.ts";
import { IMAGES, essayFrom, happyDeps } from "../pipeline/testkit.ts";
import { CSS_ESSAY_PROFILE, CSS_ESSAY_PROFILE_ID, CSS_ESSAY_PROFILE_VERSION, FPSC_QUOTES, FPSC_SYLLABUS_DOC_ID } from "./cssEssay.ts";

const NOW = () => new Date("2026-01-01T00:00:00Z");
const clone = () => structuredClone(CSS_ESSAY_PROFILE) as Record<string, any>;
const byId = (id: string) => CSS_ESSAY_PROFILE.criteria.find((c) => c.id === id)!;

async function run(text: string, specs: ElementSpec[], profile?: unknown): Promise<StructureAnalysis> {
  const out = await analyzeEssayStructure({ text, ...(profile === undefined ? {} : { profile }) }, { complete: mockComplete(specs), now: NOW });
  assert.ok(out.ok);
  if (!out.ok) throw new Error("setup failed");
  return out.result;
}
const strip = (f: StructuralFinding) => {
  const { criteria: _c, ...rest } = f;
  return rest;
};

// A small essay that produces findings of several kinds without needing any model: roles are given by the test.
const WEAK_TEXT = "Alpha is true. Some argue beta is false. Gamma holds. Delta maybe.";
const WEAK_SPECS: ElementSpec[] = [
  { s: "s1", role: "claim", conf: 0.8 },
  { s: "s2", role: "counterclaim", conf: 0.8 },
  { s: "s3", role: "claim", conf: 0.8 },
  { s: "s4", role: "other", conf: 0.3 },
];
const OFF_TOPIC_TEXT = "Renewable energy is the future of Pakistan. Cities must reduce traffic congestion.";
const OFF_TOPIC_SPECS: ElementSpec[] = [{ s: "s1", role: "thesis" }, { s: "s2", role: "claim" }];

// ---- loading, versioning, registry integrity ----

test("the shipped profile loads, validates and is versioned", () => {
  assert.equal(CSS_ESSAY_PROFILE.profileId, CSS_ESSAY_PROFILE_ID);
  assert.equal(CSS_ESSAY_PROFILE.version, CSS_ESSAY_PROFILE_VERSION);
  assert.match(CSS_ESSAY_PROFILE.version, /^\d+\.\d+\.\d+$/);
  assert.ok(analysisProfileSchema.safeParse(CSS_ESSAY_PROFILE).success);
  const r = resolveProfile(CSS_ESSAY_PROFILE);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.profile, "a verified profile is accepted");
});

test("criterion ids are stable, unique and sequential; every criterion carries the required metadata", () => {
  const ids = CSS_ESSAY_PROFILE.criteria.map((c) => c.id);
  assert.deepEqual(ids, Array.from({ length: 9 }, (_, i) => `CSS-ESSAY-00${i + 1}`));
  for (const c of CSS_ESSAY_PROFILE.criteria) {
    assert.ok(c.title && c.description && c.limitations, `${c.id} needs title, description and limitations`);
    assert.equal(c.introducedIn, "1.0.0", c.id);
    assert.ok(["thesis_clarity", "organization", "argument_relevance", "evidence_support", "counterargument", "language"].includes(c.area), c.id);
  }
});

test("all seven proposed dimensions are present, and the profile assigns no marks, weights, scores or pass/fail", () => {
  const titles = CSS_ESSAY_PROFILE.criteria.map((c) => c.title.toLowerCase()).join(" | ");
  for (const word of ["thesis", "argument development", "relevance", "evidence", "coherence", "counterarguments", "conclusion"]) assert.ok(titles.includes(word), word);
  const keys: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.push(k), walk(x));
  };
  walk(CSS_ESSAY_PROFILE);
  assert.deepEqual(keys.filter((k) => /weight|marks?$|score|rank|grade|threshold|pass|fail/i.test(k)), []);
});

// ---- provenance ----

test("only the two criteria the official syllabus supports are official; the seven dimensions are inferred best practice", () => {
  const official = CSS_ESSAY_PROFILE.criteria.filter((c) => c.origin.startsWith("official_")).map((c) => c.id);
  assert.deepEqual(official, ["CSS-ESSAY-008", "CSS-ESSAY-009"]);
  for (const c of CSS_ESSAY_PROFILE.criteria.filter((x) => !official.includes(x.id))) {
    assert.equal(c.origin, "inferred_best_practice", c.id);
    assert.equal(c.sourceDocumentId, undefined, `${c.id} must not cite a source`);
    assert.equal(c.sourceQuote, undefined, `${c.id} must not carry an official quotation`);
  }
});

test("official criteria are traceable: FPSC document with a URL, a page, an exact quote and a file hash", () => {
  const doc = CSS_ESSAY_PROFILE.provenance.documents.find((d) => d.id === FPSC_SYLLABUS_DOC_ID)!;
  assert.match(doc.url!, /^https:\/\/www\.fpsc\.gov\.pk\/uploads\/syllabus\/.+\.pdf$/);
  assert.match(doc.listedAt!, /^https:\/\/www\.fpsc\.gov\.pk\//);
  assert.match(doc.sha256!, /^[0-9a-f]{64}$/);
  assert.ok(doc.retrievedOn && doc.version);
  for (const id of ["CSS-ESSAY-008", "CSS-ESSAY-009"]) {
    const c = byId(id);
    assert.equal(c.sourceDocumentId, FPSC_SYLLABUS_DOC_ID);
    assert.match(c.sourceLocator!, /PDF page 7/);
    assert.ok(Object.values(FPSC_QUOTES).includes(c.sourceQuote as never), `${id} quote is one of the recorded quotes`);
  }
  assert.match(FPSC_QUOTES.knowledge, /comprehensive and research based knowledge on a selected topic/);
  assert.match(doc.notes!, /does not mention a thesis, counterarguments, a conclusion, coherence, or any criterion weights/);
});

test("incomplete official-source information is rejected and the generic analysis runs instead", async () => {
  const breakIt = (mutate: (p: Record<string, any>) => void) => {
    const p = clone();
    mutate(p);
    return p;
  };
  const cases: [string, Record<string, any>][] = [
    ["document without a url", breakIt((p) => delete p.provenance.documents[0].url)],
    ["official criterion without a page", breakIt((p) => delete p.criteria[7].sourceLocator)],
    ["official criterion without a quote", breakIt((p) => delete p.criteria[7].sourceQuote)],
    ["official criterion citing no document", breakIt((p) => delete p.criteria[7].sourceDocumentId)],
    ["official criterion citing an unlisted document", breakIt((p) => (p.criteria[7].sourceDocumentId = "not-listed"))],
    ["inferred criterion carrying an official quote", breakIt((p) => (p.criteria[0].sourceQuote = FPSC_QUOTES.knowledge))],
    ["mapping to an unknown criterion", breakIt((p) => (p.mappings[0].criterionIds = ["CSS-ESSAY-999"]))],
    ["duplicate criterion id", breakIt((p) => (p.criteria[1].id = p.criteria[0].id))],
  ];
  for (const [name, bad] of cases) {
    assert.ok(!analysisProfileSchema.safeParse(bad).success, name);
    const r = resolveProfile(bad);
    assert.equal(r.profile, null, name);
    assert.equal(r.warnings[0].code, "profile_invalid", name);
    const out = await run(WEAK_TEXT, WEAK_SPECS, bad);
    assert.equal(out.analysisMetadata.profile, null, name);
    assert.ok(out.structuralFindings.every((f) => !f.criteria), name);
  }
  assert.equal(resolveProfile({ ...clone(), provenance: { ...CSS_ESSAY_PROFILE.provenance, status: "draft" } }).warnings[0].code, "profile_not_verified");
});

test("assessability is stated honestly: nothing is machine_checkable, and unmapped criteria are marked as needing judgment", () => {
  const mapped = new Set(CSS_ESSAY_PROFILE.mappings.flatMap((m) => m.criterionIds));
  for (const c of CSS_ESSAY_PROFILE.criteria) {
    assert.notEqual(c.checkability, "machine_checkable", `${c.id}: every diagnostic depends on model-assigned roles`);
    if (!mapped.has(c.id)) assert.equal(c.checkability, "requires_judgment", `${c.id} has no diagnostic mapped to it`);
    if (mapped.has(c.id)) assert.equal(c.checkability, "partially_assessable", c.id);
  }
  for (const id of ["CSS-ESSAY-002", "CSS-ESSAY-005", "CSS-ESSAY-009"]) assert.ok(!mapped.has(id), `${id} must not be attached to any finding`);
});

test("wording stays hedged: no explanation or limitation asserts a violation, a falsehood or a mandatory rule", () => {
  const forbidden = /\b(violat\w*|fails? to|invalid|false claim|irrelevant argument|not met|must (?:have|include)|mandatory|requirement (?:is|was) (?:violated|missed))\b/i;
  for (const m of CSS_ESSAY_PROFILE.mappings) assert.doesNotMatch(m.explanation, forbidden, m.diagnostic);
  for (const c of CSS_ESSAY_PROFILE.criteria) assert.doesNotMatch(`${c.description} ${c.limitations}`, forbidden, c.id);
  assert.match(CSS_ESSAY_PROFILE.mappings.find((m) => m.diagnostic === "unanswered_counterclaim")!.explanation, /for the examiner to decide/);
  assert.match(byId("CSS-ESSAY-006").limitations!, /not a defect/);
});

// ---- mapping existing findings to criteria ----

test("every mapped diagnostic is a real finding type and every mapped criterion exists", () => {
  const ids = new Set(CSS_ESSAY_PROFILE.criteria.map((c) => c.id));
  for (const m of CSS_ESSAY_PROFILE.mappings) {
    assert.ok((STRUCTURAL_FINDING_TYPES as readonly string[]).includes(m.diagnostic), m.diagnostic);
    for (const id of m.criterionIds) assert.ok(ids.has(id), id);
  }
  assert.ok(!CSS_ESSAY_PROFILE.mappings.some((m) => m.diagnostic === "uncertain_classification"), "a data-quality finding is not a criterion");
});

test("findings are labelled with their criteria; one finding can relate to several", async () => {
  const out = await run(WEAK_TEXT, WEAK_SPECS, CSS_ESSAY_PROFILE);
  const ofType = (t: string) => out.structuralFindings.filter((f) => f.type === t);
  const ids = (f: StructuralFinding) => f.criteria?.map((c) => c.criterionId);
  assert.deepEqual(ids(ofType("missing_thesis")[0]), ["CSS-ESSAY-001"]);
  assert.deepEqual(ids(ofType("missing_conclusion")[0]), ["CSS-ESSAY-007"]);
  assert.deepEqual(ids(ofType("unanswered_counterclaim")[0]), ["CSS-ESSAY-006"]);
  for (const f of ofType("potential_orphan_claim")) assert.deepEqual(ids(f), ["CSS-ESSAY-004", "CSS-ESSAY-008"], "an unsupported-claim signal relates to two criteria");
  for (const f of ofType("uncertain_classification")) assert.equal(f.criteria, undefined);
  const attached = ofType("potential_orphan_claim")[0].criteria!;
  assert.equal(attached[0].origin, "inferred_best_practice");
  assert.equal(attached[1].origin, "official_requirement");
  assert.equal(attached[1].sourceDocumentId, FPSC_SYLLABUS_DOC_ID);
  assert.ok(attached.every((c) => c.explanation && c.limitations));
  assert.deepEqual(out.analysisMetadata.profile, {
    profileId: CSS_ESSAY_PROFILE_ID,
    profileVersion: CSS_ESSAY_PROFILE_VERSION,
    appliedCriterionIds: ["CSS-ESSAY-001", "CSS-ESSAY-004", "CSS-ESSAY-006", "CSS-ESSAY-007", "CSS-ESSAY-008"],
    skippedCriterionIds: [],
  });
});

test("a relevance concern maps to the relevance criterion only", async () => {
  const out = await run(OFF_TOPIC_TEXT, OFF_TOPIC_SPECS, CSS_ESSAY_PROFILE);
  const f = out.structuralFindings.find((x) => x.type === "weak_thesis_connection")!;
  assert.deepEqual(f.criteria!.map((c) => c.criterionId), ["CSS-ESSAY-003"]);
  assert.match(f.criteria![0].explanation, /possible relevance concern only/);
  assert.match(f.description, /does not show the claim is off-topic/);
});

// ---- the profile adds labels and nothing else ----

test("the profile never creates, removes or alters a finding: only `criteria` is added", async () => {
  for (const [text, specs] of [[WEAK_TEXT, WEAK_SPECS], [OFF_TOPIC_TEXT, OFF_TOPIC_SPECS], [ESSAY_A, ESSAY_A_SPECS]] as const) {
    const generic = await run(text, specs);
    const withProfile = await run(text, specs, CSS_ESSAY_PROFILE);
    assert.deepEqual(withProfile.structuralFindings.map(strip), generic.structuralFindings.map(strip));
    assert.deepEqual(withProfile.argumentElements, generic.argumentElements);
    assert.deepEqual(withProfile.argumentLinks, generic.argumentLinks);
    assert.deepEqual(withProfile.sentences, generic.sentences);
  }
});

test("an essay with no structural findings gets no criteria and no profile-driven findings", async () => {
  const out = await run(ESSAY_A, ESSAY_A_SPECS, CSS_ESSAY_PROFILE);
  assert.deepEqual(out.structuralFindings, []);
  assert.deepEqual(out.analysisMetadata.profile?.appliedCriterionIds, []);
});

test("sentence references, severity, confidence and uncertainty are preserved on labelled findings", async () => {
  const generic = await run(WEAK_TEXT, WEAK_SPECS);
  const labelled = await run(WEAK_TEXT, WEAK_SPECS, CSS_ESSAY_PROFILE);
  labelled.structuralFindings.forEach((f, i) => {
    const g = generic.structuralFindings[i];
    for (const k of ["id", "type", "reasonCode", "description", "paragraphIds", "sentenceIds", "elementIds", "linkIds", "confidence", "suggestedSeverity", "reviewCategory"] as const) assert.deepEqual(f[k], g[k], `${f.id}.${k}`);
  });
});

test("without a profile the output is exactly the generic analysis", async () => {
  const out = await run(WEAK_TEXT, WEAK_SPECS);
  assert.equal(out.analysisMetadata.profile, null);
  assert.ok(out.structuralFindings.every((f) => f.criteria === undefined));
  assert.equal(out.analysisMetadata.warnings.some((w) => w.code.startsWith("profile_")), false);
});

// ---- compatibility with the existing schema, examiner input and pipeline ----

test("labelled output validates against the existing schema and integrity checks", async () => {
  const out = await run(WEAK_TEXT, WEAK_SPECS, CSS_ESSAY_PROFILE);
  assert.ok(structureAnalysisSchema.safeParse(out).success);
  assert.deepEqual(validateStructureAnalysis(out, WEAK_TEXT).issues, []);
});

test("the examiner's input does not change when the profile is applied", async () => {
  const essay = essayFrom(ESSAY_A);
  const text = structureInputText(essay.paragraphs);
  const generic = findingsFromStructure(await run(text, ESSAY_A_SPECS), essay);
  const labelled = findingsFromStructure(await run(text, ESSAY_A_SPECS, CSS_ESSAY_PROFILE), essay);
  assert.deepEqual(labelled, generic);
  assert.equal(renderFindings(labelled.findings), renderFindings(generic.findings));
});

test("the measuring stage hands the CSS profile to the structure analysis by default, and `null` turns it off", async () => {
  const essay = essayFrom(ESSAY_A);
  const seen: unknown[] = [];
  const base = {
    embed: async (t: string[]) => t.map(() => [1, 0]),
    analyse: async () => ({ paragraphs: [], genericShare: 0, specificityPer100Words: 0, driftingParagraphIds: [], embedTextCount: 0, unassessedSentences: 0 }),
    benchmark: async () => ({ status: "unavailable", reason: "none", profile: [], nProfileEssays: 0, disclaimers: [] }) as never,
  };
  const capture = (input: Parameters<NonNullable<Parameters<typeof measureEssay>[2]>["structure"] & {}>[0]) => {
    seen.push(input.profile);
    return analyzeEssayStructure(input, { complete: mockComplete(ESSAY_A_SPECS), now: NOW });
  };
  await measureEssay(essay, "Topic", { ...base, structure: capture });
  await measureEssay(essay, "Topic", { ...base, structure: capture, profile: null });
  const custom = { marker: "custom" };
  await measureEssay(essay, "Topic", { ...base, structure: capture, profile: custom });
  assert.equal((seen[0] as { profileId: string }).profileId, CSS_ESSAY_PROFILE_ID);
  assert.equal(seen[1], undefined);
  assert.equal(seen[2], custom);
});

test("the whole pipeline returns the same report with or without the profile; the only difference in extras is the CSS section", async () => {
  const withProfile = await runPipeline({ images: IMAGES, topic: "Education and national progress" }, { deps: happyDeps() });
  const without = await runPipeline(
    { images: IMAGES, topic: "Education and national progress" },
    { deps: happyDeps({ structure: (input) => analyzeEssayStructure({ ...input, profile: undefined }, { complete: mockComplete(ESSAY_A_SPECS) }) }) },
  );
  assert.deepEqual(withProfile.report, without.report);
  const { cssProfile, ...rest } = withProfile.extras;
  assert.ok(cssProfile, "the CSS section is built when the profile ran");
  assert.deepEqual(rest, without.extras);
  assert.equal(without.extras.cssProfile, undefined, "no profile, no CSS section");
});
