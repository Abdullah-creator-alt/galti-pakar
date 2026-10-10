# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Galti Pakar: a CSS (Pakistan civil service exam) essay analyser built for the AICON'26 "Build With AI" hackathon. A candidate uploads photos of a handwritten practice essay plus a topic and gets a feedback report. Next.js 15 (App Router), React 19, TypeScript strict, Tailwind v4, Gemini API only, deployed to Vercel.

Hackathon rules that shape the work (`rules of hackthon/`, untracked): AI must contribute meaningfully, judges may ask about the model, data and prompts, pre-existing code must be disclosed (the design system was extracted from an earlier product, Verchek; the training data is synthetic), and **falsifying results or demos is a disqualification reason**. Never present mock or synthetic output as a real analysis.

## Commands

```
npm run dev                  # Next dev server (localhost:3000)
npm run build                # next build
npm test                     # all unit tests, no API key needed
node --no-warnings --test lib/pipeline/examiner.test.ts    # one test file
node --no-warnings --test --test-name-pattern="clamp" lib/pipeline/examiner.test.ts   # one test
npx tsc --noEmit             # typecheck (there is no lint script)
```

Scripts in `scripts/` run TypeScript directly with Node (type stripping, no build step). Ones that call Gemini load `.env.local` via `--env-file-if-exists`. All have an npm alias:

- `check:gemini`: verifies the key, lists models, tests text/vision/embedding calls.
- `test:read -- page1.jpg ...`: handwriting transcription on real photos (`TOPIC=... ` env optional).
- `test:measure | test:genericness | test:benchmark -- essay.txt --topic "..."`: run pipeline stages on a text file (paragraphs separated by blank lines).
- `test:examiner -- --essay f.txt --topic "..." [--runs 2] [--findings f.json] [--measure]`: appends a line to `data/eval/examiner-metrics.json`.
- `build:data` (generate synthetic datasets + embeddings, resumable via `data/cache/`), `train:genericness`, `eval:drift`, `validate:reference`, `build:benchmark`, `eval:benchmark`, `eval:structure`.

Node 24 is required. Because scripts and tests run through Node's type stripping: use **relative imports with explicit `.ts` extensions inside `lib/` and `scripts/`**, avoid TypeScript-only runtime syntax (no parameter properties, no enums), and note the `@/` alias only works under Next (route files), not in scripts/tests. Shell heredocs containing apostrophes break in the Bash tool; write such files with the Write tool.

## Architecture

**The UI calls /api/analyze, which runs the real pipeline.**

