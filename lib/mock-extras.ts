/**
 * Example extras for the built-in example report. Everything here is invented sample data (the report itself is
 * flagged isExample), written so that every offset points at real text in the mock report.
 */
import { mockReport } from "./mock.ts";
import type { AnalysisBundle, PassageRef, ReportExtras, SpanTrace } from "./types.extras.ts";
import { spanKey } from "./types.extras.ts";
import type { EssayReport } from "./types.ts";

const para = (id: string) => mockReport.paragraphs.find((p) => p.id === id)!;

/** Offsets of an exact phrase in a paragraph. Throws at build time if the mock text is edited and the phrase is gone. */
function at(paragraphId: string, phrase: string): PassageRef {
  const start = para(paragraphId).text.indexOf(phrase);
  if (start < 0) throw new Error(`mock-extras: "${phrase}" not found in ${paragraphId}`);
  return { paragraphId, start, end: start + phrase.length };
}
const spanRef = (paragraphId: string, i: number): PassageRef => {
  const s = para(paragraphId).spans[i];
  return { paragraphId, start: s.start, end: s.end };
};
const key = (r: PassageRef) => spanKey(r.paragraphId, r.start, r.end);

const SLOT = "[add a figure from the latest Pakistan Economic Survey on this point]";

/** The example report with one bracketed slot in the model paragraph, so the slot style is visible. */
export const exampleReport: EssayReport = {
  ...mockReport,
  rewrite: {
    ...mockReport.rewrite,
    improved: `${mockReport.rewrite.improved} ${SLOT}`,
    added: [...(mockReport.rewrite.added ?? []), SLOT],
  },
};

// Passages used by the claim map.
const claimStrong = at("p2", "Agriculture is the first channel through which a warming climate reaches the economy.");
const evidenceStrong = spanRef("p2", 0);
const claimWeak = at("p7", "Policy must therefore move from relief to resilience.");
const evidenceWeak = at("p7", "The country needs flood-resistant infrastructure, early warning systems, water storage and crop insurance");
const claimOrphan = spanRef("p4", 0); // a red (unsupported) span in the mock report, so the map and the colours agree
const counter = at("p7", "Climate finance, including the loss and damage fund agreed at COP27, can help");

const trace: Record<string, SpanTrace> = {
  [key(spanRef("p4", 0))]: {
    ruleId: "orphan_claim",
    similarity: 0.31,
    threshold: 0.45,
    steps: [
      { stage: "read", text: "Read from your handwriting as part of paragraph 4." },
      { stage: "label", text: "Labelled as a claim (model confidence 0.80)." },
      { stage: "link", text: "Looked for evidence in paragraphs 3 to 5. Best match scored 0.31." },
      { stage: "rule", text: "A claim with no match above 0.45 counts as having no linked evidence." },
      { stage: "verify", text: "Checked: these words are at this exact place in your essay." },
    ],
  },
  [key(spanRef("p2", 1))]: {
    ruleId: "weak_link_claim",
    similarity: 0.52,
    threshold: 0.6,
    linked: spanRef("p3", 0),
    steps: [
      { stage: "read", text: "Read from your handwriting as part of paragraph 2." },
      { stage: "label", text: "Labelled as a claim." },
      { stage: "link", text: "Closest evidence is in paragraph 3 (similarity 0.52)." },
      { stage: "rule", text: "A match between 0.45 and 0.60 is a weak link, not a supported claim." },
      { stage: "verify", text: "Checked: both passages are at the exact places shown." },
    ],
  },
  [key(spanRef("p3", 0))]: {
    ruleId: "specific_evidence",
    steps: [
      { stage: "read", text: "Read from your handwriting as part of paragraph 3." },
      { stage: "label", text: "Labelled as evidence." },
      { stage: "rule", text: "Evidence with a named source and a figure counts as specific." },
      { stage: "verify", text: "Checked: these words are at this exact place in your essay." },
    ],
  },
  [key(spanRef("p5", 1))]: {
    ruleId: "generic_sentence",
    steps: [
      { stage: "read", text: "Read from your handwriting as part of paragraph 5." },
      { stage: "rule", text: "Wording close to known filler that could sit in any essay, with no names, figures or places." },
      { stage: "verify", text: "Checked: these words are at this exact place in your essay." },
    ],
  },
};

