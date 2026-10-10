import test from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "./diagnose.ts";
import { buildLinks } from "./link.ts";
import { buildDoc, ESSAY_A, ESSAY_A_SPECS, linksFor } from "./testkit.ts";

const run = (text: string, specs: Parameters<typeof linksFor>[1]) => {
  const { essay, elements, links } = linksFor(text, specs);
  return { essay, elements, links, findings: diagnose({ paragraphs: essay.paragraphs, elements, links }) };
};

test("claim with identifiable evidence gets a strong supports link and no orphan finding", () => {
  const { elements, links, findings } = run(ESSAY_A, ESSAY_A_SPECS);
  const claim = elements.find((e) => e.role === "claim")!;
  const evidence = elements.find((e) => e.role === "evidence")!;
  const link = links.find((l) => l.type === "supports" && l.targetId === claim.id)!;
  assert.equal(link.sourceId, evidence.id);
  assert.equal(link.targetId, claim.id);
  assert.equal(link.status, "candidate");
  assert.ok(link.strength > 0.8);
  assert.ok(link.methods.includes("discourse_cue") && link.methods.includes("proximity"));
  assert.equal(findings.filter((f) => f.type === "potential_orphan_claim" || f.type === "potentially_unsupported_reasoning").length, 0);
});

test("claim with no evidence in the essay is a potential orphan", () => {
  const text = "Renewable energy is the future of Pakistan. Cities must reduce traffic congestion. Rivers matter to farmers.";
  const { findings, links } = run(text, [{ s: "s1", role: "thesis" }, { s: "s2", role: "claim" }]);
  assert.equal(links.filter((l) => l.type === "supports").length, 0);
  const orphan = findings.find((f) => f.type === "potential_orphan_claim")!;
  assert.equal(orphan.reasonCode, "CLAIM_NO_CANDIDATE_EVIDENCE");
  assert.deepEqual(orphan.sentenceIds, ["s2"]);
  assert.deepEqual(orphan.linkIds, []);
});

test("evidence several paragraphs away with no cue is not linked; proximity alone is never proof", () => {
  const text = "Taxes fund schools.\n\nFiller one is here.\n\nFiller two is here.\n\nThe budget was 5 billion rupees.";
  const { links, findings } = run(text, [{ s: "s1", role: "claim" }, { s: "s4", role: "evidence" }]);
  assert.equal(links.length, 0);
  assert.ok(findings.some((f) => f.type === "potential_orphan_claim"));
});

test("adjacent evidence without cue or overlap is only weak support", () => {
  const text = "Taxes fund schools. Rainfall varied across provinces.";
  const { links, findings } = run(text, [{ s: "s1", role: "claim" }, { s: "s2", role: "evidence" }]);
  assert.equal(links.length, 1);
  assert.ok(links[0].strength < 0.55);
  const f = findings.find((x) => x.type === "potentially_unsupported_reasoning")!;
  assert.deepEqual(f.linkIds, [links[0].id]);
});

test("a contrast cue in the supporting sentence counts against support", () => {
  const text = "Taxes fund schools. However, rainfall varied across provinces.";
  const { links } = run(text, [{ s: "s1", role: "claim" }, { s: "s2", role: "evidence" }]);
  assert.equal(links.length, 1);
  assert.ok(links[0].signals.some((x) => x.kind === "contrast_penalty" && x.value < 0));
  assert.ok(links[0].strength < 0.55);
});

test("a result cue in the claim links the preceding premise", () => {
  const text = "Schools raise literacy. Therefore, nations should fund schools.";
  const { links } = run(text, [{ s: "s1", role: "premise" }, { s: "s2", role: "claim" }]);
  const l = links.find((x) => x.type === "supports")!;
  assert.ok(l.signals.some((x) => x.kind === "discourse_cue" && /therefore/.test(x.detail)));
});

test("temporal 'since 1947' is not read as a reason cue", () => {
  const text = "Pakistan faces growth limits. Since 1947 the nation has grown slowly.";
  const { links } = run(text, [{ s: "s1", role: "claim" }, { s: "s2", role: "evidence" }]);
  assert.ok(!links[0]?.signals.some((x) => x.kind === "discourse_cue"));
});

test("counterclaim with an identifiable rebuttal is linked and not flagged", () => {
  const { elements, links, findings } = run(ESSAY_A, ESSAY_A_SPECS);
  const counter = elements.find((e) => e.role === "counterclaim")!;
  const rebut = elements.find((e) => e.role === "rebuttal")!;
  const l = links.find((x) => x.type === "rebuts")!;
  assert.equal(l.sourceId, rebut.id);
  assert.equal(l.targetId, counter.id);
  assert.ok(l.signals.some((s) => s.kind === "discourse_cue"));
  assert.ok(links.some((x) => x.type === "challenges" && x.sourceId === counter.id));
  assert.equal(findings.filter((f) => f.type === "unanswered_counterclaim").length, 0);
});

