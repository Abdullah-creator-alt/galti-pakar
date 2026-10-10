import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { analyzeEssayStructure, type StructureAnalysis } from "../structure/index.ts";
import { ESSAY_A, ESSAY_A_SPECS, mockComplete, type ElementSpec } from "../structure/testkit.ts";
import { structureInputText } from "../pipeline/findings.ts";
import { runPipeline } from "../pipeline/orchestrate.ts";
import { IMAGES, essayFrom, happyDeps } from "../pipeline/testkit.ts";
import { mockExtras } from "../mock-extras.ts";
import { parseExtras } from "../types.extras.ts";
import { CSS_ESSAY_PROFILE, FPSC_QUOTES } from "./cssEssay.ts";
import { buildCssProfileInfo } from "./cssInsights.ts";

const WEAK_TEXT = "Pakistan faces problems. Education matters. Terrorism is bad.\n\nOur youth is the future. Some say democracy is unsuitable.\n\nCricket is popular.";
const WEAK_SPECS: ElementSpec[] = [
  { s: "s2", role: "claim", conf: 0.8 },
  { s: "s3", role: "claim", conf: 0.8 },
  { s: "s4", role: "claim", conf: 0.8 },
  { s: "s5", role: "counterclaim", conf: 0.7 },
  { s: "s6", role: "other", conf: 0.3 },
];

async function structureFor(text: string, specs: ElementSpec[], profile: unknown = CSS_ESSAY_PROFILE) {
  const essay = essayFrom(text);
  const out = await analyzeEssayStructure({ text: structureInputText(essay.paragraphs), ...(profile ? { profile } : {}) }, { complete: mockComplete(specs) });
  assert.ok(out.ok);
  if (!out.ok) throw new Error("setup failed");
  return { essay, structure: out.result as StructureAnalysis };
}
const reportOf = (essay: { paragraphs: { id: string }[] }, relevance: (i: number) => number = () => 95) => ({
  paragraphs: essay.paragraphs.map((p, i) => ({ id: p.id, relevance: relevance(i) })) as never,
  driftThreshold: 90,
});
const build = async (text: string, specs: ElementSpec[], opts: { relevance?: (i: number) => number; driftMeasured?: boolean } = {}) => {
  const { essay, structure } = await structureFor(text, specs);
  return buildCssProfileInfo({ structure, essay, report: reportOf(essay, opts.relevance), driftMeasured: opts.driftMeasured ?? true });
};
const row = (info: NonNullable<Awaited<ReturnType<typeof build>>>, n: number) => info.criteria.find((c) => c.id === `CSS-ESSAY-00${n}`)!;
const kinds = (info: NonNullable<Awaited<ReturnType<typeof build>>>) => info.insights.map((i) => i.kind);

// ---- when there is nothing to show ----

test("no section without a profile, with a profile that was not applied, or when paragraphs cannot be matched", async () => {
  const { essay, structure } = await structureFor(ESSAY_A, ESSAY_A_SPECS, null);
  assert.equal(buildCssProfileInfo({ structure, essay, report: reportOf(essay), driftMeasured: true }), undefined);

  const labelled = await structureFor(ESSAY_A, ESSAY_A_SPECS);
  const other = essayFrom("Completely different first paragraph.\n\nSecond one.\n\nThird one.");
  assert.equal(buildCssProfileInfo({ structure: labelled.structure, essay: other, report: reportOf(other), driftMeasured: true }), undefined);
  const renamed = structuredClone(labelled.structure);
  renamed.analysisMetadata.profile!.profileId = "some-other-profile";
  assert.equal(buildCssProfileInfo({ structure: renamed, essay: labelled.essay, report: reportOf(labelled.essay), driftMeasured: true }), undefined);
});

// ---- a clean essay ----

test("a clean essay: nothing flagged is neutral, unassessable criteria say so, and no claim is made about quality", async () => {
  const info = (await build(ESSAY_A, ESSAY_A_SPECS))!;
  assert.deepEqual(info.criteria.map((c) => c.status), ["none_flagged", "not_assessed", "none_flagged", "none_flagged", "not_assessed", "none_flagged", "none_flagged", "none_flagged", "not_assessed"]);
  assert.deepEqual(kinds(info), ["support", "position", "ending", "opposing"]);
  assert.match(row(info, 4).note!, /not a judgement that this part is strong/);
  assert.match(info.insights.find((i) => i.kind === "support")!.detail, /does not say the support is accurate or enough/);
  assert.match(info.insights.find((i) => i.kind === "position")!.detail, /not that it is clear or well argued/);
  assert.equal(info.criteria.every((c) => c.observations.length === 0), true);
});

// ---- a weak essay ----

