import { bandForScore, countWords } from "./derive.ts";
import type {
  DimensionScore,
  EssayReport,
  ExaminerResult,
  HighlightSpan,
  Paragraph,
  ParagraphRole,
  RubricKey,
  Tone,
} from "./types.ts";

type Quote = [quote: string, tone: Tone, reason: string];

/** Resolve quoted phrases to character offsets, so the mock text can be edited safely. */
function para(
  id: string,
  role: ParagraphRole,
  relevance: number,
  summary: string,
  text: string,
  quotes: Quote[],
): Paragraph {
  const spans: HighlightSpan[] = quotes.map(([q, tone, reason]) => {
    const start = text.indexOf(q);
    if (start < 0) throw new Error(`Mock highlight not found in ${id}: ${q}`);
    return { start, end: start + q.length, tone, reason };
  });
  return { id, role, relevance, summary, text, spans: spans.sort((a, b) => a.start - b.start) };
}

const paragraphs: Paragraph[] = [
  para(
    "p1",
    "position",
    92,
    "Pakistan is climate-vulnerable; climate is the central economic question.",
    "Few nations contribute so little to global warming and suffer so much from it as Pakistan. Responsible for less than one percent of global emissions, the country nevertheless ranks among the most climate-vulnerable in the world, and the floods of 2022 showed what that vulnerability costs. This essay argues that climate change is no longer an environmental side issue for Pakistan but the central economic question of the coming decades, and that the country's future growth depends on how seriously it adapts.",
    [
      ["the floods of 2022 showed what that vulnerability costs", "weak", "Names the event but gives no figure. Paragraph 3 supplies the numbers, so a forward reference would help."],
      ["This essay argues that climate change is no longer an environmental side issue for Pakistan but the central economic question of the coming decades", "strong", "A clear, arguable position stated in one sentence. This is what the rest of the essay can be tested against."],
    ],
  ),
  para(
    "p2",
    "claim",
    88,
    "Agriculture is the first channel through which warming reaches the economy.",
    "Agriculture is the first channel through which a warming climate reaches the economy. The sector employs roughly four in ten Pakistanis and feeds the textile industry, which dominates exports. Wheat, rice and cotton all depend on predictable monsoon rains and on glacier-fed rivers, and both are becoming less reliable. Heat stress during the wheat-sowing window has already reduced yields in parts of Punjab, and farmers who cannot afford new seed varieties or drip irrigation bear the loss alone. When the harvest fails, the shock travels outward to mills, traders and urban food prices.",
    [
      ["The sector employs roughly four in ten Pakistanis and feeds the textile industry, which dominates exports", "strong", "Links the claim to the economy with a specific, checkable fact."],
      ["the shock travels outward to mills, traders and urban food prices", "weak", "Asserted without an example or figure. One named price shock would make this convincing."],
    ],
  ),
  para(
    "p3",
    "evidence",
    85,
    "The 2022 floods as evidence of scale and economic cost.",
    "The 2022 floods give the clearest evidence of the scale involved. Roughly a third of the country was submerged, more than thirty million people were affected, and the World Bank estimated damages and losses at over thirty billion dollars. Growth slowed sharply the following year, inflation climbed, and the government returned to the International Monetary Fund for support. A single season of rain had undone years of fragile recovery.",
    [
      ["the World Bank estimated damages and losses at over thirty billion dollars", "strong", "A named source and a figure. This is the strongest evidence in the essay."],
      ["A single season of rain had undone years of fragile recovery", "strong", "Ties the evidence back to the position about long-term growth."],
    ],
  ),
  para(
    "p4",
    "claim",
    38,
    "Education has been neglected for decades. Not tied to climate.",
    "Education is another area where the country has struggled for decades. Millions of children remain out of school, and public spending on education is among the lowest in South Asia. A better educated population would, in general, make better decisions about every national problem. Teachers are underpaid, curricula are outdated, and examinations reward memorisation rather than thinking.",
    [
      ["A better educated population would, in general, make better decisions about every national problem", "offtopic", "Unsupported and not linked to climate or the economy. The essay never explains how education would change climate outcomes."],
      ["Teachers are underpaid, curricula are outdated, and examinations reward memorisation rather than thinking", "offtopic", "A separate problem. It does not advance the argument about climate change."],
    ],
  ),
  para(
    "p5",
    "claim",
    31,
    "General remarks on national will and unity. Filler.",
    "Throughout history, great nations have risen through hard work and unity. Every society faces challenges, and Pakistan is no different. It is often said that where there is a will there is a way. If leaders and citizens put their differences aside, nothing can stand in the way of progress.",
    [
      ["Throughout history, great nations have risen through hard work and unity", "offtopic", "A generic opening that could begin any essay. It says nothing about climate or the economy."],
      ["Every society faces challenges, and Pakistan is no different", "weak", "Generic. Replace with a statement specific to climate adaptation."],
      ["It is often said that where there is a will there is a way", "offtopic", "A proverb used as filler. It adds length but no argument."],
    ],
  ),
  para(
    "p6",
    "evidence",
    74,
    "Energy imports and the case for solar, wind and hydropower.",
    "Energy offers a second, more hopeful, line of argument. Pakistan spends billions each year importing oil and liquefied gas, a bill that strains the balance of payments whenever global prices rise. Solar panels imported from China have spread rapidly across homes and farms since 2022, which shows that households will move quickly when the economics are clear. A planned shift toward solar, wind and hydropower would cut the import bill while reducing emissions, so adaptation and growth need not pull in opposite directions.",
    [
      ["Pakistan spends billions each year importing oil and liquefied gas", "weak", "Vague. A specific yearly figure would turn this into evidence."],
      ["Solar panels imported from China have spread rapidly across homes and farms since 2022, which shows that households will move quickly when the economics are clear", "strong", "A concrete trend with a conclusion drawn from it. This is evidence used well."],
    ],
  ),
  para(
    "p7",
    "claim",
    69,
    "Policy should move from relief to resilience; funding and provincial capacity.",
    "Policy must therefore move from relief to resilience. Climate finance, including the loss and damage fund agreed at COP27, can help, but it will not arrive in the scale or at the speed required. The country needs flood-resistant infrastructure, early warning systems, water storage and crop insurance, financed partly through domestic reform of a narrow tax base. Provinces, which control water and agriculture, must be given both the funds and the technical capacity to act.",
    [
      ["the loss and damage fund agreed at COP27", "strong", "Names a specific international mechanism, which shows awareness of the policy setting."],
      ["financed partly through domestic reform of a narrow tax base", "weak", "Raised in passing. Say what reform and roughly how much it would raise."],
    ],
  ),
  para(
    "p8",
    "conclusion",
    81,
    "Cost of inaction is already being paid; invest in resilience now.",
    "In conclusion, climate change is a test of Pakistan's economic planning as much as of its environmental policy. The evidence from agriculture, floods and energy points the same way: the cost of inaction is already being paid, and it grows with every delay. A country that invests in resilience now will protect its farmers, steady its public finances and keep its growth path open. Pakistan cannot control the global climate, but it can decide how prepared it is to face it.",
    [
      ["the cost of inaction is already being paid, and it grows with every delay", "strong", "Pulls the three lines of evidence into a single claim that matches the opening position."],
    ],
  ),
];

