# PERSUADE span classifier: architecture proposal (Phase 0)

Status: proposal. Findings below were measured on this machine and in the real corpus on 2026-10-10.

## What was inspected

| Item | Finding |
|---|---|
| App | Next.js 15 App Router, TypeScript strict, zod, `node --test`. No `vercel.json`. Only secret: `GEMINI_API_KEY`, read in `lib/gemini.ts`. |
| Baseline | `npm test` 142/142, `tsc` clean, `next build` OK (before any change in this task). |
| Hardware here | **No GPU**, no `nvidia-smi`; 8 CPU cores, 13 GB RAM, 16 GB free disk; Python 3.12; no torch/transformers/onnxruntime installed. |
| Corpus location | The GitHub repo holds only a README and rubric PDFs. The CSVs are on Google Drive (train: free download; test: password-protected zip, password in the README). |
| Corpus format | One row per annotated span. Columns used: `essay_id_comp`, `full_text`, `discourse_start`, `discourse_end`, `discourse_text`, `discourse_type`, `prompt_name`, `task`, `competition_set`. |
| Span labels | Lead, Position, Claim, Counterclaim, Rebuttal, Evidence, Concluding Statement, plus Unannotated gaps. |
| Sensitive columns | The CSV also carries `race_ethnicity`, `economically_disadvantaged`, `student_disability_status`, `gender`, `grade_level`, `ell_status`. They are dropped at read time and never written anywhere. |
| License | CC BY-NC-SA 4.0 (non-commercial, share-alike). See "License" below. |

### Data quirks that shape preprocessing

- `essay_id` is stored in scientific notation (`5.40889E+12`) and is lossy. Use `essay_id_comp` (12-char id).
- `discourse_start/end` do not slice `full_text`: 0 of 5,000 sampled spans matched, the error grows along the essay, and `end` behaves as the last character, not an exclusive end. Spans are therefore **recovered by ordered verbatim search** of `discourse_text` in `full_text` (found for 99.93% of 19,893 sampled spans). The given offsets are kept only as an audit field.
- Unannotated rows fill the gaps between labelled spans, so they are used to keep the search cursor honest and then treated as "O".

## Proposed architecture

1. **Isolated Python workspace** (`training/persuade/`), standard library only for preprocessing. Nothing Python is imported by or shipped with the Next.js runtime.
2. **Task**: token classification with BIO tags over character spans (O plus B-/I- for 7 classes), pretrained encoder, long essays handled by overlapping windows, spans rebuilt from the tokenizer's character offsets on the **original** text.
3. **Labels stay PERSUADE-native in the model.** Mapping to Galti roles happens in a separate adapter, so the classifier is never trained to claim definitions it does not share (see mapping below).
4. **Comparison**: an offline command scores the classifier and cached Gemini predictions against the same held-out essays at sentence level. Gemini runs are opt-in and cached, never in ordinary tests.
5. **Hybrid**: a typed TypeScript adapter maps predicted character spans to existing sentence ids; a documented fusion function combines it with Gemini output; disagreement is preserved. Feature-flagged off by default, Gemini-only fallback always available. Relationships and diagnostics stay in existing TypeScript code.

## Label mapping (PERSUADE -> Galti Pakar)

| PERSUADE | Galti role | Fit | Note |
|---|---|---|---|
| Position | thesis | good | "opinion or conclusion on the main question" |
| Claim | claim | good | |
| Counterclaim | counterclaim | good | |
| Rebuttal | rebuttal | good | |
| Concluding Statement | conclusion | good | |
| Evidence | evidence | **partial** | PERSUADE evidence is "ideas or examples that support claims"; much of it is general reasoning. Galti separates concrete `evidence` from `premise`. The classifier cannot produce `premise`; comparisons merge Gemini's evidence+premise. |
| Lead | none | no equivalent | attention-getting opener; maps to unlabelled |
| Unannotated | none (O) | | |

Not used as labels: holistic essay scores, effectiveness ratings, hierarchical labels, any demographic field.

## Deployment (to be verified in Phase 5, not assumed)

- Vercel serverless limits (function size, memory, 60 s `maxDuration`) make in-process transformer inference doubtful; ONNX Runtime for Node plus a quantised model must be measured against them before it is considered.
- Candidates: (a) ONNX in Node, only if measured size/latency fit; (b) a separate authenticated inference service; (c) offline evaluation only.
- **License gate**: CC BY-NC-SA 4.0 data. No weights are distributed or deployed, and no endpoint is added, until a human reviews the intended use. This document makes no legal claim about whether weights are derivative works.

## Blocker found in Phase 0 (measured)

Training cannot run on the machine used for Phases 0-1:
- No CUDA GPU. The only GPU is an integrated AMD Radeon Vega 8. The `pytorch_ocl` OpenCL backend in `~/dl-env` failed to compile its kernels (`nir_shader not fully linked`) on a BERT-sized training step.
- CPU training of a MiniLM-sized token classifier measured about 26 s per step of 8 x 512 tokens, which extrapolates to roughly 16 hours per epoch over the training set: impractical.

Decision (project owner): stop here, finish data preparation, and train on a separate GPU machine using `HANDOFF.md`.
