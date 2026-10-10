"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Eyebrow, StateIcon } from "@/components/ui";

const STEPS = [
  { title: "Reading handwriting", active: "Turning your photo into text", done: "Handwriting read" },
  { title: "Checking structure", active: "Finding your position, claims and evidence", done: "Structure mapped" },
  { title: "Scoring against the rubric", active: "Seven dimensions, scored by several examiners", done: "Scoring complete" },
  { title: "Preparing your report", active: "Placing highlights and ranking fixes", done: "Report ready" },
];

/** Prototype timing. Replace the timers with real step events from the backend. */
const STEP_MS = 2200;

export function Processing() {
  const router = useRouter();
  const params = useSearchParams();
  const topic = params.get("topic");
  // ?fail=2 demonstrates the failure state on step 2.
  const failAt = Number(params.get("fail") ?? 0);
  const [current, setCurrent] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (failed) return;
    if (current >= STEPS.length) {
      const t = setTimeout(() => router.push("/report/example"), 600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      if (failAt && current + 1 === failAt && attempt === 0) setFailed(true);
      else setCurrent((c) => c + 1);
    }, STEP_MS);
    return () => clearTimeout(t);
  }, [current, failed, failAt, attempt, router]);

  function retry() {
    setAttempt((a) => a + 1);
    setFailed(false);
  }

  return (
    <div>
      <div className="text-center">
        <Eyebrow>Analysing</Eyebrow>
        <h1 className="mt-3 text-[clamp(26px,5vw,34px)] font-extrabold leading-[1.1] text-v-text">Reading your essay</h1>
        {topic && <p className="mt-2 text-[15px] text-v-text-secondary">{topic}</p>}
      </div>

      <ol
        aria-live="polite"
        className="mt-8 rounded-[18px] border border-v-border bg-v-card p-6"
        style={{ boxShadow: "var(--v-elev-2)" }}
      >
        {STEPS.map((s, i) => {
          const status = failed && i === current ? "failed" : i < current ? "done" : i === current ? "active" : "pending";
          return (
            <li key={s.title} className="relative flex gap-4 pb-6 last:pb-0">
              {i < STEPS.length - 1 && <span className="absolute left-[13px] top-8 h-[calc(100%-2rem)] w-px bg-v-border" aria-hidden />}
              <span className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-v-card">
                {status === "done" && <StateIcon state="ok" size={26} />}
                {status === "pending" && <StateIcon state="absent" size={26} />}
                {status === "failed" && <StateIcon state="partial" size={26} />}
                {status === "active" && (
                  <span className="v-pulse grid h-[26px] w-[26px] place-items-center rounded-full border-2 border-v-accent" aria-label="In progress" role="img">
                    <span className="h-2 w-2 rounded-full bg-v-accent" />
                  </span>
                )}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className={`text-[16px] font-bold leading-tight ${status === "pending" ? "text-v-text-muted" : "text-v-text"}`}>{s.title}</p>
                {(status === "active" || status === "failed") && (
                  <p className="mt-1 text-[14px] leading-snug text-v-text-secondary">{s.active}</p>
                )}
                {status === "done" && <p className="mt-1 font-data text-[11px] uppercase tracking-[0.1em] text-v-text-muted">{s.done}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {failed ? (
        <div role="alert" className="mt-6 rounded-[12px] border border-v-flag bg-v-flag-wash p-4">
          <p className="text-sm font-semibold text-v-flag-text">
            We could not finish &ldquo;{STEPS[current].title.toLowerCase()}&rdquo;.
          </p>
          <p className="mt-1 text-sm leading-snug text-v-flag-text">Your photos are still saved. Try again; if it fails twice, retake the page in better light.</p>
          <Button variant="primary" onClick={retry} className="mt-3">
            Try again
          </Button>
        </div>
      ) : (
        <p className="mt-6 text-center text-[13.5px] text-v-text-muted">This usually takes about 15 seconds. Keep this page open.</p>
      )}
      <p className="mt-2 text-center text-[12.5px] text-v-text-muted">Prototype: steps are simulated and the report shown is an example.</p>
    </div>
  );
}
