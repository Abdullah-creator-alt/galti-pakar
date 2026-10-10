# Galti Pakar

Photograph a handwritten CSS practice essay and find out where it loses marks: which passages are strong, weak or off-topic, why, and the three fixes that matter most.

Built for AICON'26 **Build With AI**, domain **EdTech & Workforce**.

- **Live app:** _add the Vercel URL here_
- **Example report (no AI call, sample data):** `/report/example`
- **How the AI works, in the app:** `/how-it-works`

## The problem

Pakistan's Central Superior Services (CSS) exam is the main route into the federal civil service. In CSS 2025, **354 of 12,792 candidates (2.77%) passed the written exam** ([Daily Pakistan](https://en.dailypakistan.com.pk/22-Aug-2025/only-2-77-passed-as-css-written-exam-2025-results-announced)). In June 2025, FPSC officials told a Senate committee that most candidates fail in English Essay and English Précis, and that many **lack logical structure in their arguments** ([ProPakistani](https://propakistani.pk/2025/06/05/heres-why-most-css-aspirants-fail/amp/)). In CSS 2016, 81% failed the essay paper ([Dawn](https://www.dawn.com/news/1300724)).

Candidates write the essay by hand, and good feedback means a tutor or an academy: slow, expensive and concentrated in big cities.

## What it does

**Problem → Input → AI → Output → Impact**

| | |
|---|---|
| **Input** | Phone photos of a handwritten essay (1 to 12 pages) and the topic. |
| **AI** | Gemini vision reads the handwriting; Gemini embeddings and a classifier trained in this project measure topic drift, generic writing and claim-to-evidence links; Gemini labels each sentence's argument role; two separate Gemini examiner runs score seven CSS rubric dimensions; Gemini explains three fixes and rewrites one paragraph. |
| **Checks (code)** | Every examiner quote is checked against the essay, every highlight must match the text, the band is derived in code, measurement and examiner disagreements are shown, and invented figures in the rewrite are replaced by marked slots. |
| **Output** | A marked-up essay where every highlight opens its reason and how it was found, seven scores, a topic-drift chart, an argument map, three ranked fixes and a before-and-after for each weak paragraph (up to three). |
| **Impact** | Specific, explainable feedback in about a minute, from a phone, at no cost to the candidate. |

## Impact

- **SDG 4, Quality Education:** specific, explainable writing feedback on the exact skill examiners say candidates lack, argument structure.
- **SDG 10, Reduced Inequalities:** works from a phone photo of a handwritten page, with no academy, tutor or fee. That matters most for candidates outside the big cities.
- **SDG 16, Strong Institutions:** a fairer start for a merit-based civil-service exam.
- **Industry:** CSS and PMS academies, universities and essay-based exams can give feedback in about a minute instead of days. Every run logs its Gemini usage, so the cost per essay is measured, not guessed.

Expected impact, not yet measured with students.

## How AI is used

The pipeline is "measure first, judge second, verify everything". AI is used where the task needs it; plain code checks every AI answer before it reaches the student.

| Step | What the AI does | What the code checks | Model |
|---|---|---|---|
| 1. Read | Transcribes the photos into paragraphs, outline, legibility and uncertain words | Schema check; uncertain words are shown with a dotted underline | `gemini-3.6-flash` (vision), 3 fallbacks |
| 2. Embed | Turns topic, paragraphs and sentences into 768-d vectors | One shared cache per request; max 95 texts per essay, the rest marked unassessed | `gemini-embedding-001` |
| 3. Measure (parallel) | Labels sentence roles; our logistic regression scores genericness; vectors measure topic drift and benchmark coverage | Rules link claims to evidence (cosine 0.82 strong / 0.76 weak), check rebuttals, convert similarity to 0-100 relevance | `gemini-3.6-flash` + trained classifier |
| 4. Examine | Two runs score 7 rubric dimensions and must quote the essay | Every quote must appear in the essay (ignoring case, spacing and quote style, max 25 words); band derived in code; run disagreement shown | `gemini-3.6-flash` ×2 |
| 5. Blend | none | Per-sentence colour rules, examiner-vs-measurement conflicts, score = 40% measured + 60% examiner (20/80 for language) | none |
| 6. Coach | Explains 3 fixes and rewrites the weakest paragraphs (up to 3, one model call each, in parallel) | Code picks the problems and the paragraphs, only ones with measured problems; checks quotes, length and numbers on every rewrite; template fallback for fixes; a failed extra rewrite is skipped with a note | `gemini-3.6-flash` |

