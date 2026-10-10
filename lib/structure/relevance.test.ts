import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEssayStructure } from "./analyze.ts";
import { diagnose } from "./diagnose.ts";
import { buildLinks } from "./link.ts";
import { validateStructureAnalysis } from "./validate.ts";
import { buildDoc, mockComplete, type ElementSpec } from "./testkit.ts";

const THESIS = "Pakistan must invest heavily in renewable energy.";

/** Builds links and findings for `text`, optionally with a fake embedding similarity keyed by element id. */
function run(text: string, specs: ElementSpec[], sims: Record<string, number> = {}) {
  const { essay, elements } = buildDoc(text, specs);
  const similarity = Object.keys(sims).length ? (a: string, b: string) => sims[a] ?? sims[b] : undefined;
  const links = buildLinks({ sentences: essay.sentences, elements, similarity });
  const findings = diagnose({ paragraphs: essay.paragraphs, elements, links, semanticChecked: !!similarity });
  return { elements, links, findings, weak: findings.filter((f) => f.type === "weak_thesis_connection") };
}
const relLinks = (r: ReturnType<typeof run>) => r.links.filter((l) => l.type === "relevant_to");

const PARAPHRASE = `${THESIS}\n\nSolar and wind power can free the country from costly fuel imports.`;
const PARAPHRASE_SPECS: ElementSpec[] = [{ s: "s1", role: "thesis" }, { s: "s2", role: "claim" }];

test("a paraphrase sharing no words with the thesis is reported only as unconfirmed, with capped confidence", () => {
  const r = run(PARAPHRASE, PARAPHRASE_SPECS);
  assert.equal(relLinks(r).length, 0);
  assert.equal(r.weak.length, 1);
  assert.ok(r.weak[0].confidence <= 0.35, "low-overlap alone must not yield a confident finding");
  assert.equal(r.weak[0].suggestedSeverity, "info");
  assert.match(r.weak[0].description, /does not show the claim is off-topic/);
  assert.match(r.weak[0].description, /no embedding comparison ran/);
});

test("with embeddings, a clearly similar paraphrase becomes a weak candidate link and is no longer reported", () => {
  const r = run(PARAPHRASE, PARAPHRASE_SPECS, { e2: 0.83 }); // cosine seen for a true paraphrase in a live probe
  const link = relLinks(r)[0];
  assert.ok(link, "relevance link expected");
  assert.equal(link.status, "candidate");
  assert.deepEqual(link.methods.sort(), ["order", "proximity", "semantic_similarity"]);
  assert.ok(link.strength < 0.5, "semantic evidence alone stays modest");
  assert.equal(r.weak.length, 0);
});

test("an embedding score at the unrelated baseline adds nothing, so an off-topic claim is not rescued", () => {
  const text = `${THESIS}\n\nThe national cricket team has appointed a new coach.`;
  const r = run(text, PARAPHRASE_SPECS, { e2: 0.74 }); // unrelated sentences scored 0.73-0.74 in the live probe
  assert.equal(relLinks(r).length, 0);
  assert.equal(r.weak.length, 1);
  assert.match(r.weak[0].description, /embedding comparison found no tie/);
  assert.ok(r.weak[0].confidence <= 0.35, "even with embeddings, irrelevance is never asserted with confidence");
});

test("a mid-range embedding score (between baseline and paraphrase) stays unresolved: no link, finding kept as uncertain", () => {
  const r = run(PARAPHRASE, PARAPHRASE_SPECS, { e2: 0.78 });
  assert.equal(relLinks(r).length, 0);
  assert.equal(r.weak.length, 1);
  assert.ok(r.weak[0].confidence <= 0.35);
});

test("KNOWN LIMITATION: embeddings and shared wording can both favour a wrong-topic sentence, so links stay weak candidates", () => {
  const text = `${THESIS}\n\nPakistan must hold its elections on time.`;
  const noEmb = run(text, PARAPHRASE_SPECS);
  const emb = run(text, PARAPHRASE_SPECS, { e2: 0.84 }); // the "wording trap" scored 0.84 in the live probe
  for (const r of [noEmb, emb]) {
    const link = relLinks(r)[0];
    assert.ok(link, "a shared phrase yields a candidate link");
    assert.equal(link.status, "candidate");
    assert.ok(link.strength < 0.7, "never a strong link from wording or embeddings alone");
  }
  assert.ok(emb.weak.length === 0 && noEmb.weak.length === 0, "this off-topic sentence is NOT flagged: a false negative we document");
});

test("a single shared word gives only a low-strength candidate relevance link", () => {
  const text = `${THESIS}\n\nEnergy prices rose last year.`;
  const r = run(text, PARAPHRASE_SPECS);
  const link = relLinks(r)[0];
  assert.ok(link);
  assert.ok(link.strength < 0.45);
  assert.deepEqual(link.methods.includes("lexical_overlap"), true);
});

test("a genuinely off-topic claim is still reported, as unconfirmed relevance", () => {
  const r = run(`${THESIS}\n\nCricket tickets are expensive this season.`, PARAPHRASE_SPECS);
  assert.equal(r.weak.length, 1);
  assert.equal(r.weak[0].reasonCode, "CLAIM_NO_THESIS_RELEVANCE_SIGNAL");
});

// ---- indirect support / relevance through the argument graph ----