1. **UI** (`app/`, `components/`): Upload (`/new`), Processing (`/analysing`), Report (`/report/[id]`), History. Photos are compressed in the browser (`lib/client/compressImages.ts`, 3.8 MB total budget for Vercel's body limit), held in the module store `lib/client/analysisStore.ts` (survives the navigation, shares one in-flight request, 90 s timeout) and POSTed to `/api/analyze` as `topic` plus repeated `images`. The response (`{ report, extras }` or a bare `EssayReport`) is validated (`lib/client/response.ts`) and saved by `lib/storage.ts` (localStorage, max 20, in-memory fallback, never stores images). Report pages are client components (`ReportLoader`) because the data is on the device; `lib/data.ts` resolves an id as example, then storage, then `/demo-reports/<id>.json`. The report contract is `EssayReport` in `lib/types.ts`; the optional side data (trace per highlight, claim map, conflicts, verification, benchmark, ...) is `ReportExtras` in `lib/types.extras.ts`, always treated as untrusted and parsed leniently (bad parts dropped, never throws). Every extras-driven section renders nothing when its data is missing. Colours come only from CSS tokens in `app/globals.css`; `GALTI_PAKAR_DESIGN_BRIEF.md` is the design spec. `lib/derive.ts` holds the computed helpers (bands, drift, agreement).
2. **Backend pipeline** (`lib/pipeline/`, `lib/structure/`, `app/api/`): `POST /api/analyze` runs the real pipeline end to end via `runPipeline` in `lib/pipeline/orchestrate.ts` and returns `{ report, extras }`; it never returns mock data (the mock report exists only for `/report/example`). `GET /api/health` reports whether the key and the bundled data files are present.

**Pipeline flow** (`orchestrate.ts`; each step is a separately testable function):
0. validate (`validate.ts`) -> 1. `readHandwriting` -> 2. one request-scoped embedding cache (`sharedEmbed.ts`, re-exported as `createRequestEmbed`) prefetches topic, paragraphs and sentences -> 3. `measureEssay` runs structure | genericness+drift | benchmark in parallel, plus `ruleChecks` -> 4. `scoreExaminers` -> 5. `blendAnalysis` -> 6. `coachEssay` -> 7. `assembleBundle` (`assemble.ts`) validates and builds `{ report, extras }`. Failure policy: no essay or no scoring stops the request (422/500); any measuring stage or the examiner failing continues without that finding and adds a plain warning; the coach has template fallbacks, and if only the rewrite fails the paragraph is shown unchanged with a warning. A busy AI service is always a 503 with `Retry-After`. Steps are injectable through `PipelineDeps`, so tests run the whole hierarchy offline (`testkit.ts` `happyDeps`). `adapters.ts` reconciles shapes between steps.

Step detail:

1. `readHandwriting` (`steps.ts`, `transcribe.ts`, `prepareImages.ts`): sharp resizes/rotates photos, one Gemini vision call with all pages, `responseSchema`, retry once on invalid JSON, fallback models on 429/503/timeouts. Ids, word count and the "uncertain word" hallucination guard are done in code. Output: `TranscribedEssay`.
2. `measureEssay` (`measure.ts`) runs three stages in parallel, sharing one embedding request (`sharedEmbed.ts`); a failed stage is skipped, not fatal:
   - structure: `lib/structure/` (self-contained module, see its README): one LLM call labels sentence roles, rule-based code links and diagnoses. It is **not a trained model**.
   - genericness + drift (`analyse.ts`): embeddings plus a logistic regression trained in plain TS (`logreg.ts`, `features.ts`), assets in `data/`. Drift is a percentile rank of the essay topic's similarity among 50 bank topics.
   - benchmark (`benchmark.ts`): coverage of key points per theme plus a style profile against reference essays; currently only the AI-written checklist exists (no reference essays).
3. `scoreExaminers` (`examiner.ts`): LLM scores 7 dimensions after the measurements exist, must quote the essay; `verifyQuotes.ts` checks every quote in code (exact match after normalisation, offsets back into the original text). Bands come only from `rubric.ts` `bandFromScore`, never from the model. Returns `SecondOpinion` (named so to avoid clashing with `ExaminerResult` in `lib/types.ts`).

`findings.ts` adapts each step's output into the optional-field `MeasuredFindings` the examiner reads. `schema.ts` is the zod mirror of `EssayReport`, checked against the TS type at compile time; validate any pipeline output with it before it reaches the UI.

**Gemini access** is only through `lib/gemini.ts` (server-only REST client) and `lib/pipeline/embed.ts` (one embedding task type, L2-normalised, batched, honours 429 retry hints). Model names live in `lib/config.ts`, which also holds all tuned thresholds (`DRIFT_THRESHOLD`, `BENCHMARK.*`, embedding budget).

## Things that will bite you

- **Free-tier quota.** Text models allow about 20 requests/day each; embeddings about 100 texts/minute and **1,000 texts/day** (building data and evaluating uses them up; when exhausted, drift, genericness, the benchmark and claim linking degrade). `EMBED_TEXT_BUDGET` caps an essay at 95 embedded texts; sentences beyond it are `unassessed` (never guessed). Most steps rotate through fallback models; `lib/structure/provider.ts` does not (single model, `thinkingBudget: 0`).
- **`thinkingBudget: 0` hangs `gemini-3.8-flash`** and `thinkingLevel: "minimal"` is rejected. `gemini-2.5-flash` is no longer available to new keys.
- **Thresholds were tuned on synthetic data** (AI-written sentences/paragraphs). Embedding cosines are high for everything (unrelated text ~0.73-0.83), so raw-cosine thresholds are unreliable; treat metrics (100% genericness test accuracy) as smoke tests, not evidence.
- Do not label measurement outputs as "trained on PERSUADE" or similar: nothing in the repo is. State what each stage really is (LLM labels, rules, logistic regression on synthetic data).
- The four runtime data files (`topics.embedded.json`, `generic-bank.embedded.json`, `genericness-model.json`, `benchmark.json`) are imported **statically** (`import ... with { type: "json" }` in `dataFiles.ts` and `benchmark.ts`) so the bundler ships them with the function. Do not read `data/` with `fs` or `path.join(process.cwd(), "data")` in server code: Next's tracing then ships the whole folder (caches included). `npm run build && npm run verify:bundle` proves the data is bundled and the caches are not. (`outputFileTracingExcludes` does not work on Windows, which is why static imports are used.) `data/cache/` and `data/reference-raw/*` (full essay texts, only its README is tracked) are git-ignored; never commit essay text. `benchmark.json` must hold paraphrased points only (max 25 words, enforced by schema and a test).
- `GEMINI_API_KEY` goes in `.env.local` (git-ignored; template in `.env.example`) and must never reach client code.
- Two people push from two laptops; `git pull --rebase origin main` before working.
