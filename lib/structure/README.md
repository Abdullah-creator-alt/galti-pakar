# Structure analysis module

Isolated stage that turns **parsed essay text** into a validated representation of its argumentative
structure: elements, candidate relationships, and potential structural gaps. It does not read handwriting,
score the essay, fact-check, or write student-facing feedback. Those belong to later stages.

```ts
import { analyzeEssayStructure } from "@/lib/structure";
const outcome = await analyzeEssayStructure({ text, topic });
if (outcome.ok) outcome.result;          // StructureAnalysis
else outcome.error;                       // { code, message, retryable, details? }
```

Nothing outside this folder depends on its internals. The module imports only two existing helpers
(`lib/gemini.ts` via `provider.ts`, and the pure `splitSentences` / `cosine` utilities). HTTP lives in
`app/api/structure/route.ts`, which is a thin wrapper.

## Pipeline

| Stage | File | What it does |
|---|---|---|
| A normalise | `normalize.ts` | Paragraphs (blank lines) and sentences with ids `p1..`, `s1..` and exact offsets. Never rewrites text. |
| B extract | `prompt.ts`, `extract.ts`, `provider.ts` | One LLM call labels sentence ids with a role. The model sees and returns ids only; every element is validated against the real sentences. Bad elements are rejected one by one; an unusable response is retried once, then fails. |
| C link | `link.ts`, `text.ts` | Rule-based candidate links with signed, inspectable signals. |
| D diagnose | `diagnose.ts` | Seven structural diagnostics from elements and links. |
| profile | `profile.ts` | Optional criterion ids attached to findings. Does not affect A to D. |
| validate | `validate.ts` | Referential integrity of the final object. |

## Contract

`schemaVersion`, `essayMetadata`, `paragraphs`, `sentences`, `argumentElements`, `argumentLinks`,
`structuralFindings`, `analysisMetadata`. Types in `types.ts`, runtime schema in `schema.ts`, bump
`STRUCTURE_SCHEMA_VERSION` in `config.ts` on any breaking change. Downstream stages need only this object.

- **Offsets** are UTF-16 code units into the exact input string; `start` inclusive, `end` exclusive;
  `text.slice(start, end)` equals the node's `text`. Spans exclude surrounding whitespace.
- **Ids** are positional and deterministic: `p1`, `s1`, `e1`, `l1`, `f1`.
- **`modelConfidence`** (element): the LLM's self-reported 0-1 certainty about the role. Uncalibrated; below 0.5
  means "guessing". Not a probability.
- **`strength`** (link): heuristic 0-1, the clamped sum of the link's `signals`. It measures how many independent
  structural signals agree, not logical validity. Direction is always source -> target
  (evidence supports claim, rebuttal rebuts counterclaim, counterclaim challenges target, claim is relevant to thesis).
- **`confidence`** (finding): 0-1 confidence the *observation* is accurate given the extracted elements. Formulas are in `diagnose.ts`.
- **All three are uncalibrated heuristics** and `analysisMetadata.confidenceCalibration` says so (`"uncalibrated_heuristic"`). They have not been validated against labelled data; do not present them as probabilities.
- Every link has `status: "candidate"`. Nothing here is a verified logical relationship.

## Schema 1.2.0 (additive)

`relevant_to` links may now also start at `evidence`, so relevance can travel along a support chain. No fields or enum values were removed.

## Schema 1.1.0 changes (additive)

- `supports` links may now target `rebuttal` and `counterclaim` (evidence for an answer or for an opposing view), besides claim, premise and thesis.
  A rebuttal's answer to a counterclaim remains an explicit `rebuts` link (rebuttal -> counterclaim).
- `analysisMetadata.confidenceCalibration` was added. No enum value or field was removed or renamed, so 1.0.0 consumers that ignore unknown fields keep working.

## Linking

Signals per candidate pair: proximity (same paragraph and gap, or paragraph distance), order, discourse cue,
lexical overlap of content stems, and, if enabled, embedding cosine similarity. Cues are read in context:
"for example" or "because" in the supporting sentence supports a link; "therefore" in the claim supports the preceding
premise; "however" in a rebuttal supports a rebuttal link but counts **against** a support link; temporal "since 1947" is ignored.
A link needs strength >= 0.35 and at least one structural signal (proximity or cue), so keyword overlap or semantic
similarity alone never creates one (claim -> thesis relevance links use a 0.3 bar because overlap is their main signal).
At most three links are kept per target. Semantic similarity is optional (`useSemanticSimilarity` plus an injected `embed`);
if it is unavailable or fails, rule-based linking runs and a warning is recorded.

## Diagnostics and limits

