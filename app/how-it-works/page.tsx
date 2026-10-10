import type { Metadata } from "next";
import { AppShell } from "@/components/Shells";
import { ButtonLink, Eyebrow, LIMITATION_TEXT, LimitationNote, SectionRule } from "@/components/ui";

export const metadata: Metadata = {
  title: "How it works · Galti Pakar",
  description: "Where AI is used in Galti Pakar, what the code checks, and what has been measured so far.",
};

/**
 * The judge-facing explanation of the AI. Every number here comes from a file in the repository (data/*-eval.json,
 * data/genericness-model.json, data/eval/*.json, lib/config.ts, lib/pipeline/blendConfig.ts). Keep it in step with them.
 */

const FLOW: [string, string][] = [
  ["Problem", "Candidates fail the CSS essay paper mostly on weak argument structure, and get little feedback before the exam."],
  ["Input", "Phone photos of a handwritten practice essay, plus the topic."],
  ["AI", "Vision reading, embeddings, a trained classifier and two examiner runs, each checked by code."],
  ["Output", "A marked-up essay, seven rubric scores, three ranked fixes and a before-and-after for each weak paragraph."],
  ["Impact", "Specific feedback in about a minute, instead of days of waiting for a tutor."],
];

interface Stage {
  title: string;
  ai: string;
  code: string;
  model: string;
}

// The real order of the pipeline (lib/pipeline/orchestrate.ts). Stage 3 runs its three checks at the same time.
const STAGES: Stage[] = [
  {
    title: "Read the handwriting",
    ai: "Gemini reads the photos in order and returns the essay as paragraphs, an outline if there is one, a legibility rating and the words it was unsure of.",
    code: "Shrinks photos on your phone, checks the answer against a schema, and marks every uncertain word with a dotted underline so you can see where the reading may be wrong.",
    model: "gemini-3.6-flash (vision), with three fallbacks",
  },
  {
    title: "Turn the essay into vectors",
    ai: "Gemini's embedding model turns the topic, each paragraph and each sentence into a 768-number vector that captures its meaning.",
    code: "Caps one essay at 95 embedded texts to stay inside the free quota. Sentences past the cap are shown as unassessed, never guessed.",
    model: "gemini-embedding-001",
  },
  {
    title: "Measure, three ways at once",
    ai: "Structure: Gemini labels each sentence's role (position, claim, evidence, counter-argument, rebuttal). Genericness: our own logistic-regression model scores how generic each sentence is. Topic drift: each paragraph's vector is compared with the topic.",
    code: "Rules link claims to evidence by meaning (similarity 0.82 for a strong link, 0.76 for a weak one), check that counter-arguments are answered, and turn similarity into a 0-100 relevance score.",
    model: "gemini-3.6-flash + a classifier trained in this project",
  },
  {
    title: "Ask for a second opinion",
    ai: "Two separate Gemini runs score the essay on seven CSS rubric dimensions. Each run must quote the essay to justify its scores.",
    code: "Checks every quote against the transcribed essay and drops any that are not there. Works out the band itself instead of trusting the model, and shows where the two runs disagree.",
    model: "gemini-3.6-flash, two runs",
  },
  {
    title: "Verify and blend",
    ai: "None. This step is plain code, so it can be explained line by line.",
    code: "Colours each sentence by fixed rules, records every place the examiner contradicts the measurements, and blends each score as 40% measured and 60% examiner (20/80 for language).",
    model: "No model",
  },
  {
    title: "Coach",
    ai: "Gemini explains the three most important fixes and rewrites up to three weak paragraphs, one call each.",
    code: "Code chooses which three problems and which paragraphs (only ones where a problem was measured), not the AI. It then checks the rewrite's length and quotes, and blocks invented facts: where a figure is needed it inserts a marked slot like [add a figure] instead.",
    model: "gemini-3.6-flash, with template fallbacks",
  },
];

interface Measure {
  what: string;
  result: string;
  data: string;
}

const MEASURES: Measure[] = [
  { what: "Topic drift: off-topic paragraphs caught", result: "97.5% correct on 80 paragraphs (95% of off-topic caught, 100% of on-topic kept)", data: "Synthetic" },
  { what: "Genericness classifier", result: "100% on 110 held-out sentences. A smoke test only: the data is too clean to prove real-world accuracy", data: "Synthetic" },
  { what: "Benchmark checklist matching", result: "AUC 0.91 at the chosen threshold, on 40 paragraphs", data: "Synthetic" },
  { what: "Examiner quotes that were not in the essay", result: "1 of 11 caught and removed, in one test run", data: "Test essay" },
  { what: "Coach quotes that were not in the essay", result: "2 of 3 caught and replaced, in one test run", data: "Test essay" },
  { what: "Time for one essay", result: "46 seconds end to end in one recorded run (2 pages, 178 words)", data: "Test essay" },
];

