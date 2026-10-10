import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEssayStructure } from "../structure/index.ts";
import { ESSAY_A, ESSAY_A_SPECS, mockComplete, type ElementSpec } from "../structure/testkit.ts";
import { renderFindings } from "./examinerPrompt.ts";
import { findingsFromStructure, structureInputText } from "./findings.ts";
import { absenceConflict } from "./verifyQuotes.ts";
import { essayFrom } from "./testkit.ts";

async function analyse(text: string, specs: ElementSpec[]) {
  const out = await analyzeEssayStructure({ text }, { complete: mockComplete(specs) });
  assert.ok(out.ok);
  if (!out.ok) throw new Error("setup");
  return out.result;
}

test("maps confident roles to paragraph labels; premise is omitted", async () => {
  const essay = essayFrom(ESSAY_A);
  const { findings, warnings } = findingsFromStructure(await analyse(structureInputText(essay.paragraphs), ESSAY_A_SPECS), essay);
  assert.deepEqual(warnings, []);
  assert.deepEqual(findings.structure, [
    { paragraphId: "p1", label: "Position" },
    { paragraphId: "p2", label: "Claim" },
    { paragraphId: "p2", label: "Evidence" },
    { paragraphId: "p2", label: "Counter-argument" },
    { paragraphId: "p2", label: "Rebuttal" },
    { paragraphId: "p3", label: "Conclusion" },
  ]);
  assert.ok(!findings.structure!.some((s) => s.paragraphId === "p1" && s.label === "Evidence"), "premise in p1 must not become Evidence");
});

test("links carry the best support, using heuristic strength; an unsupported claim is an orphan", async () => {
  const essay = essayFrom(ESSAY_A);
  const text = structureInputText(essay.paragraphs);
  const supported = findingsFromStructure(await analyse(text, ESSAY_A_SPECS), essay).findings.links!;
  assert.equal(supported.length, 1);
  assert.equal(supported[0].claimParagraphId, "p2");
  assert.equal(supported[0].evidenceParagraphId, "p2");
  assert.equal(supported[0].orphan, false);
  assert.ok(supported[0].similarity > 0.8 && supported[0].similarity <= 1);

  const orphan = findingsFromStructure(await analyse(text, [{ s: "s3", role: "claim" }]), essay).findings.links!;
  assert.deepEqual(orphan, [{ claimParagraphId: "p2", similarity: 0, orphan: true }]);
});

test("elements below the model-confidence floor produce no labels and no links", async () => {
  const essay = essayFrom(ESSAY_A);
  const low = ESSAY_A_SPECS.map((s) => ({ ...s, conf: 0.3 }));
  const { findings } = findingsFromStructure(await analyse(structureInputText(essay.paragraphs), low), essay);
  assert.deepEqual(findings, { structure: [], links: [] });
});

test("labels use the transcript's own paragraph ids, even when they are not p1..pN", async () => {
  const essay = essayFrom(ESSAY_A, ["p2", "p5", "p9"]);
  const { findings } = findingsFromStructure(await analyse(structureInputText(essay.paragraphs), ESSAY_A_SPECS), essay);
  assert.deepEqual([...new Set(findings.structure!.map((s) => s.paragraphId))], ["p2", "p5", "p9"]);
  assert.equal(findings.links![0].claimParagraphId, "p5");
});

test("newlines inside a transcript paragraph do not misalign paragraphs", async () => {
  const essay = essayFrom(ESSAY_A);
  essay.paragraphs[1].text = essay.paragraphs[1].text.replace("literacy. ", "literacy.\n").replace("sharply. ", "sharply.\n\n");
  const text = structureInputText(essay.paragraphs);
  assert.equal(text.split("\n\n").length, 3);
  const { warnings, findings } = findingsFromStructure(await analyse(text, ESSAY_A_SPECS), essay);
  assert.deepEqual(warnings, []);
  assert.ok(findings.structure!.length > 0);
});

test("if the structure paragraphs do not match the transcript, nothing is attached and a warning is raised", async () => {
  const analysis = await analyse(ESSAY_A, ESSAY_A_SPECS);
  const other = essayFrom("Completely different first paragraph.\n\nSecond one.\n\nThird one.");
  const r = findingsFromStructure(analysis, other);
  assert.deepEqual(r.findings, {});
  assert.match(r.warnings[0], /did not line up/);
  assert.deepEqual(findingsFromStructure(analysis, essayFrom("Only one paragraph.")).findings, {});
});

test("output feeds the examiner prompt and the absence check", async () => {
  const essay = essayFrom(ESSAY_A);
  const text = structureInputText(essay.paragraphs);
  const { findings } = findingsFromStructure(await analyse(text, ESSAY_A_SPECS), essay);
  assert.match(renderFindings(findings), /Structure labels: .*p2=Counter-argument/);
  assert.match(renderFindings(findings), /Claim-to-evidence links: p2->p2/);
  assert.ok(absenceConflict("counter-argument", findings), "a found counterclaim contradicts an examiner 'no counter-argument'");
  assert.ok(absenceConflict("thesis", findings));

  const weak = findingsFromStructure(await analyse(text, ESSAY_A_SPECS.map((s) => (s.role === "counterclaim" || s.role === "rebuttal" ? { ...s, conf: 0.3 } : s))), essay).findings;
  assert.equal(absenceConflict("counter-argument", weak), null, "a low-confidence label must not veto the examiner");
});