test("a weak essay: signals are listed with their paragraphs, tied to the findings the engine produced", async () => {
  const { essay, structure } = await structureFor(WEAK_TEXT, WEAK_SPECS);
  const info = buildCssProfileInfo({ structure, essay, report: reportOf(essay), driftMeasured: true })!;
  assert.equal(row(info, 1).status, "signals");
  assert.equal(row(info, 6).status, "signals");
  assert.equal(row(info, 7).status, "signals");
  assert.equal(row(info, 3).status, "not_assessed");
  assert.match(row(info, 3).note!, /needs a clearly identified thesis/);

  // Observations are the engine's own finding descriptions, with transcript paragraph ids.
  const orphans = structure.structuralFindings.filter((f) => f.type === "potential_orphan_claim");
  assert.equal(row(info, 4).observations.length, orphans.length);
  assert.deepEqual(row(info, 4).observations.map((o) => o.text), orphans.map((f) => f.description));
  assert.deepEqual(row(info, 4).observations.map((o) => o.paragraphIds), [["p1"], ["p1"], ["p2"]]);
  // One finding relating to two criteria shows up under both.
  assert.deepEqual(row(info, 8).observations, row(info, 4).observations);

  const support = info.insights.find((i) => i.kind === "support")!;
  assert.match(support.headline, /^3 of 3 claims need a closer look for support$/);
  assert.deepEqual(support.paragraphIds, ["p1", "p2"]);
  assert.match(info.insights.find((i) => i.kind === "position")!.headline, /No clearly stated central position/);
  assert.match(info.insights.find((i) => i.kind === "opposing")!.headline, /1 opposing view raised, 1 without an identified response/);
});

test("'start here' points at the paragraph(s) with the most paragraph-level signals, and only when there are at least two", async () => {
  const weak = (await build(WEAK_TEXT, WEAK_SPECS))!;
  const attention = weak.insights.find((i) => i.kind === "attention")!;
  assert.equal(kinds(weak)[0], "attention");
  assert.deepEqual(attention.paragraphIds, ["p1", "p2"], "a tie is shown as a tie");
  assert.match(attention.detail, /Each of these paragraphs holds 2 of the 4 paragraph-level signals/);
  assert.match(attention.detail, /not errors/);

  const one = (await build("Alpha is true. Beta is true.", [{ s: "s1", role: "claim", conf: 0.8 }]))!;
  assert.ok(!kinds(one).includes("attention"), "a single signal is not an 'attention' pattern");
});

// ---- opposing views, relevance, drift ----

test("an absent opposing view is neutral and says no verified rule requires one", async () => {
  const info = (await build("Alpha is true. Beta follows from alpha.", [{ s: "s1", role: "thesis" }, { s: "s2", role: "claim" }]))!;
  assert.equal(row(info, 6).status, "nothing_to_check");
  assert.match(row(info, 6).note!, /No verified rule requires one/);
  const opposing = info.insights.find((i) => i.kind === "opposing")!;
  assert.equal(opposing.headline, "No opposing view was identified");
  assert.match(opposing.detail, /your decision/);
});

test("relevance concerns combine the thesis-tie finding with the separate drift measurement, and drift is ignored when unmeasured", async () => {
  const text = "Renewable energy is the future of Pakistan. Cities must reduce traffic congestion.\n\nThe national cricket team has a new coach.";
  const specs: ElementSpec[] = [{ s: "s1", role: "thesis" }, { s: "s2", role: "claim" }];
  const measured = (await build(text, specs, { relevance: (i) => (i === 1 ? 20 : 95) }))!;
  const rel = measured.insights.find((i) => i.kind === "relevance")!;
  assert.match(rel.headline, /^Possible relevance concern: 1 claim with no clear tie to the thesis; 1 paragraph measured as drifting from the topic$/);
  assert.match(rel.detail, /shared wording/);
  assert.match(rel.detail, /not a verdict on relevance/);
  assert.match(rel.detail, /not as proof of irrelevance/);
  assert.deepEqual(rel.paragraphIds, ["p1", "p2"]);
  assert.equal(row(measured, 3).status, "signals");

  const unmeasured = (await build(text, specs, { relevance: () => 0, driftMeasured: false }))!;
  const only = unmeasured.insights.find((i) => i.kind === "relevance")!;
  assert.doesNotMatch(only.headline, /drifting/);
  assert.doesNotMatch(only.detail, /drift measurement/);

  const noConcern = (await build(ESSAY_A, ESSAY_A_SPECS))!;
  assert.ok(!kinds(noConcern).includes("relevance"));
});

// ---- provenance, honesty, wording ----

