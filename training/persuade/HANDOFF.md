# PERSUADE span classifier: handoff for the GPU machine

**Scope: this file covers only the PERSUADE span-classifier feature.** It deliberately does not describe the rest of the application. Where the feature touches existing code, it names the touchpoint (section 3) and points to the source file, which is authoritative: **if anything here disagrees with the code, the code is right.** The original task brief is reproduced in Appendix A and is the source of truth for requirements.

Read this whole file first. It states the goal, the rules, what is done, what was measured, what was decided, and exactly what to do next.

Last updated: 2026-10-10. Branch: `feature/persuade-classifier`. **Nothing from this task has been committed or pushed yet** (see section 3).

---

## 1. Summary

The feature: train a **span-aware transformer classifier on PERSUADE 2.0** (US school essays, CC BY-NC-SA 4.0), **compare it offline against the existing Gemini role extraction**, and, only if the results justify it, add a **feature-flagged hybrid** path that complements (never replaces) the existing extraction. Phase 0 (inspection) and Phase 1 (data preparation, with tests) are **done**. Training (Phase 2) could **not** run on the original machine (no CUDA GPU; the iGPU's OpenCL backend failed), so the work was stopped there and handed off. Everything from Phase 2 on is **not started**.

## 2. Status by phase

| Phase | Status | Notes |
|---|---|---|
| 0 Inspect | **Done** | Findings in sections 3 and 4. Architecture proposal: `ARCHITECTURE.md`. |
| 1 Data prep + label mapping + tests | **Done** | 25 Python tests pass. Real run: section 5. Test set **not** downloaded (kept untouched on purpose). |
| 2 Train span classifier | **Not started (blocked on GPU)** | Specification in section 8. |
| 3 Compare with Gemini | **Not started** | Specification in section 9. |
| 4 Hybrid integration (TypeScript) | **Not started** | Specification in section 10. Must wait for a loadable trained model. |
| 5 Deployment design | **Not started** | Only a hypothesis exists (section 11). Must be measured. |
| 6 CSS-specific direction | **Not started** | Rules in section 12. |

Deliverable checklist to report at the very end is in section 14.

## 3. Repository state and touchpoints with existing code

### Where this work lives

- Repo: `git@github.com:Abdullah-creator-alt/galti-pakar.git`. This work is on branch **`feature/persuade-classifier`**, created from `main`.
- On the original PC it consisted only of **uncommitted** files: `.gitignore` additions and the whole `training/persuade/` folder. **If `training/persuade/` is missing where you are, it was not pushed;** ask the owner to commit and push that branch.
- Files added by this feature so far (all under `training/persuade/` plus `.gitignore`): `ARCHITECTURE.md`, `HANDOFF.md`, `README.md`, `requirements-train.txt`, `persuade_prep/{__init__,labels,align,prepare}.py`, `tests/{__init__,test_prep}.py`.
- Python tests: `cd training/persuade && python3 -I -m unittest discover -s . -t .` (standard library only; expect `Ran 25 tests ... OK`).
- Existing test suite, TypeScript check and build were passing when this work started. Re-run `npm test`, `npx tsc --noEmit` and `npx next build` yourself before and after any TypeScript change and compare; do not rely on any count written here.
- Do not discard or overwrite existing work, do not refactor unrelated code, and do not change the extraction prompt, relevance thresholds, or existing diagnostics to improve the new model's numbers.

### Touchpoints (Phase 3 and 4 only; read the source, it is authoritative)

The classifier is meant to complement the existing structure-analysis module. These are the only parts of it the feature depends on:

| What you need | Where to read it |
|---|---|
| Role vocabulary the classifier output must map into | `lib/structure/types.ts` (`ARGUMENT_ROLES`) |
| Sentence segmentation and stable sentence ids (`s1..`), UTF-16 offsets | `lib/structure/normalize.ts` |
| Where roles currently come from (the Gemini step) and its injected-function style | `lib/structure/extract.ts`, `lib/structure/prompt.ts`, `lib/structure/provider.ts` |
| Entry point where a fusion step would be added, and its injected dependencies | `lib/structure/analyze.ts` (`analyzeEssayStructure`, `StructureDeps`) |
| Output contract that fused results must still satisfy | `lib/structure/schema.ts`, `lib/structure/validate.ts`, `STRUCTURE_SCHEMA_VERSION` in `lib/structure/config.ts` |
| Existing comparison/eval helpers worth reusing | `lib/structure/compare.ts`, `lib/structure/fixtures.ts`, `scripts/eval-structure.ts` |
| Module documentation | `lib/structure/README.md` |

Facts about those touchpoints that matter to this feature (verify in the files): offsets are UTF-16 code units into the exact input string (start inclusive, end exclusive); element `modelConfidence` is the LLM's self-reported value and is uncalibrated; relationships are produced only by the existing rule-based linking and must stay that way; the output declares `confidenceCalibration: "uncalibrated_heuristic"`.

For live Gemini calls (Phase 3) the key goes in `.env.local` as `GEMINI_API_KEY` (gitignored; never print or commit it). Free-tier quota is very small (about 20 generate requests/day per model was observed), and the configured model was exhausted at the time; plan for a small cached evaluation subset or a paid key (section 9).

## 4. Environment facts (original PC) and what they implied

| Item | Finding |
|---|---|
| GPU | None usable. AMD Radeon Vega 8 iGPU only. `~/dl-env` has `pytorch_ocl 0.2.0+torch2.4` (OpenCL backend); a BERT-sized training step on `ocl:0` **failed** (`Failed to build program source pointwise ... nir_shader not fully linked`, rusticl driver). No CUDA (`torch 2.4.0+cu121`, `cuda.is_available() == False`). |
| CPU training | 8 cores, 13 GB RAM. One training step of a MiniLM-sized token classifier (12 layers, hidden 384, batch 8 x 512 tokens) took about **26 s** (measured while a download was running; an uncontended re-measure was not completed). At ~6 ms/token, one epoch over the ~14k training essays (~9M tokens) would take on the order of 16 hours, so CPU training was judged impractical. |
| Disk | ~16 GB free; dataset CSV is 617 MB. |
| Python | 3.12.3. |
| Side effects on `~/dl-env` (owner's venv) | Installed `transformers==4.46.3` and `tokenizers==0.20.3` (torch 2.4 cannot run transformers >= 5). This **downgraded `huggingface_hub` from 2.1.1 to 0.36.2**. A first install attempt also added `typer`, `rich`, `shellingham`, `markdown-it-py`, `mdurl`, `annotated-doc` (transformers 5.19, since replaced). Tell the owner; this is reversible with `pip`. Do not rely on `~/dl-env` for training. |

On the GPU PC create a fresh environment (section 7). Any CUDA GPU with >= 16 GB is comfortable for a base-size encoder; 8-12 GB works with smaller batches / gradient accumulation / a smaller model.

## 5. The dataset (verified facts)

- Official repo: `https://github.com/scrosseye/persuade_corpus_2.0`. It holds only a README and rubric PDFs; **the CSVs are on Google Drive**.
- **License: CC BY-NC-SA 4.0** (non-commercial, share-alike). See section 13.
- Train CSV (617 MB, 15,594 essays with annotations): Drive id `13phHyDzIsb0MHyJr6q-B-qIa9P2tM135`. Reliable download (the plain `uc?export=download` link returns an empty 200; use the usercontent host with `confirm=t`; resuming with `-C -` stalls, so download in one go):
  ```
  mkdir -p ~/galti-pakar-data/persuade && cd ~/galti-pakar-data/persuade
  curl -L -o persuade_2.0_train.csv "https://drive.usercontent.google.com/download?id=13phHyDzIsb0MHyJr6q-B-qIa9P2tM135&export=download&confirm=t"
  ```
  Expect exactly 616,894,963 bytes. Keep it **outside the repo**.
- Test set: Drive id `1K1SIJiG-2zWgMlTzxQeYOcLwOsFaVel1`, a **password-protected zip; the password is `persuade_test`** (stated in the official README). **Not downloaded yet, and must stay untouched until final evaluation.**
- Columns present: `essay_id, essay_id_comp, competition_set, full_text, holistic_essay_score, discourse_id, discourse_start, discourse_end, discourse_text, discourse_type, discourse_type_num, discourse_effectiveness, hierarchical_id, hierarchical_text, hierarchical_label, provider, task, source_text, prompt_name, assignment, gender, grade_level, ell_status, race_ethnicity, economically_disadvantaged, student_disability_status, essay_word_count`. One row per annotated span (a row repeats the whole essay in `full_text`).
- **Sensitive columns** (`gender, grade_level, ell_status, race_ethnicity, economically_disadvantaged, student_disability_status`) are **never read**: `prepare.py` selects only `KEEP = essay_id_comp, full_text, discourse_start, discourse_text, discourse_type, prompt_name, task, competition_set`. Do not add them back, log them, or write them anywhere.
- Labels in `discourse_type`: Lead, Position, Claim, Counterclaim, Rebuttal, Evidence, Concluding Statement, plus **Unannotated** (the gaps). Do **not** use `holistic_essay_score`, `discourse_effectiveness`, or the `hierarchical_*` columns as role labels, and do not train a CSS/essay-grading model.

### Data quirks (all handled in `persuade_prep/align.py`)

1. `essay_id` is in scientific notation (`5.40889E+12`) and lossy. **Use `essay_id_comp`** (12-char id) as the key.
2. `discourse_start/discourse_end` **do not index `full_text`** (0 of 5,000 sampled spans matched; the drift grows along the essay; `end` behaves like the last character). They are **not trusted**; they are used only to order rows.
3. Spans are recovered by **ordered verbatim search** of `discourse_text` in `full_text` (the text is stored verbatim; found for 99.93% in a 19,893-span sample). Python indices are code points; the TypeScript app uses UTF-16 code units, so both offsets are stored (`start/end` and `start_u16/end_u16`).
4. Annotation texts often omit a sentence-final period or a first letter. Gaps of at most 3 non-space characters between located annotations are absorbed into the adjacent labelled span (punctuation goes to the span before, other characters to the span after). Longer gaps exclude the essay.
5. A short unannotated tail after the last annotation (median ~47 chars, mostly after a Concluding Statement) is kept as unlabelled text if it is at most 20% of the essay; longer tails exclude the essay.

### Real preprocessing result (seed 13, 10% validation by essay, stratified by prompt)

Command (cheap; ~12 s): see section 7. Output goes to `~/galti-pakar-data/persuade/prepared/{train,val}.jsonl` and `summary.json`.

- Essays read 15,594; **excluded as unalignable 115 (0.7%)** (84 long tail, 30 text not found, 29 long gap, with some overlap in counting); duplicates removed 1.
- Gap handling counts: absorbed into previous span 23,388; into next 740; short unlabelled tails kept 2,658; ignored 64.
- **Train: 13,930 essays, 5,872,450 words.** Spans: Lead 8,328; Position 13,776; Claim 44,973; Counterclaim 5,225; Rebuttal 3,896; Evidence 40,911; Concluding Statement 12,087.
- **Validation: 1,548 essays, 650,483 words.** Spans: Lead 924; Position 1,534; Claim 4,966; Counterclaim 557; Rebuttal 421; Evidence 4,511; Concluding Statement 1,368.
- Class imbalance: Rebuttal and Counterclaim are rare (~3-4% of spans); Claim/Evidence dominate. Use class weighting or similar and report per-class metrics.
- Overlapping annotations are essentially absent (1 essay in a 5,399-essay sample).
- Leakage notes: split is by essay; the 15 prompts appear in train, validation and test (so results measure same-prompt generalisation, not unseen-prompt). Duplicate essays are removed by normalised-text hash before splitting. No student id exists, so same-student leakage cannot be excluded.

## 6. Label mapping (PERSUADE -> Galti Pakar), already coded in `persuade_prep/labels.py`

| PERSUADE | Galti role | Fit |
|---|---|---|
| Position | thesis | good |
| Claim | claim | good |
| Counterclaim | counterclaim | good |
| Rebuttal | rebuttal | good |
| Concluding Statement | conclusion | good |
| Evidence | evidence | **partial**: PERSUADE evidence is any idea or example supporting a claim (much is general reasoning); Galti separates concrete `evidence` from `premise` |
| Lead | none | no equivalent (attention-getting opener) |
| Unannotated | none | outside any span |

Galti roles with **no PERSUADE source**: `premise`, `other`. The classifier never produces them. **Decision:** the model is trained on PERSUADE-native labels (7 classes + O; BIO tags `labels.BIO_TAGS`, 15 tags); mapping to Galti roles happens only in a separate adapter. When comparing with Gemini, merge Gemini's `evidence` and `premise` into one comparable class and state this in every report.

## 7. Setup on the GPU PC

```
git clone git@github.com:Abdullah-creator-alt/galti-pakar.git && cd galti-pakar
git checkout feature/persuade-classifier        # if not pushed, see section 3
cd training/persuade
python3 -m venv .venv && source .venv/bin/activate     # .venv is gitignored
pip install --upgrade pip
pip install -r requirements-train.txt                   # pick the torch build for your CUDA from pytorch.org if needed
python -I -m unittest discover -s . -t .                # expect: Ran 25 tests ... OK
# data (outside the repo):
mkdir -p ~/galti-pakar-data/persuade && cd ~/galti-pakar-data/persuade
curl -L -o persuade_2.0_train.csv "https://drive.usercontent.google.com/download?id=13phHyDzIsb0MHyJr6q-B-qIa9P2tM135&export=download&confirm=t"
ls -l persuade_2.0_train.csv                            # expect 616894963 bytes
cd - >/dev/null
python -c "import sys; sys.path.insert(0,'.'); from persuade_prep import prepare; raise SystemExit(prepare.main(['--train-csv','$HOME/galti-pakar-data/persuade/persuade_2.0_train.csv','--out-dir','$HOME/galti-pakar-data/persuade/prepared','--val-fraction','0.1','--seed','13']))"
```
Expected summary: train 13,930 essays, val 1,548 essays (numbers in section 5). If they differ, investigate before training (different CSV version, or a code change).

For the TypeScript side (Phase 3/4): `npm install`, copy `.env.example` to `.env.local` and add `GEMINI_API_KEY` (never commit it), `npm test`, `npx tsc --noEmit`.

## 8. Phase 2: train the span classifier (NOT STARTED)

Create `training/persuade/persuade_train/` (new Python package; keep Python out of the production runtime). Do not claim success unless training actually ran and the checkpoint reloads for inference.

1. **Model.** Maintained pretrained encoder, token classification head over the 15 BIO tags. **For a 4 GB GTX 1650 mobile under time pressure, use `distilbert-base-uncased` (6 layers, 66M params) first** — it is the fastest well-supported option that still covers all 7 classes reasonably, including the rare Rebuttal/Counterclaim ones. Only move to `distilroberta-base`/`roberta-base` (slower, more VRAM) or `microsoft/deberta-v3-base` (best accuracy, slowest, needs fp32/bf16 — not fp16-safe on some versions) if there is a bigger GPU (>=16 GB comfortable, 8-12 GB workable with smaller batches) or more time available. `microsoft/MiniLM-L12-H384-uncased` is smaller/faster still but weaker on the rare classes; only drop to it if DistilBERT is still too slow. Record the exact model id and revision used. Prefer a model with a fast tokenizer (needs `offset_mapping`).

   **Speed settings for the GTX 1650 mobile (4 GB), in order of impact:** (a) mixed precision (fp16 via `torch.cuda.amp` or `accelerate`) — the single biggest speedup on this card; (b) batch size 8-16 at a 256-token window, or 4-8 at 512 tokens, whichever fits; (c) 2-3 epochs, not 5, selecting the checkpoint by validation macro-F1 and stopping early if it plateaus. If still too slow, shorten the window to 256 tokens or train on roughly half the essays while keeping every Rebuttal/Counterclaim example (they are already only ~3-4% of spans). Rough estimate for DistilBERT at fp16 on this GPU: on the order of 20-30 min/epoch, i.e. about 1-1.5 h for 3 epochs — unmeasured, run the 20-step speed check below first and adjust the plan from the real number.
2. **Tokenisation and labels.** Work on the **original `text`** only. Tokenise with `return_offsets_mapping=True`, `truncation=False` for the full essay, then chunk. Label each token by the character span that contains the token's start offset: `B-X` for the first token of a span, `I-X` for later tokens, `O` otherwise; special tokens and padding get `-100`. Use the Python code-point offsets (`start/end`) when working in Python; keep `start_u16/end_u16` for anything that goes to TypeScript. Handle Unicode and tokens that straddle a span boundary explicitly (assign by token start; count straddlers in the data report).
3. **Long essays.** Windows of up to 512 tokens with overlap (suggest stride 128). At inference, aggregate overlapping window logits per token (average the logits or take the window where the token is most central), then decode. Test the chunk reconstruction on synthetic long inputs (unit test, no model download needed: use a stub tokenizer/logits).
4. **Decoding to spans.** Convert the BIO prediction to character spans using offset mappings: start of first token to end of last token, within the original text; repair invalid sequences (an `I-X` with no `B-X`) with a documented rule. The output span text must be `text[start:end]` of the **original** essay, never rebuilt from tokens.
5. **Imbalance.** Class-weighted cross-entropy (or focal loss) with weights derived from training token counts; report the weights.
6. **Reproducibility.** Fixed seeds (python, numpy, torch, dataloader workers), deterministic split from `prepare.py` (seed 13), logged config, library versions (`pip freeze`), git commit. Save: `config.json`, `label_map.json` (the BIO tags and the PERSUADE->Galti mapping), tokenizer files, `evaluation.json` with metadata, and `TRAINING.md` instructions. Checkpoints go to `training/persuade/artifacts/` (gitignored). **Never commit weights or data.**
7. **Selection.** Choose the checkpoint by **validation** metrics only (macro-F1 over the 7 classes at span level is a sensible primary metric). **Do not touch the official test set** until the very end, once, with the chosen checkpoint.
8. **Metrics (define them in `EVALUATION.md` and implement them with unit tests):**
   - Token-level per-class precision/recall/F1 (on tokens, excluding `-100`).
   - Span-level **exact** match (same label, same start and end after trimming whitespace) and **overlap** match (same label, IoU >= 0.5), per-class P/R/F1, macro-F1 and micro-F1.
   - A frequency/majority baseline (predict the most common label by sentence position or by class prior) and a simple rule baseline (e.g. first sentence = Position, last = Concluding Statement) for context.
9. **Inference test.** A script that loads the saved checkpoint and tokenizer fresh, runs a few synthetic sentences, and prints spans; this is the proof the checkpoint "can be loaded for inference".
10. Time/compute: one epoch over 13,930 essays (~9M tokens at 512-token windows) is minutes to tens of minutes on a modern GPU for a base model. Use mixed precision (bf16 if supported), gradient accumulation if memory is tight, and 3-5 epochs with early stopping on validation macro-F1.

**Before committing to a full run:** benchmark ~20 training steps of the chosen model at the chosen batch/window size and fp16 setting, measure seconds/step, and extrapolate the epoch time from the real token count (reported in `summary.json` from Phase 1). Compare against the estimate above and adjust batch size / window / epoch count accordingly before starting the full training run.

Acceptance for Phase 2: training ran, validation metrics reported per class with the definitions above, baseline reported, checkpoint reloads and predicts, nothing large committed. If metrics are poor (e.g. Rebuttal/Counterclaim near zero), report that honestly and stop to ask before continuing.

## 9. Phase 3: compare with Gemini (NOT STARTED)

Build an explicit offline command (`python -m persuade_eval ...` plus a small TypeScript runner for Gemini, or Python reading cached Gemini output). Same essays and mapping for every system; predictions and gold stored separately.

1. **Comparison unit = sentence.** Gemini works on sentences produced by `lib/structure/normalize.ts` (`normalizeEssay`). So segment each evaluation essay with the same logic (run the TypeScript code on the essay text, or port it exactly and test equality), then derive gold sentence labels from PERSUADE spans: a sentence takes the label of the span covering >= 50% of its characters, else `O`. Document this and report how many sentences straddle two spans.
2. **Systems:** (a) the trained classifier (spans -> sentence labels by the same >= 50% rule, mapped through `labels.GALTI_ROLE`), (b) Gemini via the existing extractor, (c) optionally the hybrid after fusion exists. Map comparable labels: thesis, claim, counterclaim, rebuttal, conclusion, and `evidence_or_premise` (Gemini evidence+premise vs PERSUADE Evidence). `Lead`/`O`/`other` map to "unlabelled". State the partial-fit of Evidence.
3. **Gemini runs must be opt-in and cached.** Call the real extractor only from an explicit command (suggest `npm run eval:persuade-gemini -- --limit N`), writing `training/persuade/artifacts/gemini_cache/<essay_id>.json` (gitignored) with: essay id, essay text hash, model, prompt version (`EXTRACTION_PROMPT_VERSION` in `lib/structure/prompt.ts`), raw elements, latency ms, attempts, failure code if any. Re-running reads the cache. Ordinary `npm test` and Python tests must never call Gemini or download data. Mind the quota: choose a documented evaluation subset (e.g. 200 validation essays, stratified by prompt and seed 13) and use the **same subset for both systems**.
4. **Report:** per-class P/R/F1, macro-F1, sentence-mapping accuracy, count of invalid or unalignable Gemini ids/spans, confusion matrix, latency and failure rate, differences between the two label systems, and representative errors **without essay text** (use ids/offsets/labels only; private essay text must not enter committed reports). Never write that PERSUADE results prove CSS-domain performance.
5. Existing helpers you can reuse: `lib/structure/compare.ts` (`compareRuns`), `lib/structure/fixtures.ts`, `lib/structure/promptCases.ts`, and `scripts/eval-structure.ts` for the pattern.

## 10. Phase 4: hybrid integration (NOT STARTED; only after a trained model loads and inference is tested)

All rules from the brief apply; the essentials:

1. **Typed adapter** (new file, e.g. `lib/structure/classifier/adapter.ts`): input = predicted character spans (UTF-16 offsets into the exact essay string) + per-span class + score; output = candidate role per existing sentence id using the same >= 50% overlap rule used in evaluation, restricted to the supported roles (thesis, claim, counterclaim, rebuttal, conclusion, evidence-as-"evidence_or_premise"). It must never reconstruct text from tokens.
2. **Keep outputs separate** until an explicit `fuseRoles(gemini, classifier, options)` function (pure, unit-tested). Design it from validation evidence: class-specific behaviour, thresholds chosen on validation data, documented rules. **Raw softmax is not calibrated confidence**; if you use probabilities, calibrate on validation (e.g. temperature scaling or isotonic) and report calibration error, otherwise treat scores as ordinal only.
3. **Disagreement policy:** do not average blindly and do not force agreement. When both systems label a sentence differently, keep the disagreement visible: set the element role by a documented rule, put the other reading in `alternativeRole`, lower `modelConfidence`, and let the existing `uncertain_classification` diagnostic fire (see `diagnose.ts`, rule 7). When the classifier is missing/failed, return Gemini's result unchanged.
4. **The classifier never creates relationships.** Links stay in `link.ts`; diagnostics stay in `diagnose.ts`. Do not change thresholds or the prompt to flatter the new model.
5. **Schema compatibility.** Prefer no schema change. If metadata needs to record the classifier (e.g. `analysisMetadata.classifier`), make it an additive optional field, bump `STRUCTURE_SCHEMA_VERSION` (minor), update `schema.ts`, `validate.ts`, README and tests. The fused result must pass `validateStructureAnalysis` and keep stable `s1..` sentence ids so downstream consumers of the structure output (including the Examiner Second Opinion) keep working.
6. **Feature flag, default off.** e.g. `STRUCTURE_CLASSIFIER_MODE=off|shadow|hybrid` read server-side (document it in `.env.example` with an empty/off default). `off` = current behaviour (Gemini only). `shadow` = run the classifier and record its output/metrics without affecting the result. Turning it off must not need a code rollback. Gemini-only fallback must always work, including on classifier timeout/error.
7. **Injection point:** `analyzeEssayStructure(input, deps)` takes injected dependencies (see `StructureDeps` in `lib/structure/analyze.ts`). Add an optional `classify?: (text, sentences) => Promise<ClassifierOutput | null>` dependency and call the fusion after the element-extraction step and before the linking step in `analyze.ts`. Do not add Python or model weights to the Next.js bundle.
8. **Tests (no network, no checkpoint, no data):** span-to-sentence mapping (incl. UTF-16/emoji), long-input reconstruction, model-output schema, fusion for agreement / disagreement / low confidence / missing output, Gemini-only fallback, feature-flag behaviour, failure handling, and the existing test suite unchanged (re-run it; do not rely on a count).

## 11. Phase 5: deployment on Vercel (budget and measurements; NOT STARTED)

**Rule: the classifier must stay well inside Vercel's limits, with headroom, and must not ship until the licence decision in section 13 is recorded.** Nothing here is measured yet except the Vercel limits and the npm package sizes. Model sizes are estimates from parameter counts.

### Vercel limits (checked from Vercel's docs, "Vercel Functions Limits", last updated 2026-08-24)

| Limit | Value | Source of limit |
|---|---|---|
| Function size, uncompressed, incl. layers | **250 MB** per function (enforced by AWS Lambda) | Vercel |
| Large functions beta | up to 5 GB; **do not use**, it is beta and would add dependence on a beta feature | Vercel |
| Memory | Hobby: 2 GB / 1 vCPU. Pro: 2 GB default, max 4 GB / 2 vCPU | Vercel |
| Duration | Hobby: 300 s default and max. Pro: 300 s default, 800 s max | Vercel |
| Request or response body | 4.5 MB | Vercel |
| Our route setting | `maxDuration = 60` in the app's own route file | project config, not a Vercel limit |

Design for the **Hobby** limits (2 GB, 250 MB, 300 s) so it works on either plan.

### Our budget (self-imposed headroom)

| Item | Budget | Basis / status |
|---|---|---|
| Whole function bundle, uncompressed | **target <= 120 MB, hard ceiling 200 MB** | 50% and 80% of the 250 MB limit, leaving room for the app's own code and growth |
| Model weights in the function | **int8 ONNX, <= 100 MB** | distilbert-base-uncased (current default, section 8) int8 is an estimate of about 65 MB (fp32 ~260 MB); distilroberta-base int8 is about 80 MB (fp32 ~330 MB). Either is not allowed in fp32 inside the function |
| ONNX runtime | **must be trimmed to the linux-x64 binary only** | `onnxruntime-node` 1.30.0 is **301 MB unpacked** on npm across all platforms, so bundling it whole is not acceptable. The trimmed size is **not measured yet** |
| Memory per invocation | model load + session <= **1 GB** | half of the 2 GB Hobby limit |
| Duration per essay (cold start incl. model load) | target <= **20 s**, hard limit 300 s | estimate only; must be measured on a Vercel preview |
| Payload | send essay **text** only (<= 40,000 characters, far below 4.5 MB); never images | `lib/structure/analyze.ts` limit |

### If the budget cannot be met

Choose one, and record it here before deciding:
1. A separate authenticated inference service (adds cost, secrets handling, uptime work and a new endpoint, all needing owner approval).
2. Keep the classifier offline or in shadow mode only (no deployment of weights).

Do not raise the budget to fit a larger model. Do not switch to the 5 GB large-functions beta to avoid the limit.

### Measurements required before any production decision

Run these on the GPU PC or in a scratch project, not in the production app:
1. Export the fine-tuned model to ONNX and quantise to int8. Record the file size. Check accuracy drop on validation data against the fp32 model.
2. Install `onnxruntime-node` in a scratch Next.js project and keep only the linux-x64 binary. Record its size.
3. Run `next build` (and `vercel build` if available) and record the size of the function bundle, including `.vercel/output` if produced. Compare with the budget above.
4. Deploy to a Vercel **preview** only. Record cold-start time, warm time per essay, and peak memory from the function logs, for one short and one long essay (about 600 and 1,500 words).
5. Write the results into this section with dates and the exact Vercel plan used. Until these results exist, the classifier is **not** deployable.

### Current verdict

Not yet verified as deployable. It is plausible within the budget only if an int8 model and a linux-only runtime both fit, and the licence decision in section 13 is recorded first.

## 12. Phase 6: CSS-specific direction

Keep the generic classifier separate from CSS interpretation. PERSUADE gives no FPSC criteria: do not invent official rules, examiner weights or marks. The existing optional analysis-profile mechanism (`lib/structure/profile.ts`) stays untouched. Test the existing diagnostics on CSS-style essays only if such essays are available, and label that as a separate domain check. No automatic marks, overall grading or fact-checking.

## 13. License and data-handling rules (do not skip)

- PERSUADE 2.0 is **CC BY-NC-SA 4.0**: attribution, non-commercial use only, share-alike. This project's intended use may be commercial. **Do not distribute or deploy weights trained on PERSUADE, and do not assume the license permits commercial deployment, until a human has reviewed the intended use.** Make no legal claim about whether weights are derivative works. Flag this prominently in the final report.
- Never commit raw essays, the CSV, the prepared JSONL, demographic or personally identifying fields, dataset archives, model checkpoints, Gemini caches, secrets or `.env.local`. `.gitignore` already covers `training/**/data/`, `training/**/artifacts/`, `training/**/.venv/`, `*.pt`, `*.safetensors`, `*.onnx`; keep prepared data outside the repo (`prepare.py` refuses `--out-dir` inside it).
- Cite: Crossley, S. A., Baffour, P., Tian, Y., Franklin, A., Benner, M., & Boser, U. (2024). A large-scale corpus for assessing written argumentation: PERSUADE 2.0. *Assessing Writing, 61*.

## 14. What to report when finished (from the brief)

1. Architecture and label-mapping decisions. 2. Files created/changed. 3. Dataset setup and license notes. 4. Exact training and evaluation commands. 5. Actual metrics, dataset sizes, limitations. 6. Whether a checkpoint was really trained and loaded. 7. Whether hybrid integration is enabled, experimental or pending. 8. Deployment recommendation with evidence. 9. Test, TypeScript and build results (`npm test`, `npx tsc --noEmit`, `npx next build`, Python tests). 10. Remaining limitations, especially transfer from US school essays to CSS essays. Anything not run (GPU, data) must be reported as not run. Work incrementally; stop after a phase whose acceptance criteria fail and ask before any risky or architecture-changing step.

---

## Appendix A: the original task brief (verbatim requirements)

> **Galti Pakar — PERSUADE-trained hybrid argument classifier.** Existing Next.js + TypeScript/Vercel app with Gemini-based argument-role extraction, TypeScript candidate argument linking and structural-gap diagnostics, thesis-relevance analysis, a versioned analysis schema and validation, and an Examiner Second Opinion interface. Next milestone: train a specialized argument-component classifier using PERSUADE 2.0, evaluate it against the existing Gemini extraction, and introduce a hybrid integration path if the results justify it. PERSUADE 2.0: https://github.com/scrosseye/persuade_corpus_2.0 (25,000+ argumentative essays by US students in grades 6-12; annotations include argumentative/discourse spans and effectiveness-related labels; not a CSS dataset). License CC BY-NC-SA 4.0: respect its terms; do not assume it permits commercial deployment or unrestricted distribution of trained weights.
>
> **Primary objective:** an experimentally validated, specialized argument-span classifier that complements the existing Gemini extraction without breaking the application, analysis schema, TypeScript diagnostics, CSS-specific direction, or Examiner Second Opinion interface. Do not rebuild the UI.
>
> **Phase 0 - Inspect before editing.** Inspect the Git branch and working tree (do not discard, reset or overwrite work); the analysis entry point, Gemini adapter, sentence segmentation, schema, validators, diagnostics, tests, package scripts, Vercel configuration, environment handling; run existing tests, TypeScript checks and the production build, recording pre-existing failures; inspect the actual PERSUADE README and a small sample of real data (exact columns, classes, character offsets, essay IDs, splits, license); write a brief architecture proposal including how the trained model would run in the actual deployment environment. Do not guess repository structure, schema fields, dataset columns or deployment limits.
>
> **Phase 1 - Dataset preparation and label mapping.** Keep raw dataset files outside the app source tree and add local data paths to ignore rules. Never commit raw essays, personally identifying or demographic records, dataset archives, secrets, or generated dataset copies. Build a reproducible preprocessing script in a separate Python training workspace (or another isolated location) without introducing Python into the production Next.js runtime. Preserve original text and annotation character offsets; handle Unicode, whitespace, offset conventions, overlapping annotations and span-boundary errors explicitly. Inspect all source labels and map only genuinely compatible labels to Galti Pakar roles; document the mapping including unsupported or ambiguous labels; do not silently equate PERSUADE labels with `premise`, `evidence` or `rebuttal` when definitions do not match. Prefer the official training data and derive validation data at the essay level; keep the official test data untouched until final evaluation. Avoid train/validation/test leakage from duplicated essays, sentences, or prompt-related preprocessing. Do not use holistic essay scores or effectiveness scores as role labels; do not train a CSS grading model. Deliver a data summary and preprocessing tests before training.
>
> **Phase 2 - Train a span-aware classifier.** Maintained pretrained transformer encoder compatible with available GPU hardware. Token classification (or another span-aware architecture) suitable for recovering annotated argument-component spans; not whole-essay classification. Choose a practical model size after checking hardware and dependencies. Reproducible training, validation, checkpoint saving, random seeds, inference. Handle class imbalance, long essays, chunking, overlapping windows and reconstruction of character offsets. Evaluate on validation data before selecting a checkpoint; do not repeatedly tune against the official test set. Report per-class precision, recall, F1, macro-F1, micro-F1 where useful, and span-level exact/overlap metrics; document metric definitions. Include a majority/frequency or other simple baseline. Save model configuration, label mapping, tokenizer/version information, evaluation metadata, and training instructions. Keep checkpoints and large artifacts out of Git. Do not claim successful training unless it ran and the checkpoint can be loaded for inference.
>
> **Phase 3 - Compare against Gemini.** An explicit offline evaluation command comparing the specialized classifier, the existing Gemini extractor, and optionally a hybrid. Same essays and a documented mapping to comparable labels; keep predictions and gold separate. Report per-class P/R/F1, span-boundary or sentence-mapping performance, invalid or unalignable spans, confusion matrix, latency and failure rates, representative errors (private/local essay text excluded from committed reports), and differences between the dataset label system and Galti Pakar's role schema. Same evaluation subset for both systems. Keep live Gemini calls out of ordinary automated tests; support cached predictions or an explicit opt-in command. Do not claim PERSUADE performance proves CSS-domain performance.
>
> **Phase 4 - Hybrid integration.** Only after the trained model can be loaded and inference is tested. Typed adapter from predicted character spans to existing sentence IDs and supported roles. Preserve the original essay exactly. Keep classifier and Gemini outputs separate until an explicit fusion function. Design fusion using validation-calibrated confidence where feasible, class-specific evaluation and documented rules. Do not treat raw softmax as calibrated confidence without validation. No blind averaging or forced agreement; on disagreement preserve it or mark the role uncertain. The classifier must not invent relationships; keep existing TypeScript relationship and diagnostic logic. Validate the fused result against the existing schema and stable sentence references. Preserve a Gemini-only fallback and add a feature flag/config setting so the classifier can be disabled without a code rollback. The existing analysis entry point and Examiner Second Opinion UI must keep working with the current output schema. Do not change the extraction prompt, relevance thresholds or existing diagnostics merely to improve the new model's reported performance.
>
> **Phase 5 - Deployment design.** Inspect real constraints (Next.js on Vercel; training in a GPU Python environment). Evaluate ONNX export with Node.js inference if dependencies, model size, memory and Vercel limits allow; a separate secured inference service if local inference is unsuitable; or an experimental/offline-only model if neither is currently safe. Do not add an external service, deploy weights, or expose a new endpoint without documenting cost, security, latency, operational requirements and configuration. Keep API keys server-side; never place secrets in client bundles, committed files, logs or reports. Before any distribution or deployment of PERSUADE-trained weights, document the license restrictions and flag the need for human review; make no legal assumptions about derivative works.
>
> **Phase 6 - CSS-specific goal.** Preserve the existing CSS-specific analysis-profile work or intended direction. PERSUADE is general argumentative-writing annotation, not FPSC criteria; keep the generic classifier separate from CSS interpretation; do not invent official CSS rules, examiner weights or marks. Test the existing diagnostics with CSS-style essays when available and label that as a separate domain check. No automatic marks, overall grading, or subject-matter fact-checking.
>
> **Tests and acceptance.** Automated tests for dataset label mapping and preprocessing; character-offset integrity and Unicode; span-to-sentence mapping; long-input/chunk reconstruction; model output schema; fusion behaviour (agreement, disagreement, low confidence, missing classifier output); Gemini-only fallback; existing TypeScript diagnostics and schema compatibility; failure handling and feature-flag behaviour. Ordinary unit tests must not download the dataset, load a large checkpoint or make live Gemini calls (use small synthetic fixtures and mocked responses). Run existing tests, Python training-workspace tests, TypeScript checks and the production build. If a task needs GPU or data not available, report it as not run.
>
> **Deliverables** (also section 14 above). Work incrementally. Stop after each phase if its acceptance criteria fail, explain, and ask before taking a risky or architecture-changing step. Do not refactor unrelated code.
