"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, ButtonLink, Eyebrow, StateIcon } from "@/components/ui";
import { clearSubmission, getSubmission, startAnalysis } from "@/lib/client/analysisStore";
import { setDebug } from "@/lib/client/debugStore";
import { saveBundle } from "@/lib/storage";

const STEPS = [
  { title: "Reading the handwriting", active: "Turning your photos into text and noting words that are hard to read", done: "Handwriting read" },
  { title: "Checking structure and evidence", active: "Finding your position, claims and the evidence behind each one", done: "Structure checked" },
  { title: "Measuring drift and genericness", active: "Comparing each paragraph with the topic and looking for generic wording", done: "Measurements done" },
  { title: "Writing the verified feedback", active: "Scoring, checking every quote against your essay, and writing your fixes", done: "Feedback written" },
];

/**
 * Elapsed time at which each step becomes the active one. They are an estimate for a job of about 15 to 25 seconds;
 * the last step stays active until the report actually arrives, so nothing is ever shown as done early.
 */
const STEP_STARTS_MS = [0, 5000, 10500, 16000];
const stepAt = (ms: number) => STEP_STARTS_MS.reduce((acc, t, i) => (ms >= t ? i : acc), 0);
const FAST_FORWARD_MS = 350;

type Phase = "running" | "finishing" | "failed";
interface Failure {
  message: string;
  kind: string;
  atStep: number;
  retryAfterSec?: number;
}

/** Development only: ?debug=1 asks the server for its stage table (it answers only when ALLOW_DEBUG is on). */
const DEV = process.env.NODE_ENV !== "production";

export function Processing() {
  const router = useRouter();
  const params = useSearchParams();
  const failAt = Number(params.get("fail") ?? 0); // dev switch: simulate a failure at this step on the first attempt
  // Read the store after mount: it does not exist during the server render, and a mismatch would break hydration.
  const [topic, setTopic] = useState<string | null>(params.get("topic"));
  useEffect(() => setTopic(getSubmission()?.topic ?? params.get("topic")), [params]);

  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>("running");
  const [elapsed, setElapsed] = useState(0);
  const [finish, setFinish] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [cooldown, setCooldown] = useState(0); // seconds Try again stays disabled after a 503 with Retry-After
  const debugOn = params.get("debug") === "1";
  const startRef = useRef(Date.now());
  const target = useRef<string | null>(null);
  const simulate = failAt > 0 && attempt === 0;

  // The request. startAnalysis shares one in-flight promise, so a second effect run never double-submits.
  useEffect(() => {
    let alive = true;
    startRef.current = Date.now();
    setElapsed(0);
    setFinish(0);
    setFailure(null);
    setPhase("running");
    if (simulate) return;
    startAnalysis({ force: attempt > 0, debug: DEV && debugOn }).then((r) => {
      if (!alive) return;
      if (r.ok) {
        saveBundle(r.bundle);
        if (DEV && r.debug) setDebug(r.bundle.report.id, r.debug); // memory only, never storage
        target.current = `/report/${encodeURIComponent(r.bundle.report.id)}`;
        setFinish(Math.max(stepAt(Date.now() - startRef.current), 0));
        setPhase("finishing");
      } else {
        setFailure({ message: r.message, kind: r.kind, atStep: stepAt(Date.now() - startRef.current), retryAfterSec: r.retryAfterSec });
        setCooldown(r.retryAfterSec ?? 0);
        setPhase("failed");
      }
    });
    return () => {
      alive = false;
    };
  }, [attempt, simulate]);

  // The clock behind the paced steps (and the failure simulation).
  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => {
      const ms = Date.now() - startRef.current;
      setElapsed(ms);
      if (simulate && stepAt(ms) + 1 >= failAt) {
        setFailure({ message: `Simulated failure at step ${failAt} (the ?fail=${failAt} dev switch). Your photos were not lost.`, kind: "simulated", atStep: failAt - 1 });
        setPhase("failed");
      }
    }, 250);
    return () => clearInterval(id);
  }, [phase, simulate, failAt]);

  // Count the cooldown down once a second.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // The report has arrived: fast-forward the remaining steps, then open it.
  useEffect(() => {
    if (phase !== "finishing") return;
    const id = setInterval(() => setFinish((f) => f + 1), FAST_FORWARD_MS);
    return () => clearInterval(id);
  }, [phase]);
  useEffect(() => {
    if (phase === "finishing" && finish > STEPS.length && target.current) {
      clearSubmission();
      router.push(target.current);
    }
  }, [phase, finish, router]);

  const current = phase === "finishing" ? Math.min(finish, STEPS.length) : phase === "failed" ? (failure?.atStep ?? 0) : stepAt(elapsed);
  const noPhotos = failure?.kind === "no-photos";
  const seconds = Math.round(elapsed / 1000);

  return (
    <div>
      <div className="text-center">
        <Eyebrow>Analysing</Eyebrow>
        <h1 className="mt-3 text-[clamp(26px,5vw,34px)] font-extrabold leading-[1.1] text-v-text">Reading your essay</h1>
        {topic && <p className="mt-2 text-[15px] text-v-text-secondary">{topic}</p>}
      </div>

      <ol aria-live="polite" className="mt-8 rounded-[18px] border border-v-border bg-v-card p-6" style={{ boxShadow: "var(--v-elev-2)" }}>
        {STEPS.map((s, i) => {
          const status = phase === "failed" && i === current ? "failed" : i < current ? "done" : i === current ? "active" : "pending";
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
                {(status === "active" || status === "failed") && <p className="mt-1 text-[14px] leading-snug text-v-text-secondary">{s.active}</p>}
                {status === "done" && <p className="mt-1 font-data text-[11px] uppercase tracking-[0.1em] text-v-text-muted">{s.done}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {phase === "failed" && failure ? (
        <div role="alert" className="mt-6 rounded-[12px] border border-v-flag bg-v-flag-wash p-4">
          <p className="text-sm font-semibold text-v-flag-text">{failure.message}</p>
          {!noPhotos && <p className="mt-1 text-sm leading-snug text-v-flag-text">Your photos are still here. You can try again without adding them again.</p>}
          <div className="mt-3 flex flex-wrap gap-3">
            {noPhotos ? <ButtonLink href="/new" arrow={false}>Add photos again</ButtonLink> : <Button variant="primary" disabled={cooldown > 0} onClick={() => setAttempt((a) => a + 1)}>{cooldown > 0 ? `Try again in ${cooldown}s` : "Try again"}</Button>}
            <ButtonLink href="/report/example" variant="secondary" arrow={false}>Open a sample analysis instead</ButtonLink>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-6 text-center text-[13.5px] text-v-text-muted">
            {seconds > 40 ? "Still working: this one is taking longer than usual. Keep this page open." : "This usually takes 15 to 25 seconds. Keep this page open."}
          </p>
          <p className="mt-1 text-center text-[12.5px] text-v-text-muted">The steps follow an estimated timeline; the last one stays active until your report arrives.</p>
        </>
      )}
      {phase !== "failed" && (
        <p className="mt-4 text-center">
          <Link href="/new" className="inline-flex min-h-[44px] items-center text-[13px] text-v-text-muted underline underline-offset-4">Cancel and start again</Link>
        </p>
      )}
    </div>
  );
}
