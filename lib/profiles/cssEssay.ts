/**
 * CSS English Essay analysis profile, version 1.0.0.
 *
 * What it is: a versioned registry of candidate analytical criteria, plus explicit mappings from the existing
 * structural diagnostics (lib/structure) to those criteria. It only labels findings the generic engine already
 * produced. It creates no findings, changes no thresholds, and assigns no marks, weights, scores or pass/fail.
 *
 * What it is not: an FPSC marking scheme. FPSC publishes no criterion-level rubric that this project could verify.
 * Only the two criteria marked official_requirement are backed by the official syllabus text quoted below.
 * Everything else is an inferred best practice and says so. Read CSS_PROFILE.md before changing anything here.
 *
 * Provenance was checked on 2026-10-10 by downloading the official PDF over a verified TLS chain, reading the
 * English Essay paper text, and recording its SHA-256. A human should re-check it against the current FPSC
 * syllabus before relying on it.
 */
import { analysisProfileSchema, type AnalysisProfile } from "../structure/index.ts";

export const CSS_ESSAY_PROFILE_ID = "css-english-essay";
export const CSS_ESSAY_PROFILE_VERSION = "1.0.0";
export const FPSC_SYLLABUS_DOC_ID = "fpsc-css-syllabus-ce2016";

const SYLLABUS_LOCATOR = "PDF page 7 (printed page 5), section 'PAPER: ENGLISH ESSAY (100 MARKS)'";

/** Exact wording from the official syllabus. Whitespace-normalised; the apostrophe is the PDF's typographic one. */
export const FPSC_QUOTES = {
  scope: "Candidates will be required to write one or more Essay in English. A wide choice of topics will be given.",
  knowledge: "Candidates are expected to reflect comprehensive and research based knowledge on a selected topic.",
  style: "Candidate’s articulation, expression and technical treatment of the style of English Essay writing will be examined.",
} as const;