export const mockExtras: ReportExtras = {
  trace,
  claimMap: {
    links: [
      { id: "l1", kind: "claim", claim: claimStrong, evidence: evidenceStrong, similarity: 0.88, strength: "strong" },
      { id: "l2", kind: "claim", claim: claimWeak, evidence: evidenceWeak, similarity: 0.52, strength: "weak" },
      { id: "l3", kind: "claim", claim: claimOrphan, similarity: 0.31, strength: "orphan" },
      { id: "l4", kind: "counterclaim", claim: counter, strength: "unrebutted" },
    ],
    summary: { claimsTotal: 3, strong: 1, weak: 1, orphan: 1, unrebutted: 1 },
  },
  conflicts: [
    {
      id: "evidence_praised_but_orphans",
      dimension: "evidence",
      examinerSays: "The AI examiner gave Evidence 7.0 out of 10 and praised the use of figures.",
      measuredSays: "The measurements found that 1 of 3 claims has no linked evidence, and 1 more is only weakly linked.",
    },
  ],
  verification: {
    spansProposed: 17,
    spansDropped: 1,
    quotesProposed: 14,
    quotesVerified: 13,
    quotesRejected: 1,
    conflictsFound: 1,
    examinerAgreementRate: 0.86,
    labelAgreementRate: 0.82,
  },
  transcription: {
    legibility: "fair",
    uncertain: [
      { paragraphId: "p3", word: "submerged", guess: "submerged" },
      { paragraphId: "p6", word: "hydropower", guess: "hydropower" },
    ],
  },
  rewriteExtras: {
    changeNotes: [
      { what: "Removed the opening cliché and the proverb.", why: "They could sit in any essay and say nothing about climate." },
      { what: "Tied the paragraph to the topic and added a slot for a figure.", why: "A claim needs evidence you look up and verify yourself." },
    ],
    placeholders: [SLOT],
  },
  // A second weak paragraph (paragraph 4 drifts off topic), so the example also shows more than one before/after.
  moreRewrites: [
    (() => {
      const original = para("p4").text;
      const removed = "A better educated population would, in general, make better decisions about every national problem.";
      const added = "A better educated workforce is also better placed to adapt to a warming climate, from new farming methods to flood preparedness.";
      if (!original.includes(removed)) throw new Error("mock-extras: p4 text changed, update the second rewrite");
      return {
        paragraphId: "p4",
        original,
        improved: original.replace(removed, added),
        removed: [removed],
        added: [added],
        changeNotes: [{ what: "Tied the education point back to the essay's topic.", why: "The paragraph drifted from climate and the economy; a claim needs a link to the question." }],
        placeholders: [],
      };
    })(),
  ],
  benchmark: {
    status: "ok",
    themeLabel: "Climate, water and environment",
    nReferences: 6,
    coverage: {
      covered: 5,
      total: 8,
      basis: "reference",
      missing: [
        { point: "Glacier melt threatens the long-term flow of the Indus river system.", madeByCount: 5, ofN: 6 },
        { point: "Small dams and water storage reduce flood and drought risk.", madeByCount: 4, ofN: 6 },
        { point: "Heatwaves lower labour productivity outdoors.", madeByCount: null, ofN: null },
      ],
    },
    profile: [
      { label: "Concrete details per 100 words", value: 3.1, refQ1: 3.8, refQ3: 5.6, position: "below", betterDirection: "higher" },
      { label: "Clichés per 100 words", value: 0.34, refQ1: 0.05, refQ3: 0.3, position: "above", betterDirection: "lower" },
      { label: "Share of generic sentences", value: 0.18, refQ1: 0.1, refQ3: 0.3, position: "within", betterDirection: "lower" },
    ],
    disclaimers: ["Example data: these reference figures are invented for this sample report."],
  },
  warnings: ["Example data: this report and everything beside it is sample content, not an analysis of your essay."],
};

export const mockBundle: AnalysisBundle = { report: exampleReport, extras: mockExtras };
