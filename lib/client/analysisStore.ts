/**
 * Module-level store for the analysis the user just submitted. It lives outside React and the router so the photos and
 * the in-flight request survive the navigation from /new to /analysing (and a double effect run in dev). Images are held
 * in memory only for the duration of the session; they are never written to storage.
 */
import { apiErrorMessage, parseAnalyzeResponse } from "./response.ts";
import type { AnalysisBundle } from "../types.extras.ts";

export interface Submission {
  topic: string;
  files: File[];
}

export type AnalyzeFailureKind = "timeout" | "network" | "api" | "unreadable" | "no-photos";
export type AnalyzeOutcome = { ok: true; bundle: AnalysisBundle } | { ok: false; kind: AnalyzeFailureKind; message: string };

export const ANALYZE_TIMEOUT_MS = 90_000;

let pending: Submission | null = null;
let inflight: Promise<AnalyzeOutcome> | null = null;
let result: AnalyzeOutcome | null = null;

export function setSubmission(s: Submission): void {
  pending = s;
  inflight = null;
  result = null;
}
export const getSubmission = (): Submission | null => pending;
export const getResult = (): AnalyzeOutcome | null => result;
export function clearSubmission(): void {
  pending = null;
  inflight = null;
  result = null;
}

function failureFor(status: number, apiMessage: string | null): { kind: AnalyzeFailureKind; message: string } {
  if (apiMessage) return { kind: "api", message: apiMessage };
  if (status === 413) return { kind: "api", message: "The photos were too large to send together. Please use fewer pages and try again." };
  if (status === 504 || status === 408) return { kind: "timeout", message: "The analysis took too long. Please try again." };
  return { kind: "api", message: "Something went wrong while analysing your essay. Your photos are still here; please try again." };
}

/**
 * Sends the stored photos and topic to /api/analyze. Calling it again while a request is running returns the same
 * promise (so a re-render or a second effect never double-submits); pass `force` to start a fresh attempt (Try again).
 */
export function startAnalysis(opts: { force?: boolean; fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<AnalyzeOutcome> {
  if (inflight && !opts.force) return inflight;
  const sub = pending;
  if (!sub || sub.files.length === 0) {
    return Promise.resolve({ ok: false, kind: "no-photos", message: "Your photos are no longer in this tab. Please add them again." });
  }
  const doFetch = opts.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? ANALYZE_TIMEOUT_MS);
  const form = new FormData();
  form.append("topic", sub.topic);
  sub.files.forEach((f) => form.append("images", f, f.name));

  const run = (async (): Promise<AnalyzeOutcome> => {
    try {
      const res = await doFetch("/api/analyze", { method: "POST", body: form, signal: controller.signal });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        /* not JSON (for example a platform error page) */
      }
      if (!res.ok) {
        return { ok: false, ...failureFor(res.status, apiErrorMessage(json)) };
      }
      const parsed = parseAnalyzeResponse(json);
      return parsed.ok ? { ok: true, bundle: parsed.bundle } : { ok: false, kind: "unreadable", message: parsed.message };
    } catch {
      if (controller.signal.aborted) return { ok: false, kind: "timeout", message: "The analysis took longer than 90 seconds. Please try again." };
      return { ok: false, kind: "network", message: "We could not reach the server. Check your connection and try again." };
    } finally {
      clearTimeout(timer);
    }
  })();

  inflight = run;
  run.then((r) => {
    if (inflight === run) result = r;
  });
  return run;
}
