import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEssay } from "./normalize.ts";

function assertExact(text: string) {
  const n = normalizeEssay(text);
  for (const s of n.sentences) assert.equal(text.slice(s.start, s.end), s.text);
  for (const p of n.paragraphs) assert.equal(text.slice(p.start, p.end), p.text);
  return n;
}

test("splits paragraphs on blank lines and numbers ids in reading order", () => {
  const n = assertExact("One is here. Two is here.\n\nThree is here.");
  assert.deepEqual(n.paragraphs.map((p) => p.id), ["p1", "p2"]);
  assert.deepEqual(n.sentences.map((s) => s.id), ["s1", "s2", "s3"]);
  assert.deepEqual(n.paragraphs[0].sentenceIds, ["s1", "s2"]);
  assert.equal(n.sentences[2].paragraphId, "p2");
  assert.equal(n.sentences[1].indexInParagraph, 1);
});

test("offsets are exact into the original string, including CRLF and odd whitespace", () => {
  const text = "  Water   is vital!!  But  nobody cares...\r\n\r\n\r\n   secondly , we waste it.  \r\n";
  const n = assertExact(text);
  assert.equal(n.paragraphs.length, 2);
  assert.ok(n.sentences.every((s) => s.text === s.text.trim()));
});

test("hard-wrapped lines stay in one paragraph", () => {
  const n = assertExact("Pakistan faces a water\ncrisis that grows every year and\nneeds action now.");
  assert.equal(n.paragraphs.length, 1);
  assert.equal(n.sentences.length, 1);
});

test("single newlines become paragraph breaks only when every line ends a sentence", () => {
  const n = assertExact("First paragraph ends here.\nSecond paragraph ends here.");
  assert.equal(n.paragraphs.length, 2);
  assert.ok(n.warnings.some((w) => w.code === "single_newline_paragraphs"));
});

test("abbreviations, decimals and quotes do not split sentences", () => {
  const n = assertExact('Dr. Khan said GDP grew 3.5 percent. "It is enough," he added. The U.S. agreed.');
  assert.equal(n.sentences.length, 3);
});

test("unusual punctuation and lowercase text do not crash and warn", () => {
  const n = assertExact("water is vital. it matters... really?! yes. we must act. now. ok.");
  assert.ok(n.sentences.length >= 1);
  assert.ok(n.warnings.some((w) => w.code === "lowercase_sentence_starts"));
});

test("is deterministic", () => {
  const t = "A b c. D e f.\n\nG h i.";
  assert.deepEqual(normalizeEssay(t), normalizeEssay(t));
});