test("official criteria carry their exact quote and page; inferred ones carry none; the source is the FPSC document", async () => {
  const info = (await build(WEAK_TEXT, WEAK_SPECS))!;
  const official = info.criteria.filter((c) => c.origin === "official_requirement");
  assert.deepEqual(official.map((c) => c.id), ["CSS-ESSAY-008", "CSS-ESSAY-009"]);
  assert.deepEqual(official.map((c) => c.sourceQuote), [FPSC_QUOTES.knowledge, FPSC_QUOTES.style]);
  assert.ok(official.every((c) => /PDF page 7/.test(c.sourceLocator!)));
  assert.ok(info.criteria.filter((c) => c.origin === "inferred_best_practice").every((c) => !c.sourceQuote && !c.sourceLocator));
  assert.equal(info.criteria.length, 9);
  assert.match(info.source.url, /^https:\/\/www\.fpsc\.gov\.pk\//);
  assert.equal(info.profileVersion, CSS_ESSAY_PROFILE.version);
  assert.match(info.caveats[1], /^7 of the 9 criteria below are inferred best practice, not FPSC rules/);
});

test("no marks, scores, grades, rankings or definitive verdicts anywhere in the section", async () => {
  const infos = [(await build(ESSAY_A, ESSAY_A_SPECS))!, (await build(WEAK_TEXT, WEAK_SPECS))!, mockExtras.cssProfile!];
  const bad = /\b(score[sd]?|grade[sd]?|rank(?:ed|ing)?|pass(?:ed)?|fail(?:ed|s)?|violat\w*|invalid|irrelevant|false|incorrect|wrong|weak essay|poor)\b/i;
  for (const info of infos) {
    const texts = [
      ...info.insights.flatMap((i) => [i.headline, i.detail]),
      ...info.criteria.flatMap((c) => [c.title, c.note ?? "", c.limitations, ...c.observations.map((o) => o.text)]),
    ];
    // A negated hedge ("is not thereby false") is the wording we want, so it is allowed; asserting falsehood is not.
    for (const t of texts) assert.doesNotMatch(t.replace(/is not thereby false/gi, ""), bad, t);
    // "marks" appears only in the caveats, to say there are none (and in the official 100-mark fact).
    assert.ok(info.caveats.some((c) => /There are no marks here/.test(c)));
    assert.equal(JSON.stringify(info).match(/"(weight|marks?|score|grade|rank|total|percent)\w*"\s*:/i), null, "no numeric scoring fields");
  }
});

// ---- the contract and the example data ----

test("the defensive parser keeps valid CSS data, drops bad rows, and rejects an unusable source", async () => {
  const info = (await build(WEAK_TEXT, WEAK_SPECS))!;
  assert.deepEqual(parseExtras({ cssProfile: info }).cssProfile, info);

  const dirty = structuredClone(info) as Record<string, any>;
  dirty.criteria.push({ id: "X", title: "bad", status: "pass", assessability: "partially_assessable", limitations: "", observations: [] });
  dirty.insights.push({ id: "y", kind: "score", headline: "h", detail: "d", paragraphIds: [] });
  const cleaned = parseExtras({ cssProfile: dirty }).cssProfile!;
  assert.equal(cleaned.criteria.length, info.criteria.length, "a row with an unknown status is dropped");
  assert.equal(cleaned.insights.length, info.insights.length, "an insight with an unknown kind is dropped");

  const noUrl = structuredClone(info) as Record<string, any>;
  noUrl.source.url = "not a url";
  assert.equal(parseExtras({ cssProfile: noUrl }).cssProfile, undefined);
  assert.equal(parseExtras({ cssProfile: "junk" }).cssProfile, undefined);
  assert.deepEqual(parseExtras({}).cssProfile, undefined);
});

test("the example report's CSS data is valid and agrees with the registry and with its own claim map", () => {
  const sample = mockExtras.cssProfile!;
  assert.deepEqual(parseExtras({ cssProfile: sample }).cssProfile, sample);
  assert.deepEqual(sample.criteria.map((c) => [c.id, c.title]), CSS_ESSAY_PROFILE.criteria.map((c) => [c.id, c.title]));
  const m = mockExtras.claimMap!.summary;
  const support = sample.insights.find((i) => i.kind === "support")!;
  assert.match(support.headline, new RegExp(`^${m.orphan + m.weak} of ${m.claimsTotal} claims need a closer look for support$`));
  assert.equal(sample.criteria.find((c) => c.id === "CSS-ESSAY-004")!.observations.length, m.orphan + m.weak);
});

// ---- the pipeline and the browser bundle ----

test("the pipeline returns the CSS section in the bundle's extras, and omits it when no profile ran", async () => {
  const withProfile = await runPipeline({ images: IMAGES, topic: "Education and national progress" }, { deps: happyDeps() });
  assert.ok(withProfile.extras.cssProfile);
  assert.equal(withProfile.extras.cssProfile!.criteria.length, 9);
  assert.deepEqual(parseExtras(withProfile.extras).cssProfile, withProfile.extras.cssProfile);

  const stripped = await runPipeline(
    { images: IMAGES, topic: "Education and national progress" },
    { deps: happyDeps({ structure: (input) => analyzeEssayStructure({ ...input, profile: undefined }, { complete: mockComplete(ESSAY_A_SPECS) }) }) },
  );
  assert.equal(stripped.extras.cssProfile, undefined, "a structure analysis without profile labels gives no CSS section");
  assert.deepEqual(stripped.report, withProfile.report);
});

test("the browser bundle for the example report never reaches server-only code (the Gemini client throws if loaded client-side)", () => {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(/from "(\.[^"]+)"/g)) walk(path.resolve(path.dirname(file), m[1]));
  };
  for (const entry of ["lib/mock-extras.ts", "lib/types.extras.ts"]) walk(path.resolve(entry));
  const names = [...seen].map((f) => path.relative(process.cwd(), f));
  assert.deepEqual(names.filter((n) => /gemini\.ts$|structure\/index\.ts$|structure\/analyze\.ts$|structure\/provider\.ts$/.test(n)), []);
});
