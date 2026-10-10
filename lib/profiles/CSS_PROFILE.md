# CSS English Essay analysis profile (v1.0.0)

Source: `lib/profiles/cssEssay.ts`. Tests: `lib/profiles/cssEssay.test.ts`. Mechanism: `lib/structure/profile.ts`.

## What it is, and what it is not

A versioned registry of candidate criteria, plus explicit mappings from the structural diagnostics the engine
already produces to those criteria. When the structure analysis runs with the profile, each finding that has a
mapping gains a `criteria` list (id, name, provenance, assessability, an explanation, and limitations).

It does **not** create findings, change any threshold or prompt, assign marks, weights, a total score, a rank, a
grade or pass/fail, or judge facts, grammar, originality or overall quality. A missing finding does not show an
essay is strong, and a finding does not show it is weak. The examiner makes the evaluation.

## Official sources: verified

Checked on **2026-10-10**. The FPSC site sends an incomplete certificate chain (it omits the intermediate
certificate, so curl and openssl cannot verify it). Verification was **kept on**: the missing intermediate was
fetched from the certificate's own issuer URL and the chain was verified against the system root certificates.

| Item | Value |
|---|---|
| Document | *Revised Syllabi for CSS Competitive Examination, CE-2016* (`Syllabus-for-CE-2016-and-onwards.pdf`) |
| Issuer | Federal Public Service Commission (FPSC), Islamabad |
| URL | https://www.fpsc.gov.pk/uploads/syllabus/1767002683737_Syllabus-for-CE-2016-and-onwards.pdf |
| Listed at | https://www.fpsc.gov.pk/Syllabuses?section=CSS+Syllabi |
| Cover says | "Updated on: 7th July, 2015" |
| SHA-256 of the file read | `e44a4407ba9f1e4daf80a263e5b776843edf8f98b41a7eeda88cd189b794947a` |
| Where | PDF page 7 (printed page 5), "PAPER: ENGLISH ESSAY (100 MARKS)"; the marks also appear in the compulsory-subjects table |

Exact wording on that page (whitespace-normalised; matched byte-for-byte against the extracted PDF text):

1. "Candidates will be required to write one or more Essay in English. A wide choice of topics will be given."
2. "Candidates are expected to reflect comprehensive and research based knowledge on a selected topic."
3. "Candidate’s articulation, expression and technical treatment of the style of English Essay writing will be examined."

English Essay is listed as a compulsory subject worth 100 marks. **The document does not mention a thesis,
counterarguments, rebuttals, a conclusion, coherence, an outline, or any criterion weights.**

## Official sources: not verified or not found

- **Examiner reports for the Essay paper:** none found. Pages checked: the CSS syllabi page (one document), the
  FPSC home page, the Publications page (annual reports only), and the CSS rules page (no document links in its
  static HTML).
- **A marking scheme or criterion-level rubric for the Essay:** none found. None is assumed.
- **Whether a newer syllabus supersedes the 2015 text:** not verified. The file name says "CE-2016 and onwards",
  and it is the only CSS syllabus document on the FPSC syllabi page, but a person should confirm it is still in force.
- **Essay instructions printed on the question paper** (word count, outline, number of essays): not available, so
  none are used.
- The verification note in the profile reads "pending review by a person". Treat it that way.

## Criteria

| ID | Criterion | Provenance | Assessability | Diagnostics mapped |
|---|---|---|---|---|
| CSS-ESSAY-001 | Thesis clarity and central position | inferred best practice | partial | `missing_thesis` |
| CSS-ESSAY-002 | Argument development and logical progression | inferred best practice | needs judgment | none |
| CSS-ESSAY-003 | Relevance to the selected topic and thesis | inferred best practice | partial | `weak_thesis_connection` |
| CSS-ESSAY-004 | Evidence, examples and justification for claims | inferred best practice | partial | `potential_orphan_claim`, `potentially_unsupported_reasoning` |
| CSS-ESSAY-005 | Coherence between paragraphs and argument components | inferred best practice | needs judgment | none |
| CSS-ESSAY-006 | Counterarguments and rebuttals, where appropriate | inferred best practice | partial | `unanswered_counterclaim` |
| CSS-ESSAY-007 | Conclusion consistent with the thesis and arguments | inferred best practice | partial | `missing_conclusion` |
| CSS-ESSAY-008 | Substantive, research-based treatment of the selected topic | **official requirement** (quote 2) | partial | `potential_orphan_claim`, `potentially_unsupported_reasoning` |
| CSS-ESSAY-009 | Articulation, expression and technical treatment of essay style | **official requirement** (quote 3) | needs judgment | none (language is out of scope) |

- The seven analytical dimensions are **candidate structural-analysis dimensions**, not official FPSC categories.
  The official text does not establish any of them. "Inferred best practice" means exactly that.
- 008 and 009 quote the syllabus. 008 is mapped to the evidence signals only as a prompt for the examiner to look
  closer; the official wording is about the candidate's knowledge, which this tool cannot assess.
- "Partial" is used because every diagnostic depends on roles assigned by the language model. Nothing here is
  `machine_checkable`, meaning decided by a deterministic rule on its own.
- One finding can relate to several criteria (an unsupported-claim signal relates to 004 and 008). Findings with no
  mapping, such as `uncertain_classification`, get no criteria, because they describe the analysis, not the essay.

## What the profile can and cannot show

Can: that a claim has no identified supporting passage, that a thesis or conclusion was not confidently
labelled, that an opposing view was raised with no identified response, and that no wording, nearness or
support-chain signal tied a claim to the thesis.

Cannot: whether a claim is true, whether the candidate's knowledge or research is sound, whether language or style
is good, whether the argument's logic holds, whether paragraphs cohere, whether a counterargument was needed, or
whether the essay is good. Low wording overlap is not proof of irrelevance, and high overlap is not proof of
relevance.

## How it is applied

`measureEssay` (`lib/pipeline/measure.ts`) passes the profile to the structure analysis, and `/api/structure` does
the same on the server (the profile is never accepted from a request). Disable it per call with `profile: null`.
With no profile, or an invalid or unverified one, the generic analysis runs unchanged and a warning is recorded.
The labels are on the structure analysis result; the examiner's input and the report are unchanged (tested).

## Changing it

Edit `cssEssay.ts`, bump `CSS_ESSAY_PROFILE_VERSION`, set `introducedIn` on new criteria, keep ids stable, and
never re-use an id. The schema rejects an official criterion without a document URL, a page and a quotation, and
rejects an inferred criterion that carries an official quotation. Do not add marks or weights. Do not classify a
criterion as official because it appears in coaching material.
