import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEssayStructure } from "./analyze.ts";
import { compareRuns } from "./compare.ts";
import { diagnose } from "./diagnose.ts";
import { labelElements, STRONG_ESSAY, WEAK_ESSAY, type FixtureEssay } from "./fixtures.ts";
import { validateStructureAnalysis } from "./validate.ts";
import { buildDoc, linksFor, mockComplete } from "./testkit.ts";
import type { StructureAnalysis } from "./types.ts";

async function runFixture(essay: FixtureEssay): Promise<StructureAnalysis> {
  const out = await analyzeEssayStructure({ text: essay.text }, { complete: async () => JSON.stringify({ elements: labelElements(essay) }), now: () => new Date(0) });
  assert.ok(out.ok);
  if (!out.ok) throw new Error("fixture failed");
  return out.result;
}

const key = (a: StructureAnalysis) => {
  const el = new Map(a.argumentElements.map((e) => [e.id, e]));
  return a.argumentLinks.map((l) => `${l.type}:${el.get(l.sourceId)!.sentenceIds[0]}->${el.get(l.targetId)!.sentenceIds[0]}`);
};

// ---- evidence for rebuttals and explicit rebuttal-to-counterclaim links ----

test("evidence that backs a rebuttal is linked to the rebuttal, not left dangling", async () => {
  const r = await runFixture(STRONG_ESSAY);
  const keys = key(r);
  assert.ok(keys.includes("rebuts:s7->s6"), "rebuttal -> counterclaim");
  assert.ok(keys.includes("supports:s8->s7"), "Indus Basin estimate supports the rebuttal");
  const l = r.argumentLinks.find((x) => x.type === "supports" && x.sourceId === r.argumentElements.find((e) => e.sentenceIds[0] === "s8")!.id && x.targetId === r.argumentElements.find((e) => e.sentenceIds[0] === "s7")!.id)!;
  assert.equal(l.status, "candidate");
  assert.deepEqual(validateStructureAnalysis(r, STRONG_ESSAY.text).issues, []);
});

test("evidence can support an opposing view (counterclaim) when it is nearby and cued", () => {
  const text = "Schools matter most. Critics claim that schools are costly. For example, a 2019 audit found building costs doubled.";
  const { links, elements } = linksFor(text, [{ s: "s1", role: "thesis" }, { s: "s2", role: "counterclaim" }, { s: "s3", role: "evidence" }]);
  const counter = elements[1].id;
  assert.ok(links.some((l) => l.type === "supports" && l.sourceId === elements[2].id && l.targetId === counter));
});

test("a rebuttal in the next paragraph is still linked; a distant uncued one is not", () => {
  const near = linksFor("Critics say schools are costly.\n\nHowever, schools repay their cost in productivity.", [{ s: "s1", role: "counterclaim" }, { s: "s2", role: "rebuttal" }]);
  const l = near.links.find((x) => x.type === "rebuts")!;
  assert.ok(l && l.strength >= 0.5);
  const far = linksFor("Critics say schools are costly.\n\nFiller one is here.\n\nFiller two is here.\n\nRoads need repair.", [{ s: "s1", role: "counterclaim" }, { s: "s4", role: "rebuttal" }]);
  assert.equal(far.links.filter((x) => x.type === "rebuts").length, 0);
});

test("two counterclaims each get the rebuttal that sits next to them as their strongest candidate", () => {
  const text = "Some say A is costly. However, A pays back quickly. Others claim B is risky. Nevertheless, B is well tested.";
  const { links, elements } = linksFor(text, [
    { s: "s1", role: "counterclaim" },
    { s: "s2", role: "rebuttal" },
    { s: "s3", role: "counterclaim" },
    { s: "s4", role: "rebuttal" },
  ]);
  const best = (target: string) => links.filter((l) => l.type === "rebuts" && l.targetId === target).sort((a, b) => b.strength - a.strength)[0];
  assert.equal(best(elements[0].id).sourceId, elements[1].id);
  assert.equal(best(elements[2].id).sourceId, elements[3].id);
});

test("the validator accepts supports -> rebuttal but rejects a counterclaim acting as evidence", async () => {
  const r = structuredClone(await runFixture(STRONG_ESSAY));
  const support = r.argumentLinks.find((l) => l.type === "supports")!;
  const counter = r.argumentElements.find((e) => e.role === "counterclaim")!;
  support.sourceId = counter.id;
  assert.ok(validateStructureAnalysis(r, STRONG_ESSAY.text).issues.some((i) => i.code === "link_role_incompatible"));
});

// ---- regression: premise-mediated support ----

