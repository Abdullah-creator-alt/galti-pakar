# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Galti Pakar: a CSS (Pakistan civil service exam) essay analyser for the AICON'26 "Build With AI" hackathon (deadline: Saturday night 10 Oct 2026; deliverables: GitHub link, deployed link, PPTX demo, 5-minute demo). A candidate uploads photos of a handwritten practice essay plus a topic and gets a feedback report. Next.js 15 (App Router), React 19, TypeScript strict, Tailwind v4, Gemini API only, Vercel.

Rules that shape the work (`rules of hackthon/`, untracked): AI must contribute meaningfully, judges may ask about model/data/prompts, pre-existing code must be disclosed (design system extracted from an earlier product, Verchek; training data is synthetic), and **falsifying results or demos can disqualify**. Never present mock or synthetic output as a real analysis. Judged on: AI integration depth, problem solving, demo and presentation, creativity and SDG impact, industrial impact.

## Status (update this section when it changes)

Built and working: handwriting read, parallel measuring (structure, genericness+drift, benchmark), examiner second opinion with verified quotes, verify/blend/score (Argument X-Ray), coach (3 fixes + one model paragraph), assembly, `/api/analyze`, `/api/health`, the whole UI (upload with compression, processing, report with X-Ray views, history, demo reports). 245 unit tests, offline.

Known gaps and honesty points:
- Structure labels come from **one LLM call plus rules; there is no trained structure model**, and nothing uses PERSUADE (a teammate branch `feature/persuade-classifier` exists, unmerged). Do not claim otherwise.
- Genericness is a logistic regression trained on **synthetic** AI-written sentences; its 100% test accuracy is a smoke test. Benchmark has **no reference essays**, only an AI-written checklist, so the style-profile half is empty.
- Free-tier quotas limit live demos (see below). Pre-run essays and cache them with `npm run demo:add`.
- Never run live end to end with embeddings exhausted: drift, genericness, benchmark and claim linking degrade (the report still validates and says so).
- Not verified in a real browser: layout at 390 px, dark/light, print, keyboard flow, in-browser compression with real photos, hydration.

## Commands

```
npm run dev | build | test        # test = all unit tests, offline, no key
npx tsc --noEmit                  # typecheck (no lint script)
npm run build && npm run verify:bundle   # proves runtime data is bundled, caches are not
node --no-warnings --test lib/pipeline/blend.test.ts                          # one file
node --no-warnings --test --test-name-pattern="clamp" lib/pipeline/examiner.test.ts   # one test
```

Scripts in `scripts/` run TypeScript directly with Node (type stripping); Gemini ones load `.env.local`. Useful: `check:gemini`, `test:read -- p1.jpg p2.jpg`, `test:measure|genericness|benchmark|examiner|blend|coach` (offline fixtures for blend and coach: `data/fixtures/essay1.json`, `--mock`), `build:data`, `train:genericness`, `eval:drift|benchmark|structure`, `validate:reference`, `build:benchmark`, `tune-links`, `demo:add -- bundle.json`.

Node 24. In `lib/` and `scripts/` use **relative imports with explicit `.ts` extensions**, no TS-only runtime syntax (no enums, no parameter properties); the `@/` alias works only under Next. Shell heredocs or `node -e` with apostrophes, backticks or backslashes corrupt content in the Bash tool: use the Write/Edit tools for such files. Never leave the shell's cwd inside `.next/` (it hangs `next build` on Windows).

## Where to look (read these, not everything)

- **Pipeline entry:** `lib/pipeline/orchestrate.ts` (`runPipeline`, failure policy, stage timeouts, injectable `PipelineDeps`); route `app/api/analyze/route.ts`; `lib/pipeline/assemble.ts` builds `{ report, extras }`; `adapters.ts` reconciles step shapes.
- **Steps:** `steps.ts`/`transcribe.ts` (read), `measure.ts` (parallel stage), `analyse.ts` (genericness+drift), `benchmark.ts`, `lib/structure/` (self-contained, has a README), `examiner.ts` + `verifyQuotes.ts`, `blend.ts` + `xray.ts` + `measured.ts` + `verifyFindings.ts` + `coachInput.ts` (rules and thresholds in `blendConfig.ts`), `coach.ts` + `selectFixes.ts` + `verifyCoach.ts`.
- **Contracts:** `lib/types.ts` (`EssayReport`, do not change casually), `lib/pipeline/schema.ts` (zod mirror), `lib/types.extras.ts` (`ReportExtras`, UI contract, always parsed leniently).
- **Config:** `lib/config.ts` holds model names, fallbacks, quotas budgets and every tuned threshold.
- **UI:** `components/report/ReportView.tsx` (composition), `EssayView.tsx` (highlights, trace panel), `ArgumentMap.tsx`, `Extras.tsx`, `Sections.tsx`; flow state in `lib/client/` (`analysisStore`, `compressImages`, `response`, `status`); storage `lib/storage.ts`; data `lib/data.ts`; styling tokens `app/globals.css`, spec `GALTI_PAKAR_DESIGN_BRIEF.md`.

## Pipeline in one paragraph

validate -> `readHandwriting` (sharp, one vision call, fallback models) -> one request-scoped embedding cache prefetches topic, paragraphs, sentences -> `measureEssay` runs structure | genericness+drift | benchmark in parallel (+ `ruleChecks`) -> `scoreExaminers` (2 AI runs, must quote the essay, code verifies each quote, band is derived in code) -> `blendAnalysis` (claim-to-evidence links, colour rules per sentence, cross-checks, 0.4 measured / 0.6 examiner blend, verdict thresholds 0.7 and 0.5 of the scale, uncalibrated) -> `coachEssay` (code picks the top 3 problems and the paragraph; LLM only explains and rewrites one paragraph; code checks quotes, figures, length, slots) -> `assembleBundle`. A failed measuring stage or examiner continues with a plain warning; no essay or no scoring stops (422/500); busy AI is a 503 with `Retry-After`; coach has template fallbacks. Examiners may be empty in a report.

## Things that will bite you

- **Quotas (free tier).** Text models ~20 requests/day each; embeddings ~100 texts/minute and **1,000 texts/day**. `EMBED_TEXT_BUDGET` caps an essay at 95 embedded texts; extra sentences are `unassessed`, never guessed. Steps rotate fallback models (`gemini-3.6-flash`, `3-flash-preview`, `3.8-flash`, `3.1-flash-lite`).
- **`thinkingBudget: 0` hangs `gemini-3.8-flash`**; `thinkingLevel: "minimal"` is rejected; `gemini-2.5-flash` is unavailable to new keys.
- **Embedding cosines are high for everything** (unrelated 0.73-0.83), so raw thresholds are unreliable; link thresholds (0.82/0.76) and others are starting values. Tune with `tune-links` on labelled pairs.
- **Runtime data is imported statically** (`import ... with { type: "json" }` in `dataFiles.ts`, `benchmark.ts`). Never read `data/` with `fs` or `path.join(process.cwd(), "data")` in server code: Next then ships the whole folder, caches included. `outputFileTracingExcludes` does not work on Windows.
- `data/cache/` and `data/reference-raw/*` are git-ignored; never commit essay text. `benchmark.json` holds paraphrased points only (max 25 words, enforced).
- `GEMINI_API_KEY` lives in `.env.local` (git-ignored, template `.env.example`); never in client code. `ALLOW_DEBUG=true` plus header `x-debug: 1` returns stage timings; keep it off in production.
- Two laptops push to this repo: `git pull --rebase origin main` first.
