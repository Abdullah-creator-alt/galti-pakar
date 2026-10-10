/**
 * Client-side data access. Resolution order for a report id:
 *   "example"            -> the built-in example bundle
 *   this device          -> localStorage (or the in-memory fallback)
 *   /demo-reports/<id>.json -> a cached sample shipped with the site
 * Pages that call this must be client components with a loading and a not-found state.
 */
import { mockBundle } from "./mock-extras.ts";
import * as store from "./storage.ts";
import { parseBundle, type AnalysisBundle } from "./types.extras.ts";
import type { EssayReport, HistoryItem } from "./types.ts";

export type BundleSource = "example" | "storage" | "memory" | "demo";
export interface LoadedBundle {
  bundle: AnalysisBundle;
  source: BundleSource;
}

export interface DemoLink {
  id: string;
  title: string;
}

const SAFE_ID = /^[\w-]{1,80}$/;

export async function getBundle(id: string): Promise<LoadedBundle | null> {
  if (id === "example") return { bundle: mockBundle, source: "example" };
  const local = store.getBundle(id);
  if (local) return { bundle: local.bundle, source: local.source };
  if (!SAFE_ID.test(id)) return null;
  try {
    const res = await fetch(`/demo-reports/${id}.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const parsed = parseBundle(await res.json());
    return parsed.ok ? { bundle: parsed.bundle, source: "demo" } : null;
  } catch {
    return null;
  }
}

export async function getReport(id: string): Promise<EssayReport | null> {
  return (await getBundle(id))?.bundle.report ?? null;
}

/** Real history from this device, newest first. */
export async function getHistory(): Promise<HistoryItem[]> {
  return store.listHistory();
}

/** Sample analyses listed in public/demo-reports/index.json (empty when there are none). */
export async function getDemoLinks(): Promise<DemoLink[]> {
  try {
    const res = await fetch("/demo-reports/index.json", { cache: "no-store" });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    if (!Array.isArray(json)) return [];
    return json.flatMap((x) => {
      const o = x as { id?: unknown; title?: unknown };
      return typeof o?.id === "string" && SAFE_ID.test(o.id) ? [{ id: o.id, title: typeof o.title === "string" && o.title ? o.title.slice(0, 120) : o.id }] : [];
    });
  } catch {
    return [];
  }
}