const DIM_DEFS: { key: RubricKey; label: string; score: number; note: string }[] = [
  { key: "thesis", label: "Thesis", score: 7.5, note: "Clear and arguable position in the first paragraph." },
  { key: "outline", label: "Outline", score: 6.0, note: "Logical order, but two paragraphs sit outside the argument." },
  { key: "argument", label: "Argument", score: 6.5, note: "Claims are linked to the position, except in P4 and P5." },
  { key: "evidence", label: "Evidence", score: 7.0, note: "Good use of figures in P3. P2 and P6 need more." },
  { key: "counter-argument", label: "Counter-argument", score: 3.5, note: "No opposing view is considered." },
  { key: "coherence", label: "Coherence", score: 5.5, note: "Transitions are weak around P4 and P5." },
  { key: "language", label: "Language", score: 6.5, note: "Clear and controlled, with some generic phrasing." },
];

const dimensions: DimensionScore[] = DIM_DEFS.map((d) => ({
  key: d.key,
  label: d.label,
  score: d.score,
  outOf: 10,
  band: bandForScore(d.score, 10),
  note: d.note,
}));

const base: Record<RubricKey, ReturnType<typeof bandForScore>> = Object.fromEntries(
  dimensions.map((d) => [d.key, d.band]),
) as Record<RubricKey, ReturnType<typeof bandForScore>>;

