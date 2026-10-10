/**
 * Example extras for the built-in example report. Everything here is invented sample data (the report itself is
 * flagged isExample), written so that every offset points at real text in the mock report.
 */
import { mockReport } from "./mock.ts";
import { CSS_ESSAY_PROFILE, FPSC_QUOTES, FPSC_SYLLABUS_DOC_ID } from "./profiles/cssEssay.ts";
import type { AnalysisBundle, CssCriterionRow, CssProfileInfo, PassageRef, ReportExtras, SpanTrace } from "./types.extras.ts";
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

/**
 * Sample "For the CSS English Essay" data, consistent with the example report above (invented, like the rest of it):
 * claims in P2 (supported), P7 (weakly supported) and P4 (no support found), an opposing view in P7 with no response,
 * a thesis in P1, a conclusion in P8, and drift in P4 and P5. Titles, quotes and limits come from the real registry.
 */
const SIGNAL = {
  orphan: "No supporting evidence or reasoning was identified for this claim. It may be supported implicitly or elsewhere.",
  weak: "Candidate support exists but rests only on weak structural signals such as nearness, so the support is uncertain.",
  unanswered: "An opposing view is raised but no response to it was identified.",
  tie: "Wording, nearness and support links found no tie between this claim and the thesis (no embedding comparison ran). This does not show the claim is off-topic; a paraphrase or implicit link may be missed.",
};
const NONE = "The analysis flagged nothing here. That is not a judgement that this part is strong.";
const sampleRows: Record<string, Pick<CssCriterionRow, "status" | "observations" | "note">> = {
  "CSS-ESSAY-001": { status: "none_flagged", observations: [], note: NONE },
  "CSS-ESSAY-002": { status: "not_assessed", observations: [], note: "No check in this tool covers this criterion." },
  "CSS-ESSAY-003": { status: "signals", observations: [{ text: SIGNAL.tie, paragraphIds: ["p5"] }] },
  "CSS-ESSAY-004": { status: "signals", observations: [{ text: SIGNAL.orphan, paragraphIds: ["p4"] }, { text: SIGNAL.weak, paragraphIds: ["p7"] }] },
  "CSS-ESSAY-005": { status: "not_assessed", observations: [], note: "No check in this tool covers this criterion." },
  "CSS-ESSAY-006": { status: "signals", observations: [{ text: SIGNAL.unanswered, paragraphIds: ["p7"] }] },
  "CSS-ESSAY-007": { status: "none_flagged", observations: [], note: NONE },
  "CSS-ESSAY-008": { status: "signals", observations: [{ text: SIGNAL.orphan, paragraphIds: ["p4"] }, { text: SIGNAL.weak, paragraphIds: ["p7"] }] },
  "CSS-ESSAY-009": { status: "not_assessed", observations: [], note: "This tool does not assess language or style." },
};
const syllabus = CSS_ESSAY_PROFILE.provenance.documents.find((d) => d.id === FPSC_SYLLABUS_DOC_ID)!;
const cssSample: CssProfileInfo = {
  profileId: CSS_ESSAY_PROFILE.profileId,
  profileVersion: CSS_ESSAY_PROFILE.version,
  source: { title: syllabus.title, url: syllabus.url!, locator: CSS_ESSAY_PROFILE.criteria.find((c) => c.sourceLocator)!.sourceLocator!, retrievedOn: syllabus.retrievedOn! },
  insights: [
    { id: "attention", kind: "attention", headline: "Start by re-reading P7", detail: "This paragraph holds 2 of the 4 paragraph-level signals. Signals mark places to re-read; they are not errors.", paragraphIds: ["p7"] },
    { id: "support", kind: "support", headline: "2 of 3 claims need a closer look for support", detail: "1 claim with no supporting passage identified and 1 claim with only weak signs of support. Support may be implicit or elsewhere in the essay, so check each marked claim before deciding anything.", paragraphIds: ["p4", "p7"] },
    { id: "position", kind: "position", headline: "A central position was identified", detail: "It was found in P1. This shows a stated position exists, not that it is clear or well argued.", paragraphIds: ["p1"] },
    { id: "ending", kind: "ending", headline: "A concluding passage was identified", detail: "It was found in P8. Whether it matches the position and arguments was not assessed.", paragraphIds: ["p8"] },
    { id: "opposing", kind: "opposing", headline: "1 opposing view raised, 1 without an identified response", detail: "A response may be implicit or placed elsewhere. Whether each view needs a reply is for the examiner to decide.", paragraphIds: ["p7"] },
    { id: "relevance", kind: "relevance", headline: "Possible relevance concern: 1 claim with no clear tie to the thesis; 2 paragraphs measured as drifting from the topic", detail: "The thesis-tie check relies mainly on shared wording, so a paraphrase can be missed. The drift measurement compares each paragraph with the topic and is not a verdict on relevance. Treat these as places to re-read, not as proof of irrelevance.", paragraphIds: ["p4", "p5"] },
  ],
  criteria: CSS_ESSAY_PROFILE.criteria.map((c) => ({
    id: c.id,
    title: c.title,
    origin: c.origin === "official_requirement" || c.origin === "official_guidance" ? c.origin : "inferred_best_practice",
    assessability: c.checkability,
    limitations: c.limitations ?? "",
    ...(c.sourceQuote ? { sourceQuote: c.sourceQuote } : {}),
    ...(c.sourceLocator ? { sourceLocator: c.sourceLocator } : {}),
    ...sampleRows[c.id],
  })),
  caveats: [
    `The FPSC syllabus for English Essay (compulsory, 100 marks) says: “${FPSC_QUOTES.knowledge}” and “${FPSC_QUOTES.style}”`,
    "7 of the 9 criteria below are inferred best practice, not FPSC rules. The syllabus does not mention a thesis, counterarguments, a conclusion or coherence, and it gives no criterion weights.",
    "This section looks only at structure. It cannot judge knowledge, accuracy, language, style, logic or coherence.",
    "A signal is a place to look, not an error, and no signal does not mean a part is strong. There are no marks here: the examiner makes the evaluation.",
  ],
};

export const mockExtras: ReportExtras = {
  cssProfile: cssSample,
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