| Type | Fires when | Limitation |
|---|---|---|
| `potential_orphan_claim` | A `claim` has no candidate support link | Support may be implicit or in wording the rules cannot connect |
| `potentially_unsupported_reasoning` | Best support link is below 0.55 | Judges structure only, not whether the evidence is good |
| `unanswered_counterclaim` | A `counterclaim` has no candidate rebuttal | Only reported if the essay raises a counterclaim |
| `missing_thesis` | No thesis with model confidence >= 0.5 | Depends on the model's labelling |
| `missing_conclusion` | No conclusion with model confidence >= 0.5 | Same |
| `weak_thesis_connection` | A claim has no relevance signal to a confident thesis | Wording overlap misses paraphrase; low confidence by design |
| `uncertain_classification` | Role `other`, confidence < 0.5, or ambiguous alternative | Reflects the model's self-doubt |

Severity is a suggestion for review (`info` to `high`), lowered one level when the finding's confidence is below 0.5.

## CSS profile (optional)

`input.profile` may be a versioned profile (`profile.ts` schema): documents, criteria, and mappings from diagnostic type
to criterion ids. It is applied only when `provenance.status === "verified"`; every non-inferred criterion must cite a listed
document; origins (`official_requirement`, `rubric_excerpt`, `examiner_report_finding`, `inferred_best_practice`) and
checkability (`machine_checkable`, `requires_judgment`) are kept distinct. Only criteria about organisation, thesis clarity,
argument relevance, evidence support and counterarguments are attached; others are listed as skipped. An invalid or unverified
profile is ignored with a warning. **This repo ships no profile.** Official CSS rules, rubric text and FPSC findings must be
supplied and verified by the product owner; the tests use a clearly marked invented fixture. The HTTP route does not accept
a profile from clients.

## Integrating later stages

- Examiner second opinion / verification: read `argumentElements`, `argumentLinks`, `structuralFindings`; confirm or reject candidates.
- Report generation: map `structuralFindings` (with `sentenceIds` and offsets) to highlights and wording.
- Wire `app/api/analyze/route.ts` to call `analyzeEssayStructure` on the transcribed text when the pipeline is ready (the route is still a mock).
- Tests: `npm test` (mocked model, no network).
- Live check: `npm run eval:structure` (needs `GEMINI_API_KEY` in `.env.local`) runs two fixture essays through the real model and prints
  sentence-role differences, link differences and finding differences against the hand-labelled baseline (`fixtures.ts`, `compare.ts`).
  Two essays and one labeller make it a smoke test, not an accuracy measurement.

## Thesis relevance: what the check can and cannot say

`weak_thesis_connection` means **relevance unconfirmed**, never "off-topic". A claim is *not* reported when it has a direct `relevant_to`
link, or when a premise or evidence element that supports it has one (indirect chain). Otherwise it is reported with confidence capped at 0.35
(suggested severity `info`), and the description states whether an embedding comparison ran.

- Wording overlap is a weak signal: it misses paraphrases and is fooled by shared phrases ("Pakistan must ..." matches an unrelated sentence).
- Embeddings (opt-in, `useSemanticSimilarity`) add only weak *positive* evidence, with a floor of `SEMANTIC_FLOOR = 0.75`. A one-off probe of
  `gemini-embedding-001` (7 sentences, one thesis) gave: unrelated 0.73-0.74, paraphrases 0.78-0.83, a wording trap 0.84, an opposite stance 0.87.
  Raw cosine therefore cannot separate on-topic from off-topic, and low similarity is never used to assert irrelevance. Re-measure on real essays before relying on it.
- Likewise `potentially_unsupported_reasoning` is skipped when a weak premise link is backed by a solid premise <- evidence link.

## Extraction prompt

`prompt.ts` (`EXTRACTION_PROMPT_VERSION = "2"`) tells the model to label a sentence's argumentative *function*, not its quality:
vague, unsupported or false assertions still count as claims, and support is judged later by `link.ts` and `diagnose.ts`.
Filler, scene-setting and off-topic remarks stay unlabelled, and genuinely unclear sentences get `other` with low confidence.
`promptCases.ts` holds exploratory probes with *sets* of acceptable labels (and an `ambiguous` flag); they are not ground truth.
Taxonomy, response schema, ids and validation are unchanged.

## Known limitations

- Roles come from one LLM call; label quality on real handwritten essays is unmeasured.
- Support chains are followed one hop (claim <- premise <- evidence); a claim supported only by another claim is not recognised, and a claim backed only by an unsupported premise is not flagged.
- Off-topic sentences that share a phrase with the thesis, or that an embedding scores as close, receive a (weak) relevance link and are not reported.
- Unsupported rebuttals (a rebuttal with no evidence) are not diagnosed.
- A `rebuttal` with no matching counterclaim is not reported.