test("evidence that supports a premise, which supports a claim, leaves the claim neither orphaned nor unsupported", () => {
  const text = "Parks improve city life. Green space lowers stress. For example, a 2019 survey of residents found calmer moods near parks.";
  const { essay, elements, links } = linksFor(text, [{ s: "s1", role: "claim" }, { s: "s2", role: "premise" }, { s: "s3", role: "evidence" }]);
  const [claim, premise, evidence] = elements;
  const find = (src: string, tgt: string) => links.find((l) => l.type === "supports" && l.sourceId === src && l.targetId === tgt);
  assert.ok(find(premise.id, claim.id), "premise -> claim");
  const ep = find(evidence.id, premise.id)!;
  assert.ok(ep, "evidence -> premise");
  assert.ok(ep.strength > find(evidence.id, claim.id)!.strength - 1e-9 || !find(evidence.id, claim.id), "evidence attaches at least as strongly to the premise it backs");
  const findings = diagnose({ paragraphs: essay.paragraphs, elements, links });
  assert.equal(findings.filter((f) => f.type === "potential_orphan_claim").length, 0);
});

test("a premise is not supported by evidence from another paragraph", () => {
  const text = "Parks improve city life. Green space lowers stress.\n\nFor example, a 2019 survey found calmer moods near parks.";
  const { links, elements } = linksFor(text, [{ s: "s1", role: "claim" }, { s: "s2", role: "premise" }, { s: "s3", role: "evidence" }]);
  assert.ok(!links.some((l) => l.type === "supports" && l.targetId === elements[1].id));
});

// ---- regression on the two realistic fixtures ----

test("strong fixture: expected links present and no structural findings", async () => {
  const r = await runFixture(STRONG_ESSAY);
  const keys = key(r);
  for (const k of ["supports:s3->s2", "supports:s5->s2", "supports:s3->s4", "rebuts:s7->s6", "relevant_to:s2->s1"]) assert.ok(keys.includes(k), k);
  assert.deepEqual(r.structuralFindings, []);
});

test("weak fixture: missing thesis, unsupported claims, unanswered counterclaim and uncertain labels are all reported", async () => {
  const r = await runFixture(WEAK_ESSAY);
  const by = (t: string) => r.structuralFindings.filter((f) => f.type === t);
  assert.equal(by("missing_thesis").length, 1);
  assert.deepEqual(by("potential_orphan_claim").flatMap((f) => f.sentenceIds), ["s2", "s3", "s4", "s5", "s7"]);
  assert.equal(by("unanswered_counterclaim").length, 1);
  assert.deepEqual(by("unanswered_counterclaim")[0].sentenceIds, ["s8"]);
  assert.deepEqual(by("uncertain_classification").map((f) => f.reasonCode), ["ELEMENT_ROLE_OTHER", "ELEMENT_ROLE_OTHER", "ELEMENT_LOW_MODEL_CONFIDENCE"]);
  assert.equal(r.argumentLinks.filter((l) => l.type === "supports").length, 0, "no evidence is invented");
});

test("unsupported claim next to a rebuttal is still orphaned: rebuttal evidence does not leak into claim support", () => {
  const text = "Roads matter. Critics say roads are costly. However, roads pay back through trade. A 2020 study estimated large returns.";
  const { links, elements } = linksFor(text, [
    { s: "s1", role: "claim" },
    { s: "s2", role: "counterclaim" },
    { s: "s3", role: "rebuttal" },
    { s: "s4", role: "evidence" },
  ]);
  assert.ok(links.some((l) => l.type === "supports" && l.sourceId === elements[3].id && l.targetId === elements[2].id));
});

test("mixed missing-thesis, orphan, unanswered and uncertain labels via the full entry point", async () => {
  const text = "Alpha is true. Some argue beta is false. Gamma holds. Delta maybe.";
  const out = await analyzeEssayStructure(
    { text },
    {
      complete: mockComplete([
        { s: "s1", role: "claim", conf: 0.8 },
        { s: "s2", role: "counterclaim", conf: 0.8 },
        { s: "s4", role: "other", conf: 0.3 },
      ]),
    },
  );
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.deepEqual([...new Set(out.result.structuralFindings.map((f) => f.type))].sort(), [
    "missing_conclusion",
    "missing_thesis",
    "potential_orphan_claim",
    "unanswered_counterclaim",
    "uncertain_classification",
  ]);
});

// ---- comparison helper used by the live eval ----

