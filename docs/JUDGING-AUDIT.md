# Judging audit (10 Oct 2026)

Checked against `rules of hackthon/BUILD WITH AI - RuleBook.pdf`: the five judging criteria, the required project structure (Problem → Data/Input → AI Component → Solution/Output → Impact), the "Expected final project" list, submission requirements, disclosure, and data/privacy rules. The domain judge gives 85% of the score, so EdTech relevance matters most.

## Verdict: is the AI meaningful?

**Yes.** The product cannot exist without AI: handwriting has to be read by a vision model, and argument quality needs meaning (embeddings), not keywords. It is not a chatbot on an app. Six AI uses, each checked by code:

1. Vision transcription of handwritten pages (with uncertain words surfaced to the student).
2. Embeddings for topic drift, claim-to-evidence links and benchmark coverage.
3. A logistic-regression genericness classifier **trained in this project**.
4. LLM sentence-role labelling (position, claim, evidence, counter-argument, rebuttal).
5. Two separate LLM examiner runs whose quotes are verified against the essay, with disagreement shown.
6. An LLM coach whose choice of problems is made by code, with invented figures blocked.

The distinctive part to stress: **"measure first, judge second, verify everything."** The LLM's opinion is cross-checked against measurements, and every highlight opens its reason and the chain of evidence behind it.

## Criterion by criterion

| Criterion | Before this pass | Now | Still to do |
|---|---|---|---|
| AI Integration Depth | Strong pipeline, but judges could only see it by reading code | `/how-it-works` page in the app, README pipeline table, prompts located, per-run token usage measured | Real live progress on the processing page (see below) |
| Problem-Solving Quality | Problem stated without numbers | README cites CSS 2025: 354 of 12,792 passed (2.77%); FPSC: most fail Essay for weak argument structure | Say in the pitch why structure (our X-Ray) targets exactly that |
| Demo & Presentation | Working app; risk of quota running out live | Example report labelled; `docs/LOCAL-TEST.md` to cache a real run | **Deploy, run one real essay, cache it with `npm run demo:add`, rehearse** |
| Creativity & SDG Impact | Not written down | README: SDG 4 (quality education), 10 (reduced inequalities: free, phone-only, outside academies) | Put SDG 4/10/16 on one slide |
| Industrial Impact | No cost/efficiency figure | Each run now logs calls and tokens per model | After one real run, put tokens per essay × current Gemini price on a slide; adopters: CSS/PMS academies, universities, provincial exams |

## Rulebook requirements

| Requirement | Status |
|---|---|
| Clearly defined problem, AI solution, working MVP | Done |
| Measurable or clearly defined impact | Partly: time per essay (46 s, one run), token usage now measured. No user study. Be honest that impact is expected, not yet measured on students |
| GitHub link with working access | Done (`Abdullah-creator-alt/galti-pakar`) |
| Deployed link accessible | **Not confirmed here. Deploy to Vercel and add the URL to the README** |
| Testing instructions | Done (README, "Testing instructions for judges") |
| Disclose pre-existing code, datasets, models | Done (README: Verchek design system, synthetic data, Claude Code, third-party libraries) |
| Acknowledge external resources | Done (README) |
| Data privacy, responsible AI | Fixed: upload page and `/how-it-works` now say photos go to Google's Gemini API; no student data in the repo |
| No falsified results or demos | Kept: example is labelled; degraded checks are stated; evaluations marked synthetic. Do not present the example report as a real run |
| Explain what you personally built during AICON'26 | **Team to prepare**: who built which part |

## Fixed in this pass

- Per-run Gemini usage (calls, failures, input/output tokens, embedded texts) per model, request-scoped, in the server log and the dev Stages table. 4 unit tests.
- `/how-it-works`: the pipeline in order with "what the AI does" and "what the code checks" for each step, models, measured results with data type, limits, privacy. Linked from the header, the home hero and the report.
- `README.md`: problem with sources, Problem → Input → AI → Output → Impact, AI table, prompts, evaluation, limitations, privacy, disclosure, run and test instructions.
- Honesty: "several AI examiners" changed to "two separate AI examiner runs"; "every passage is marked" softened; "pick a past CSS topic" made neutral (unverified); processing steps re-paced to the recorded run timings.
- Privacy: upload copy no longer says photos are "sent only to analyse this essay" without naming Google.
- Report: the Structure section no longer repeats the role name as its summary when nothing else was measured.

## Recommended next (in order, if time allows)

1. **Deploy and cache a real run** (30 min). Without it the demo depends on the free quota at the moment of judging.
2. **Live progress on the processing page** (about 1 hour). Stream stage events from `runPipeline` (it already records each stage) as NDJSON and drive the four steps from them. The steps are timed estimates today.
3. **A tiny real evaluation** (1 to 2 hours). Two or three real practice essays marked by a teacher, compared with our bands. Even n=3 is more convincing than synthetic AUCs, if presented honestly.
4. Calibrate thresholds with `npm run tune-links` on 20 hand-labelled claim/evidence pairs.

## Likely judge questions and short answers

- **Which models?** Gemini 3.6 Flash for vision, structure, examiner and coach (three fallbacks); `gemini-embedding-001` (768-d); and our own logistic regression on 8 features.
- **What data?** 50 essay topics in 7 themes; Gemini-generated synthetic sentences for training and evaluation, labelled as synthetic; no real student essays stored.
- **How do you stop hallucination?** Quotes must appear in the essay or they are dropped; highlights must match the text; the band is computed in code; figures in the rewrite become `[add a figure]` slots; disagreements are shown, not hidden.
- **Why not just ask ChatGPT?** A single LLM answer gives an unverifiable opinion. Here measurements and two runs are cross-checked, and every mark links to the exact passage and the rule that produced it.
- **How accurate is it?** Honest answer: component tests on synthetic data are strong (drift 97.5%, benchmark AUC 0.91); the overall score is not yet calibrated against real FPSC marks.
- **What does one essay cost?** Read it from the "Gemini usage" table of a real run and multiply by the current price list. On the free tier it costs the candidate nothing.
