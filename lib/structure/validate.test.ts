import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEssayStructure } from "./analyze.ts";
import { validateStructureAnalysis } from "./validate.ts";
import type { StructureAnalysis } from "./types.ts";
import { ESSAY_A, ESSAY_A_SPECS, mockComplete } from "./testkit.ts";

async function sample(): Promise<StructureAnalysis> {
  // Drop the thesis and conclusion so there are findings whose references can be tampered with.
  const specs = ESSAY_A_SPECS.filter((s) => s.role !== "thesis" && s.role !== "conclusion" && s.role !== "rebuttal");
  const out = await analyzeEssayStructure({ text: ESSAY_A }, { complete: mockComplete(specs) });
  assert.ok(out.ok);
  if (!out.ok) throw new Error("setup failed");
  return structuredClone(out.result);
}

const codes = (a: unknown) => validateStructureAnalysis(a, ESSAY_A).issues.map((i) => i.code);

test("an untouched result passes every check", async () => {
  const r = await sample();
  assert.deepEqual(validateStructureAnalysis(r, ESSAY_A).issues, []);
  assert.ok(r.structuralFindings.length > 0 && r.argumentLinks.length > 0);
});

test("detects source text that no longer matches the essay", async () => {
  const r = await sample();
  r.sentences[0].text = "Something else entirely.";
  assert.ok(codes(r).includes("sentence_text_mismatch"));
  const r2 = await sample();
  r2.argumentElements[0].text = r2.argumentElements[0].text + "!";
  assert.ok(codes(r2).includes("element_text_mismatch"));
  assert.ok(codes(await sample()).length === 0);
  const r3 = await sample();
  assert.ok(validateStructureAnalysis(r3, ESSAY_A + " extra").issues.some((i) => i.code === "metadata_mismatch"));
});

test("detects unknown sentence, element, link and paragraph references", async () => {
  const r = await sample();
  r.argumentElements[0].sentenceIds = ["s99"];
  assert.ok(codes(r).includes("element_unknown_sentence"));

  const l = await sample();
  l.argumentLinks[0].sourceId = "e99";
  assert.ok(codes(l).includes("link_unknown_element"));

  const f = await sample();
  f.structuralFindings[0].paragraphIds = ["p99"];
  f.structuralFindings[0].elementIds = ["e99"];
  f.structuralFindings[0].linkIds = ["l99"];
  f.structuralFindings[0].sentenceIds = ["s99"];
  const c = codes(f);
  for (const code of ["finding_unknown_paragraph", "finding_unknown_element", "finding_unknown_link", "finding_unknown_sentence"]) assert.ok(c.includes(code), code);
});

test("detects duplicate ids, impossible relationships and self links", async () => {
  const d = await sample();
  d.argumentElements[1].id = d.argumentElements[0].id;
  assert.ok(codes(d).includes("duplicate_id"));

  const i = await sample();
  const claim = i.argumentElements.find((e) => e.role === "claim")!;
  i.argumentLinks[0].type = "rebuts";
  i.argumentLinks[0].targetId = claim.id;
  assert.ok(codes(i).includes("link_role_incompatible"));

  const s = await sample();
  s.argumentLinks[0].targetId = s.argumentLinks[0].sourceId;
  assert.ok(codes(s).includes("link_self_reference"));
});

test("detects invalid confidences, unsupported enums and missing fields", async () => {
  const c = await sample();
  c.argumentElements[0].modelConfidence = 1.4;
  c.argumentLinks[0].strength = -0.2;
  c.structuralFindings[0].confidence = 2;
  assert.ok(codes(c).includes("schema_shape"));

  const e = await sample();
  (e.argumentElements[0] as { role: string }).role = "villain";
  assert.deepEqual(codes(e), ["schema_shape"]);

  const m = (await sample()) as unknown as Record<string, unknown>;
  delete m.structuralFindings;
  assert.ok(codes(m).includes("schema_shape"));
  assert.ok(codes(null).includes("schema_shape"));
});

test("detects overlapping elements and a link strength that disagrees with its signals", async () => {
  const o = await sample();
  o.argumentElements[1].sentenceIds = [...o.argumentElements[0].sentenceIds];
  assert.ok(codes(o).includes("element_overlap"));
  const st = await sample();
  st.argumentLinks[0].strength = Math.min(1, st.argumentLinks[0].strength + 0.2);
  assert.ok(codes(st).includes("link_strength_mismatch"));
});
