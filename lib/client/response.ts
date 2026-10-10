/**
 * Turns whatever /api/analyze returned into an AnalysisBundle or a plain-language error. Accepts both
 * { report, extras } and a bare EssayReport, and a missing report id is replaced with a generated one.
 */
import { parseBundle, type AnalysisBundle } from "../types.extras.ts";
import { parseDebug, type DebugInfo } from "./status.ts";

export type ParsedResponse = { ok: true; bundle: AnalysisBundle; debug?: DebugInfo } | { ok: false; message: string; detail?: string };

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

export const UNEXPECTED_FORMAT = "The analysis came back in a format we could not read. Please try again.";

/** The API's { error: { message } }, when present and a string. */
export function apiErrorMessage(json: unknown): string | null {
  if (!isObject(json) || !isObject(json.error)) return null;
  const m = json.error.message;
  return typeof m === "string" && m.trim() ? m.trim().slice(0, 400) : null;
}

export function makeId(now: number = Date.now(), rand: number = Math.random()): string {
  return `an-${now.toString(36)}${Math.floor(rand * 1296).toString(36).padStart(2, "0")}`;
}

export function parseAnalyzeResponse(json: unknown, newId: () => string = makeId): ParsedResponse {
  const err = apiErrorMessage(json);
  if (err) return { ok: false, message: err };
  if (!isObject(json)) return { ok: false, message: UNEXPECTED_FORMAT, detail: "response is not an object" };

  let report: unknown;
  let extras: unknown;
  if (isObject(json.report)) {
    report = json.report;
    extras = json.extras;
  } else if (Array.isArray(json.paragraphs)) {
    report = json; // a bare EssayReport
  } else {
    return { ok: false, message: UNEXPECTED_FORMAT, detail: "neither a bundle nor a report" };
  }

  const r = report as Record<string, unknown>;
  const withId = typeof r.id === "string" && r.id.trim() ? report : { ...r, id: newId() };
  const parsed = parseBundle({ report: withId, extras });
  const debug = parseDebug(json.debug);
  return parsed.ok ? { ok: true, bundle: parsed.bundle, ...(debug ? { debug } : {}) } : { ok: false, message: UNEXPECTED_FORMAT, detail: parsed.error };
}