test("a claim with no wording overlap is not flagged when a premise that supports it is tied to the thesis", () => {
  const text = `${THESIS}\n\nHouseholds would save money. Renewable energy investment lowers long-term costs.`;
  const specs: ElementSpec[] = [{ s: "s1", role: "thesis" }, { s: "s2", role: "claim" }, { s: "s3", role: "premise" }];
  const r = run(text, specs);
  const [, claim, premise] = r.elements;
  assert.ok(r.links.some((l) => l.type === "supports" && l.sourceId === premise.id && l.targetId === claim.id), "premise supports claim");
  assert.ok(r.links.some((l) => l.type === "relevant_to" && l.sourceId === premise.id), "premise tied to thesis");
  assert.ok(!r.links.some((l) => l.type === "relevant_to" && l.sourceId === claim.id), "claim itself has no direct tie");
  assert.equal(r.weak.length, 0);

  const control = run(`${THESIS}\n\nHouseholds would save money.`, specs.slice(0, 2));
  assert.equal(control.weak.length, 1, "same claim without the supporting premise is reported");
});

test("evidence tied to the thesis also carries relevance to the claim it supports", () => {
  const text = `${THESIS}\n\nHouseholds would save money. For example, solar energy investment cut bills by a quarter in Punjab.`;
  const r = run(text, [{ s: "s1", role: "thesis" }, { s: "s2", role: "claim" }, { s: "s3", role: "evidence" }]);
  assert.ok(r.links.some((l) => l.type === "relevant_to" && l.sourceId === r.elements[2].id));
  assert.equal(r.weak.length, 0);
});

test("a weak direct premise link is not 'unsupported' when the premise is itself backed by solid evidence", () => {
  const text = "Parks improve city life. Green space lowers stress. For example, a 2019 survey found calmer moods near parks.";
  const specs: ElementSpec[] = [{ s: "s1", role: "claim" }, { s: "s2", role: "premise" }, { s: "s3", role: "evidence" }];
  const chained = run(text, specs);
  const direct = chained.links.find((l) => l.type === "supports" && l.targetId === chained.elements[0].id && l.sourceId === chained.elements[1].id)!;
  assert.ok(direct.strength < 0.55, "the premise link alone is weak");
  assert.equal(chained.findings.filter((f) => f.type === "potentially_unsupported_reasoning").length, 0);

  const bare = run("Parks improve city life. Green space lowers stress.", specs.slice(0, 2));
  assert.equal(bare.findings.filter((f) => f.type === "potentially_unsupported_reasoning").length, 1, "without evidence behind the premise it is still flagged");
});

// ---- end to end ----

test("end to end: relevance output stays schema-valid, deterministic, and states whether embeddings were used", async () => {
  const input = { text: PARAPHRASE, useSemanticSimilarity: true };
  const complete = mockComplete(PARAPHRASE_SPECS);
  const now = () => new Date(0);
  const low = await analyzeEssayStructure(input, { complete, now, embed: async (t) => t.map((_, i) => (i === 0 ? [1, 0] : [0.74, Math.sqrt(1 - 0.74 ** 2)])) });
  const high = await analyzeEssayStructure(input, { complete, now, embed: async (t) => t.map((_, i) => (i === 0 ? [1, 0] : [0.83, Math.sqrt(1 - 0.83 ** 2)])) });
  const none = await analyzeEssayStructure({ text: PARAPHRASE }, { complete, now });
  assert.ok(low.ok && high.ok && none.ok);
  if (!(low.ok && high.ok && none.ok)) return;
  assert.equal(low.result.structuralFindings.filter((f) => f.type === "weak_thesis_connection").length, 1);
  assert.equal(high.result.structuralFindings.filter((f) => f.type === "weak_thesis_connection").length, 0);
  assert.match(low.result.structuralFindings.find((f) => f.type === "weak_thesis_connection")!.description, /embedding comparison found no tie/);
  assert.match(none.result.structuralFindings.find((f) => f.type === "weak_thesis_connection")!.description, /no embedding comparison ran/);
  for (const r of [low, high, none]) if (r.ok) assert.deepEqual(validateStructureAnalysis(r.result, PARAPHRASE).issues, []);
  const again = await analyzeEssayStructure(input, { complete, now, embed: async (t) => t.map((_, i) => (i === 0 ? [1, 0] : [0.83, Math.sqrt(1 - 0.83 ** 2)])) });
  assert.deepEqual(again, high);
});

test("the validator accepts evidence -> thesis relevance but not a counterclaim as its source", async () => {
  const text = `${THESIS}\n\nHouseholds would save money. For example, solar energy investment cut bills by a quarter in Punjab.`;
  const out = await analyzeEssayStructure({ text }, { complete: mockComplete([{ s: "s1", role: "thesis" }, { s: "s2", role: "claim" }, { s: "s3", role: "evidence" }]) });
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.deepEqual(validateStructureAnalysis(out.result, text).issues, []);
  const bad = structuredClone(out.result);
  const rel = bad.argumentLinks.find((l) => l.type === "relevant_to")!;
  bad.argumentElements.find((e) => e.id === rel.sourceId)!.role = "counterclaim";
  assert.ok(validateStructureAnalysis(bad, text).issues.some((i) => i.code === "link_role_incompatible"));
});