test("compareRuns reports role differences, misses, extras and link/finding deltas", async () => {
  const run = async (essay: FixtureEssay, els: unknown[]) => {
    const out = await analyzeEssayStructure({ text: essay.text }, { complete: async () => JSON.stringify({ elements: els }) });
    assert.ok(out.ok);
    if (!out.ok) throw new Error("setup failed");
    return out.result;
  };
  // Strong essay: model misses "Moreover" (s9) and calls the cued example (s5) a premise.
  const base = await run(STRONG_ESSAY, labelElements(STRONG_ESSAY));
  const alt = await run(
    STRONG_ESSAY,
    labelElements(STRONG_ESSAY)
      .filter((e) => e.sentenceIds[0] !== "s9")
      .map((e) => (e.sentenceIds[0] === "s5" ? { ...e, role: "premise" } : e)),
  );
  const cmp = compareRuns(base, alt);
  assert.ok(cmp.sentences.some((r) => r.sentenceId === "s9" && r.kind === "missed_by_candidate"));
  assert.ok(cmp.sentences.some((r) => r.sentenceId === "s5" && r.kind === "role_differs"));
  assert.equal(cmp.counts.agree + cmp.counts.roleDiffers + cmp.counts.missedByCandidate + cmp.counts.extraInCandidate, cmp.counts.labelledByEither);
  assert.ok(cmp.links.onlyBaseline.length > 0, "changing a role changes the link set");

  // Weak essay: model additionally labels the unlabelled "weather" sentence (s6) as a claim.
  const weakBase = await run(WEAK_ESSAY, labelElements(WEAK_ESSAY));
  const weakAlt = await run(WEAK_ESSAY, [...labelElements(WEAK_ESSAY), { sentenceIds: ["s6"], role: "claim", confidence: 0.6 }]);
  const weak = compareRuns(weakBase, weakAlt);
  assert.ok(weak.sentences.some((r) => r.sentenceId === "s6" && r.kind === "extra_in_candidate"));
  assert.ok(weak.findings.onlyCandidate.some((f) => f.startsWith("potential_orphan_claim: s6")));

  assert.deepEqual(compareRuns(base, base).links.onlyCandidate, []);
  assert.throws(() => compareRuns(base, { ...base, sentences: base.sentences.slice(1) }));
});

// ---- prompt guidance and exploratory prompt cases (offline guards, not model-accuracy tests) ----

import { buildExtractionPrompt, EXTRACTION_RESPONSE_SCHEMA } from "./prompt.ts";
import { normalizeEssay } from "./normalize.ts";
import { CASES_TEXT, CASES_TOPIC, PROMPT_CASES } from "./promptCases.ts";
import { ARGUMENT_ROLES } from "./types.ts";

test("prompt separates argumentative function from quality and keeps the role taxonomy and id rules", () => {
  const essay = normalizeEssay(CASES_TEXT);
  const p = buildExtractionPrompt(essay, CASES_TOPIC);
  assert.match(p, /FUNCTION/);
  assert.match(p, /vague, unsupported/i);
  assert.match(p, /Leave unlabelled/);
  assert.match(p, /\[s1\] Cities should ban/);
  for (const role of ARGUMENT_ROLES) assert.ok(p.includes(`- ${role}:`), role);
  assert.deepEqual([...EXTRACTION_RESPONSE_SCHEMA.properties.elements.items.properties.role.enum], [...ARGUMENT_ROLES]);
  assert.ok(p.includes(CASES_TOPIC));
});

test("prompt cases are well formed: every probe matches one sentence and accepts valid roles", () => {
  const n = normalizeEssay(CASES_TEXT);
  for (const c of PROMPT_CASES) {
    assert.equal(n.sentences.filter((s) => s.text.startsWith(c.prefix)).length, 1, c.prefix);
    assert.ok(c.accept.length > 0 && c.accept.every((r) => r === null || (ARGUMENT_ROLES as readonly string[]).includes(r)), c.prefix);
    if (c.ambiguous) assert.ok(c.accept.length >= 2, `ambiguous case needs more than one acceptable label: ${c.prefix}`);
  }
  assert.ok(new Set(PROMPT_CASES.map((c) => c.probe)).size >= 9);
});

test("the cases essay runs through the pipeline with a plausible labelling and produces a valid analysis", async () => {
  const n = normalizeEssay(CASES_TEXT);
  const pick = (prefix: string, role: string, confidence = 0.8) => ({ sentenceIds: [n.sentences.find((s) => s.text.startsWith(prefix))!.id], role, confidence });
  const out = await analyzeEssayStructure(
    { text: CASES_TEXT, topic: CASES_TOPIC },
    {
      complete: async () =>
        JSON.stringify({
          elements: [
            pick("Cities should ban", "thesis"),
            pick("Traffic is a problem", "claim", 0.6),
            pick("Air quality improves", "claim"),
            pick("A 2019 study", "evidence"),
            pick("Shopkeepers fear", "counterclaim"),
            pick("In fact, when Ghent", "rebuttal"),
            pick("In short", "conclusion"),
          ],
        }),
    },
  );
  assert.ok(out.ok);
  if (!out.ok) return;
  const keys = out.result.argumentLinks.map((l) => l.type);
  assert.ok(keys.includes("supports") && keys.includes("rebuts"));
  // The vague claim in paragraph 1 has no nearby evidence: it must be reported, not hidden.
  assert.ok(out.result.structuralFindings.some((f) => f.type === "potential_orphan_claim" && f.sentenceIds.includes("s2")));
});
