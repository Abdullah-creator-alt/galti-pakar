/**
 * Module-level store for the analysis the user just submitted. It lives outside React and the router so the photos and
 * the in-flight request survive the navigation from /new to /analysing (and a double effect run in dev). Images are held
 * in memory only for the duration of the session; they are never written to storage.
 */
import { apiErrorMessage, parseAnalyzeResponse } from "./response.ts";
import type { DebugInfo } from "./status.ts";
import type { AnalysisBundle } from "../types.extras.ts";

export interface Submission {
  topic: string;
  files: File[];
}

export type AnalyzeFailureKind = "timeout" | "network" | "api" | "unreadable" | "no-photos";
export type AnalyzeOutcome =
  | { ok: true; bundle: AnalysisBundle; debug?: DebugInfo }
  | { ok: false; kind: AnalyzeFailureKind; message: string; status?: number; retryAfterSec?: number };

/** The server allows about 100 to 120 seconds, so wait a little longer than its own deadline. */
export const ANALYZE_TIMEOUT_MS = 115_000;

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

/** Friendly wording per status, used when the API sent no message of its own. A message from the API wins. */
export const FRIENDLY: Record<number, string> = {
  413: "Too many or too large photos. Please use fewer pages or retake them at a lower resolution.",
  422: "We couldn't read an essay from these photos. Try a brighter, flatter photo.",
  503: "The AI service is busy. Please try again in about a minute.",
  504: "The analysis took too long. Please try again.",
};

/** Seconds from a Retry-After header (a plain number of seconds), or undefined. Capped at 10 minutes. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value.trim());
  return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 600) : undefined;
}

export function failureFor(status: number, apiMessage: string | null, retryAfter?: string | null): Extract<AnalyzeOutcome, { ok: false }> {
  const kind: AnalyzeFailureKind = status === 504 || status === 408 ? "timeout" : "api";
  const message = apiMessage ?? FRIENDLY[status] ?? "Something went wrong while analysing your essay. Your photos are still here; please try again.";
  const retryAfterSec = status === 503 ? parseRetryAfter(retryAfter) : undefined;
  return { ok: false, kind, message, status, ...(retryAfterSec ? { retryAfterSec } : {}) };
}

/**
 * Sends the stored photos and topic to /api/analyze. Calling it again while a request is running returns the same
 * promise (so a re-render or a second effect never double-submits); pass `force` to start a fresh attempt (Try again).
 * `debug` adds the x-debug header (the server only answers it when ALLOW_DEBUG is on); use it in development only.
 */
export function startAnalysis(opts: { force?: boolean; fetchFn?: typeof fetch; timeoutMs?: number; debug?: boolean } = {}): Promise<AnalyzeOutcome> {
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
      const res = await doFetch("/api/analyze", { method: "POST", body: form, signal: controller.signal, ...(opts.debug ? { headers: { "x-debug": "1" } } : {}) });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        /* not JSON (for example a platform error page) */
      }
      if (!res.ok) return failureFor(res.status, apiErrorMessage(json), res.headers.get("retry-after"));
      const parsed = parseAnalyzeResponse(json);
      return parsed.ok ? { ok: true, bundle: parsed.bundle, ...(parsed.debug ? { debug: parsed.debug } : {}) } : { ok: false, kind: "unreadable", message: parsed.message };
    } catch {
      if (controller.signal.aborted) return { ok: false, kind: "timeout", message: FRIENDLY[504] };
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
