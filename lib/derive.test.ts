import test from "node:test";
import assert from "node:assert/strict";
import { bandForScore, driftingParagraphs, examinerAgreement, highlightCounts, missingRoles } from "./derive.ts";
import { mockReport } from "./mock.ts";

test("bandForScore thresholds", () => {
  assert.equal(bandForScore(7, 10), "competitive");
  assert.equal(bandForScore(6.9, 10), "borderline");
  assert.equal(bandForScore(5, 10), "borderline");
  assert.equal(bandForScore(4.9, 10), "below-pass");
});

test("mock report states are all visible", () => {
  assert.deepEqual(driftingParagraphs(mockReport.paragraphs, 50).map((p) => p.id), ["p4", "p5"]);
  assert.deepEqual(missingRoles(mockReport.paragraphs), ["counter-argument"]);
  const a = examinerAgreement(mockReport.examiners);
  assert.equal(a.modalCount, 2);
  assert.equal(a.state, "partial");
  assert.deepEqual(a.differing, ["evidence", "counter-argument"]);
  assert.deepEqual(a.range, ["borderline", "competitive"]);
});

test("single examiner is never a panel", () => {
  assert.equal(examinerAgreement(mockReport.examiners.slice(0, 1)).state, "absent");
});

test("highlight counts add up", () => {
  const c = highlightCounts(mockReport.paragraphs);
  assert.equal(c.strong + c.weak + c.offtopic, mockReport.paragraphs.reduce((n, p) => n + p.spans.length, 0));
});