If a measuring step fails (for example, the free quota runs out), the report still opens and says which checks were unavailable instead of guessing. A busy AI service returns 503 with `Retry-After`.

**Where the prompts are:** `lib/pipeline/steps.ts` (handwriting), `lib/structure/prompt.ts` (sentence roles), `lib/pipeline/examinerPrompt.ts` (examiner), `lib/pipeline/coachPrompt.ts` (coach). Tuned thresholds: `lib/config.ts` and `lib/pipeline/blendConfig.ts`.

**What one run costs:** every analysis logs the Gemini calls and tokens it used per model (`usageTotal` in the server log, and the "Gemini usage" table under `/new?debug=1` with `ALLOW_DEBUG=true` locally).

## What has been measured

Small tests, mostly on synthetic data. They show each part works as designed. **They do not show that the scores match FPSC examiners.**

| Check | Result | Data |
|---|---|---|
| Topic drift: off-topic paragraphs caught | 97.5% correct on 80 paragraphs (95% of off-topic caught, 100% on-topic kept) | Synthetic (`data/drift-eval.json`) |
| Genericness classifier | 100% on 110 held-out sentences; a smoke test, the data is too clean | Synthetic (`data/genericness-model.json`) |
| Benchmark checklist matching | AUC 0.91 at threshold 0.80, 40 paragraphs | Synthetic (`data/benchmark-eval.json`) |
| Examiner quotes not in the essay | 1 of 11 caught and removed, one test run | Test essay (`data/eval/examiner-metrics.json`) |
| Coach quotes not in the essay | 2 of 3 caught and replaced, one test run | Test essay (`data/eval/coach-metrics.json`) |
| End-to-end time | 46 s for 2 pages / 178 words, one recorded run | Test essay |

## Limitations

- Scores are **not calibrated** against real FPSC marks; the bands (70% and 50% of the scale) are starting points.
- Sentence roles come from one Gemini call plus rules; there is **no separately trained structure model**.
- The genericness model and the evaluations above use **synthetic, AI-written data**.
- The benchmark compares against an **AI-written checklist** of points per theme; no real top-scoring essays are used yet.
- The free Gemini tier allows only a few full analyses per day. Cached real runs are used for the demo and are labelled as saved runs.

## Data and privacy

- No accounts and no database. Photos go to Google's Gemini API to be read; the app does not store them. The finished report is saved only in the user's browser (localStorage).
- No student essays or photos are in this repository. Test fixtures are synthetic or typed test pages (`tests/fixtures/`). `data/cache/`, `data/reference-raw/` and `tests/assets/private/` are git-ignored.

## Disclosure of pre-existing work and tools

- **Design system:** colour tokens and base UI components were adapted from an earlier product by a team member (Verchek). Everything else was built during AICON'26.
- **Synthetic data:** the generic-sentence bank, the drift and genericness training and evaluation sets, and the benchmark checklists were generated with Gemini (`npm run build:data`, `npm run build:benchmark`).
- **AI coding assistant:** Claude Code was used while writing code, as the rules allow.
- **Third-party:** Next.js, React, Tailwind CSS, zod, sharp, Playwright, and the Google Gemini API.

## Run it

```bash
npm install
cp .env.example .env.local      # add GEMINI_API_KEY (server-only)
npm run dev                     # http://localhost:3000
```

Tests (no API key, no AI calls):

```bash
npm test             # unit tests
npm run test:e2e     # browser tests with saved fixtures (Chromium)
npx tsc --noEmit     # type check
```

One real end-to-end run, and how to save it as a demo report: [`docs/LOCAL-TEST.md`](docs/LOCAL-TEST.md).

## Testing instructions for judges

1. Open the live app and choose **See an example report** for the full report layout (sample data, labelled as such).
2. Open **How it works** for where AI is used and what the code checks.
3. To try a real analysis: **New essay**, type the topic, add 1 to 3 photos of a handwritten page, and wait about a minute. On the free tier the service can be busy; the page says so and keeps the photos for **Try again**.