const examiners: ExaminerResult[] = [
  { id: "a", label: "Examiner A", overall: 5.9, band: "borderline", dimensions: { ...base, evidence: "borderline" } },
  { id: "b", label: "Examiner B", overall: 6.1, band: "borderline", dimensions: { ...base, evidence: "borderline" } },
  { id: "c", label: "Examiner C", overall: 7.0, band: "competitive", dimensions: { ...base, evidence: "competitive", "counter-argument": "borderline" } },
];

const p5 = paragraphs[4].text;

export const mockReport: EssayReport = {
  id: "example",
  topic: "Climate change and Pakistan's economic future",
  analysedAt: "2026-10-08T09:30:00.000Z",
  wordCount: paragraphs.reduce((n, p) => n + countWords(p.text), 0),
  pageCount: 3,
  overallScore: 6.1,
  overallOutOf: 10,
  verdict: bandForScore(6.1, 10),
  dimensions,
  paragraphs,
  driftThreshold: 50,
  fixes: [
    { rank: 1, title: "Add one counter-argument", body: "No paragraph considers an opposing view, such as the claim that development should come before adaptation. Answering it would strengthen your position.", paragraphId: "p7" },
    { rank: 2, title: "Cut or rewrite the drifting paragraphs", body: "Paragraphs 4 and 5 fall below the relevance threshold. Remove them or tie each sentence back to climate and the economy.", paragraphId: "p4" },
    { rank: 3, title: "Replace vague claims with a figure", body: "Several weak highlights are claims without numbers or names. One specific fact per paragraph is enough.", paragraphId: "p6" },
  ],
  rewrite: {
    paragraphId: "p5",
    original: p5,
    removed: [
      "Throughout history, great nations have risen through hard work and unity.",
      "Every society faces challenges, and Pakistan is no different.",
      "It is often said that where there is a will there is a way.",
      "If leaders and citizens put their differences aside, nothing can stand in the way of progress.",
    ],
    improved:
      "Resolve alone will not protect Pakistan from the next monsoon; budgets and institutions will. Federal and provincial spending on flood protection and water storage remains small beside the damage a single season can cause, and that gap is what the reforms below are meant to close.",
    added: [
      "Resolve alone will not protect Pakistan from the next monsoon; budgets and institutions will.",
      "Federal and provincial spending on flood protection and water storage remains small beside the damage a single season can cause",
    ],
  },
  examiners,
  isExample: true,
};

export const mockHistory = [
  { id: "example", topic: mockReport.topic, analysedAt: mockReport.analysedAt, overallScore: 6.1, overallOutOf: 10, verdict: bandForScore(6.1, 10), isExample: true },
  { id: "ex-2", topic: "Terrorism and the national narrative", analysedAt: "2026-10-02T17:10:00.000Z", overallScore: 7.2, overallOutOf: 10, verdict: bandForScore(7.2, 10), isExample: true },
  { id: "ex-3", topic: "Water scarcity and food security", analysedAt: "2026-09-26T08:45:00.000Z", overallScore: 4.6, overallOutOf: 10, verdict: bandForScore(4.6, 10), isExample: true },
  { id: "ex-4", topic: "Youth unemployment in Pakistan", analysedAt: "2026-09-14T12:00:00.000Z", overallScore: 5.4, overallOutOf: 10, verdict: bandForScore(5.4, 10), isExample: true },
];