const LIMITS = [
  "Scores are not calibrated against real FPSC marks. The bands (70% and 50% of the scale) are starting points.",
  "Structure labels come from one Gemini call plus rules. There is no separately trained structure model.",
  "The genericness model and the evaluations above use synthetic, AI-written data. They show the parts work as designed, not that they match human examiners.",
  "The benchmark compares against an AI-written checklist of points per theme. No real top-scoring essays are used yet.",
  "On the free Gemini tier only a few essays can be analysed per day. When a check cannot run, the report says so instead of guessing.",
];

export default function HowItWorks() {
  return (
    <AppShell>
      <section className="border-b border-v-border" style={{ background: "var(--v-bg-field)" }}>
        <div className="mx-auto max-w-[1120px] px-4 pb-14 pt-16 sm:px-8 lg:pb-16 lg:pt-20">
          <Eyebrow>How it works</Eyebrow>
          <h1 className="mt-4 max-w-4xl text-[clamp(34px,4.4vw,56px)] font-extrabold leading-[1.08] text-v-text">Measure first, judge second, verify everything.</h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-v-text-secondary">
            AI reads the handwriting, measures the argument and gives a second opinion. Code checks each AI answer before it reaches you, and the report shows how every mark was found.
          </p>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-[14px] border border-v-border bg-v-border sm:grid-cols-5" aria-label="From problem to impact">
            {FLOW.map(([k, v]) => (
              <li key={k} className="bg-v-surface p-4">
                <p className="font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-accent-text">{k}</p>
                <p className="mt-1.5 text-[13.5px] leading-snug text-v-text-secondary">{v}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <main className="mx-auto max-w-[1120px] px-4 pb-24 pt-6 sm:px-8">
        <SectionRule title="The pipeline, in order" />
        <ol className="space-y-4">
          {STAGES.map((s, i) => (
            <li key={s.title} className="rounded-[14px] border border-v-border bg-v-card p-5 sm:p-6" style={{ boxShadow: "var(--v-elev-2)" }}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-[19px] font-bold leading-tight text-v-text">
                  <span className="mr-2 font-data text-[13px] text-v-accent-text">{i + 1}</span>
                  {s.title}
                </h2>
                <p className="font-data text-[11px] uppercase tracking-[0.08em] text-v-text-muted">{s.model}</p>
              </div>
              <dl className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-[10px] bg-v-accent-wash p-4">
                  <dt className="font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-accent-text">What the AI does</dt>
                  <dd className="mt-1.5 text-[14px] leading-relaxed text-v-text">{s.ai}</dd>
                </div>
                <div className="rounded-[10px] border border-v-border bg-v-surface p-4">
                  <dt className="font-data text-[10.5px] font-bold uppercase tracking-[0.14em] text-v-text-muted">What the code checks</dt>
                  <dd className="mt-1.5 text-[14px] leading-relaxed text-v-text-secondary">{s.code}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>

        <SectionRule title="What has been measured" />
        <p className="mb-4 max-w-3xl text-[15px] leading-relaxed text-v-text-secondary">These are small tests, mostly on synthetic data. They show each part does what it is meant to. They do not show that the scores match FPSC examiners.</p>
        {/* Rows rather than a table, so nothing is cut off or scrolls sideways on a phone. */}
        <ul className="divide-y divide-v-border rounded-[14px] border border-v-border bg-v-surface text-[14px]">
          {MEASURES.map((m) => (
            <li key={m.what} className="grid gap-1 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_7rem] md:gap-4">
              <p className="font-semibold text-v-text">{m.what}</p>
              <p className="text-v-text-secondary">{m.result}</p>
              <p className="font-data text-[11px] uppercase tracking-[0.08em] text-v-text-muted md:text-right">{m.data}</p>
            </li>
          ))}
        </ul>

        <SectionRule title="What it cannot do yet" />
        <ul className="max-w-3xl list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-v-text-secondary">
          {LIMITS.map((l) => <li key={l}>{l}</li>)}
        </ul>

        <SectionRule title="Your photos and data" />
        <p className="max-w-3xl text-[15px] leading-relaxed text-v-text-secondary">
          Photos are sent to Google&apos;s Gemini API to be read and analysed. Galti Pakar has no accounts and no database: it does not store your photos, and the finished report is saved only in your own browser. Upload your own practice essays, nothing private.
        </p>

        <div className="mt-12"><LimitationNote text={LIMITATION_TEXT} /></div>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/report/example" variant="secondary" arrow={false}>See an example report</ButtonLink>
          <ButtonLink href="/new">Upload an essay</ButtonLink>
        </div>
      </main>
    </AppShell>
  );
}