const RAW_PROFILE = {
  profileId: CSS_ESSAY_PROFILE_ID,
  version: CSS_ESSAY_PROFILE_VERSION,
  provenance: {
    status: "verified",
    verifiedBy: "Automated retrieval and reading of the official PDF on 2026-10-10; pending review by a person",
    documents: [
      {
        id: FPSC_SYLLABUS_DOC_ID,
        title: "Revised Syllabi for CSS Competitive Examination, CE-2016 (Syllabus-for-CE-2016-and-onwards.pdf)",
        issuer: "Federal Public Service Commission (FPSC), Islamabad",
        version: "Cover states: Updated on 7th July, 2015. File name: CE-2016 and onwards.",
        url: "https://www.fpsc.gov.pk/uploads/syllabus/1767002683737_Syllabus-for-CE-2016-and-onwards.pdf",
        listedAt: "https://www.fpsc.gov.pk/Syllabuses?section=CSS+Syllabi",
        retrievedOn: "2026-10-10",
        sha256: "e44a4407ba9f1e4daf80a263e5b776843edf8f98b41a7eeda88cd189b794947a",
        notes:
          "States that English Essay is a compulsory subject worth 100 marks. Scope wording: '" +
          FPSC_QUOTES.scope +
          "' The document does not mention a thesis, counterarguments, a conclusion, coherence, or any criterion weights.",
      },
    ],
  },
  criteria: [
    {
      id: "CSS-ESSAY-001",
      title: "Thesis clarity and central position",
      description: "The essay states a recognisable central position on the selected topic that the rest of the essay can be read against.",
      area: "thesis_clarity",
      origin: "inferred_best_practice",
      checkability: "partially_assessable",
      introducedIn: "1.0.0",
      limitations:
        "The syllabus text checked does not mention a thesis. The only signal is whether the extraction step labelled a confident thesis. A thesis can be implicit, so a missing label is not proof of an unclear position.",
    },
    {
      id: "CSS-ESSAY-002",
      title: "Argument development and logical progression",
      description: "The argument moves from claim to support to consequence in an order a reader can follow.",
      area: "organization",
      origin: "inferred_best_practice",
      checkability: "requires_judgment",
      introducedIn: "1.0.0",
      limitations:
        "No current diagnostic assesses progression or the soundness of a line of reasoning, so no finding is mapped to this criterion. It is listed so the examiner knows it is not covered.",
    },
    {
      id: "CSS-ESSAY-003",
      title: "Relevance to the selected topic and thesis",
      description: "Claims and supporting material bear on the topic the candidate chose and on the thesis.",
      area: "argument_relevance",
      origin: "inferred_best_practice",
      checkability: "partially_assessable",
      introducedIn: "1.0.0",
      limitations:
        "Rests on wording overlap, optional embedding similarity and support-chain links, all weak signals. Low overlap is not proof of irrelevance, because a paraphrase shares few words, and a shared phrase is not proof of relevance. The syllabus refers to knowledge 'on a selected topic' but states no relevance rule.",
    },
    {
      id: "CSS-ESSAY-004",
      title: "Evidence, examples and justification for claims",
      description: "Substantive claims are backed by examples, evidence or reasoning the reader can find in the essay.",
      area: "evidence_support",
      origin: "inferred_best_practice",
      checkability: "partially_assessable",
      introducedIn: "1.0.0",
      limitations:
        "Detects only whether a candidate supporting passage was found by nearness, discourse cues and wording. Support may be implicit or elsewhere. It does not judge whether evidence is accurate, sufficient or well chosen, and a claim without identified support is not thereby false.",
    },
    {
      id: "CSS-ESSAY-005",
      title: "Coherence between paragraphs and argument components",
      description: "Paragraphs and argument components connect so the essay reads as one piece.",
      area: "organization",
      origin: "inferred_best_practice",
      checkability: "requires_judgment",
      introducedIn: "1.0.0",
      limitations: "The engine links elements, not paragraph-to-paragraph flow, and has no coherence diagnostic. Nothing is mapped to this criterion.",
    },
    {
      id: "CSS-ESSAY-006",
      title: "Counterarguments and rebuttals, where appropriate",
      description: "Where the topic and the candidate's approach call for it, opposing views are acknowledged and answered.",
      area: "counterargument",
      origin: "inferred_best_practice",
      checkability: "partially_assessable",
      introducedIn: "1.0.0",
      limitations:
        "Reported only when the essay itself raises an opposing view that no candidate response follows. The absence of any counterargument is not reported and is not a defect: whether one is appropriate depends on the topic and approach, and no verified rule requires one.",
    },
    {
      id: "CSS-ESSAY-007",
      title: "Conclusion consistent with the thesis and arguments",
      description: "The ending follows from the position and arguments the essay developed.",
      area: "organization",
      origin: "inferred_best_practice",
      checkability: "partially_assessable",
      introducedIn: "1.0.0",
      limitations: "Only the presence of a confidently labelled concluding passage is checked. Whether it matches the thesis and the arguments is not assessed.",
    },
    {
      id: "CSS-ESSAY-008",
      title: "Substantive, research-based treatment of the selected topic",
      description: "The essay reflects comprehensive and research based knowledge on the topic the candidate selected, as the official syllabus expects.",
      area: "evidence_support",
      origin: "official_requirement",
      checkability: "partially_assessable",
      introducedIn: "1.0.0",
      sourceDocumentId: FPSC_SYLLABUS_DOC_ID,
      sourceLocator: SYLLABUS_LOCATOR,
      sourceQuote: FPSC_QUOTES.knowledge,
      limitations:
        "The official wording concerns the candidate's knowledge. This tool cannot assess knowledge, accuracy or depth of research. A structural signal that a claim has no identified support is at most a prompt for the examiner to look closer; it is not evidence of weak knowledge.",
    },
    {
      id: "CSS-ESSAY-009",
      title: "Articulation, expression and technical treatment of essay style",
      description:
        "The official syllabus says the candidate's articulation, expression and technical treatment of the style of English Essay writing will be examined.",
      area: "language",
      origin: "official_requirement",
      checkability: "requires_judgment",
      introducedIn: "1.0.0",
      sourceDocumentId: FPSC_SYLLABUS_DOC_ID,
      sourceLocator: SYLLABUS_LOCATOR,
      sourceQuote: FPSC_QUOTES.style,
      limitations:
        "Language and style are not assessed by this profile or by the structural analysis. The criterion is recorded so the profile does not suggest the official criteria are covered.",
    },
  ],
  mappings: [
    {
      diagnostic: "missing_thesis",
      criterionIds: ["CSS-ESSAY-001"],
      explanation: "No confidently labelled central position was found. The position may be implicit, so the examiner should read the essay to decide.",
    },
    {
      diagnostic: "potential_orphan_claim",
      criterionIds: ["CSS-ESSAY-004", "CSS-ESSAY-008"],
      explanation:
        "No supporting passage was identified for this claim. Support may be implicit or elsewhere. This is a structural signal only, not a judgement of the claim's truth or of the candidate's knowledge.",
    },
    {
      diagnostic: "potentially_unsupported_reasoning",
      criterionIds: ["CSS-ESSAY-004", "CSS-ESSAY-008"],
      explanation: "A candidate supporting passage exists but rests on weak structural signals, so the support is uncertain. It does not show the reasoning is weak.",
    },
    {
      diagnostic: "unanswered_counterclaim",
      criterionIds: ["CSS-ESSAY-006"],
      explanation: "The essay raises an opposing view and no candidate response was identified. Whether a response is needed is for the examiner to decide.",
    },
    {
      diagnostic: "missing_conclusion",
      criterionIds: ["CSS-ESSAY-007"],
      explanation: "No confidently labelled concluding passage was found. The ending may be present but unlabelled, so the examiner should check.",
    },
    {
      diagnostic: "weak_thesis_connection",
      criterionIds: ["CSS-ESSAY-003"],
      explanation: "No wording, nearness or support-chain signal tied this claim to the thesis. This is a possible relevance concern only; a paraphrase or implicit link may be missed.",
    },
  ],
};

/** Validated at load time: a malformed edit fails here, not silently in production. */
export const CSS_ESSAY_PROFILE: AnalysisProfile = analysisProfileSchema.parse(RAW_PROFILE);
