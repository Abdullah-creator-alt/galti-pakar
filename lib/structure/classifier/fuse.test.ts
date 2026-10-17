import assert from "node:assert/strict";
import test from "node:test";
import { mapSpansToSentences } from "./adapter.ts";
import { fuseRoles } from "./fuse.ts";
import type { SentenceNode } from "../types.ts";
import type { ExtractedElement } from "../extract.ts";
import type { ClassifierPredictedSpan } from "./types.ts";

test("mapSpansToSentences: maps character spans to sentence candidate roles with 50% overlap", () => {
  const sentences: SentenceNode[] = [
    { id: "s1", index: 0, paragraphId: "p1", indexInParagraph: 0, start: 0, end: 50, text: "Sentence 1 is a claim." },
    { id: "s2", index: 1, paragraphId: "p1", indexInParagraph: 1, start: 52, end: 120, text: "Sentence 2 provides detailed evidence supporting it." },
  ];

  const spans: ClassifierPredictedSpan[] = [
    { start: 0, end: 48, label: "Claim", confidence: 0.88 },
    { start: 52, end: 120, label: "Evidence", confidence: 0.92 },
  ];

  const candidates = mapSpansToSentences(spans, sentences);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].sentenceId, "s1");
  assert.equal(candidates[0].role, "claim");
  assert.equal(candidates[1].sentenceId, "s2");
  assert.equal(candidates[1].role, "evidence");
});

test("mapSpansToSentences: ignores spans with under 50% overlap", () => {
  const sentences: SentenceNode[] = [
    { id: "s1", index: 0, paragraphId: "p1", indexInParagraph: 0, start: 0, end: 100, text: "Long sentence with minor overlap." },
  ];
  // Span covers only 10 chars of 100
  const spans: ClassifierPredictedSpan[] = [
    { start: 0, end: 10, label: "Claim" },
  ];

  const candidates = mapSpansToSentences(spans, sentences);
  assert.equal(candidates.length, 0);
});

test("fuseRoles: preserves Gemini outputs when mode is off", () => {
  const gemini: ExtractedElement[] = [
    { sentenceIds: ["s1"], role: "claim", modelConfidence: 0.7 },
  ];
  const candidates = [
    { sentenceId: "s1", role: "evidence" as const, confidence: 0.9, coverage: 1.0 },
  ];

  const fused = fuseRoles(gemini, candidates, { mode: "off" });
  assert.deepEqual(fused, gemini);
});

test("fuseRoles: boosts confidence on direct agreement and evidence/premise equivalence", () => {
  const gemini: ExtractedElement[] = [
    { sentenceIds: ["s1"], role: "claim", modelConfidence: 0.7 },
    { sentenceIds: ["s2"], role: "premise", modelConfidence: 0.6 },
  ];
  const candidates = [
    { sentenceId: "s1", role: "claim" as const, confidence: 0.8, coverage: 1.0 },
    { sentenceId: "s2", role: "evidence" as const, confidence: 0.9, coverage: 1.0 },
  ];

  const fused = fuseRoles(gemini, candidates, { mode: "hybrid" });
  assert.equal(fused[0].modelConfidence, 0.85); // 0.70 + 0.15
  assert.equal(fused[1].modelConfidence, 0.75); // 0.60 + 0.15
});

test("fuseRoles: preserves Gemini role and sets alternativeRole and lower confidence on disagreement", () => {
  const gemini: ExtractedElement[] = [
    { sentenceIds: ["s1"], role: "conclusion", modelConfidence: 0.85 },
  ];
  const candidates = [
    { sentenceId: "s1", role: "thesis" as const, confidence: 0.75, coverage: 1.0 },
  ];

  const fused = fuseRoles(gemini, candidates, { mode: "hybrid" });
  assert.equal(fused[0].role, "conclusion"); // Gemini primary role preserved
  assert.equal(fused[0].alternativeRole, "thesis"); // Classifier alternative recorded
  assert.equal(fused[0].modelConfidence, 0.45); // Lowered confidence to trigger uncertain_classification
});