test("counterclaim with no rebuttal is flagged; a rebuttal-free essay with no counterclaim is not", () => {
  const withCounter = run("Schools matter. Some critics argue that schools are costly. Roads matter too.", [
    { s: "s1", role: "thesis" },
    { s: "s2", role: "counterclaim" },
  ]);
  const f = withCounter.findings.find((x) => x.type === "unanswered_counterclaim")!;
  assert.equal(f.reasonCode, "COUNTERCLAIM_NO_CANDIDATE_REBUTTAL");
  assert.ok(f.linkIds.length >= 0);
  const without = run("Schools matter. Roads matter too.", [{ s: "s1", role: "thesis" }, { s: "s2", role: "conclusion" }]);
  assert.equal(without.findings.filter((x) => x.type === "unanswered_counterclaim").length, 0);
});

test("essay with no thesis gets missing_thesis anchored on the first paragraph", () => {
  const { findings } = run(ESSAY_A, ESSAY_A_SPECS.filter((s) => s.role !== "thesis"));
  const f = findings.find((x) => x.type === "missing_thesis")!;
  assert.equal(f.reasonCode, "NO_THESIS_ELEMENT");
  assert.deepEqual(f.paragraphIds, ["p1"]);
  assert.equal(f.suggestedSeverity, "high");
});

test("a low-confidence thesis does not count as a clear thesis", () => {
  const { findings } = run(ESSAY_A, ESSAY_A_SPECS.map((s) => (s.role === "thesis" ? { ...s, conf: 0.3 } : s)));
  const f = findings.find((x) => x.type === "missing_thesis")!;
  assert.equal(f.reasonCode, "THESIS_LOW_MODEL_CONFIDENCE");
});

test("missing conclusion is reported on the last paragraph", () => {
  const { findings } = run(ESSAY_A, ESSAY_A_SPECS.filter((s) => s.role !== "conclusion"));
  const f = findings.find((x) => x.type === "missing_conclusion")!;
  assert.deepEqual(f.paragraphIds, ["p3"]);
});

test("claims unrelated to the thesis get weak_thesis_connection; related ones do not", () => {
  const text = "Renewable energy is the future of Pakistan. Cities must reduce traffic congestion. Renewable energy lowers costs.";
  const { findings } = run(text, [{ s: "s1", role: "thesis" }, { s: "s2", role: "claim" }, { s: "s3", role: "claim" }]);
  const weak = findings.filter((f) => f.type === "weak_thesis_connection");
  assert.deepEqual(weak.map((f) => f.sentenceIds), [["s2"]]);
});

test("uncertain classification covers 'other', low confidence and ambiguous roles", () => {
  const { findings } = run("Alpha is here. Beta is here. Gamma is here. Delta is here.", [
    { s: "s1", role: "other" },
    { s: "s2", role: "claim", conf: 0.3 },
    { s: "s3", role: "claim", conf: 0.6, alt: "thesis" },
    { s: "s4", role: "claim", conf: 0.9, alt: "thesis" },
  ]);
  const codes = findings.filter((f) => f.type === "uncertain_classification").map((f) => f.reasonCode);
  assert.deepEqual(codes, ["ELEMENT_ROLE_OTHER", "ELEMENT_LOW_MODEL_CONFIDENCE", "ELEMENT_AMBIGUOUS_ROLE"]);
});

test("linking and diagnostics are deterministic and strength equals the clamped signal sum", () => {
  const a = run(ESSAY_A, ESSAY_A_SPECS);
  const b = run(ESSAY_A, ESSAY_A_SPECS);
  assert.deepEqual(a.links, b.links);
  assert.deepEqual(a.findings, b.findings);
  for (const l of a.links) {
    const sum = Math.min(1, Math.max(0, l.signals.reduce((s, x) => s + x.value, 0)));
    assert.ok(Math.abs(sum - l.strength) < 0.01);
  }
});

test("semantic similarity adds a bounded signal but cannot create a link without a structural signal", () => {
  const far = "Taxes fund schools.\n\nFiller one is here.\n\nFiller two is here.\n\nThe budget was 5 billion rupees.";
  const { essay, elements } = buildDoc(far, [{ s: "s1", role: "claim" }, { s: "s4", role: "evidence" }]);
  const similarity = () => 0.95;
  assert.equal(buildLinks({ sentences: essay.sentences, elements, similarity }).length, 0);

  const near = "Taxes fund schools. Rainfall varied across provinces.";
  const d = buildDoc(near, [{ s: "s1", role: "claim" }, { s: "s2", role: "evidence" }]);
  const without = buildLinks({ sentences: d.essay.sentences, elements: d.elements });
  const withSem = buildLinks({ sentences: d.essay.sentences, elements: d.elements, similarity });
  assert.ok(withSem[0].strength > without[0].strength);
  assert.ok(withSem[0].strength - without[0].strength <= 0.25 + 1e-9);
  assert.ok(withSem[0].methods.includes("semantic_similarity"));
});
