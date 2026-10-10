/**
 * Client-side storage for analysis bundles. Defensive by design: every read and write is wrapped, a failing store
 * falls back to memory for the session, and uploaded images are never stored (only the report JSON).
 * `createStorage` takes a backend so it can be tested without a browser.
 */
import { parseBundle, type AnalysisBundle } from "./types.extras.ts";
import type { HistoryItem } from "./types.ts";

export const STORAGE_PREFIX = "galtipakar:v1:";
export const MAX_BUNDLES = 20;

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveResult {
  /** False when the bundle only lives in memory for this session. */
  persisted: boolean;
}

export interface BundleLookup {
  bundle: AnalysisBundle;
  source: "storage" | "memory";
}

const INDEX_KEY = `${STORAGE_PREFIX}index`;
const bundleKey = (id: string) => `${STORAGE_PREFIX}bundle:${id}`;

export function historyItemOf(bundle: AnalysisBundle): HistoryItem {
  const r = bundle.report;
  return { id: r.id, topic: r.topic, analysedAt: r.analysedAt, overallScore: r.overallScore, overallOutOf: r.overallOutOf, verdict: r.verdict, isExample: r.isExample };
}

function isHistoryItem(x: unknown): x is HistoryItem {
  const o = x as HistoryItem;
  return !!o && typeof o.id === "string" && typeof o.topic === "string" && typeof o.analysedAt === "string" && typeof o.overallScore === "number" && typeof o.overallOutOf === "number" && typeof o.verdict === "string" && typeof o.isExample === "boolean";
}

export function createStorage(opts: { backend?: () => StorageBackend | null; max?: number } = {}) {
  const max = opts.max ?? MAX_BUNDLES;
  const memory = new Map<string, AnalysisBundle>();
  let memoryOrder: HistoryItem[] = [];

  /** Resolved on every call: the backend can throw (private mode) or be absent (server render). */
  const backend = (): StorageBackend | null => {
    try {
      return opts.backend ? opts.backend() : null;
    } catch {
      return null;
    }
  };

  function readIndex(): HistoryItem[] {
    const b = backend();
    if (!b) return [];
    try {
      const raw = b.getItem(INDEX_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isHistoryItem) : [];
    } catch {
      return [];
    }
  }

  function writeIndex(items: HistoryItem[]): boolean {
    const b = backend();
    if (!b) return false;
    try {
      b.setItem(INDEX_KEY, JSON.stringify(items));
      return true;
    } catch {
      return false;
    }
  }

  function removeFromStorage(id: string) {
    try {
      backend()?.removeItem(bundleKey(id));
    } catch {
      /* nothing to do */
    }
  }

  function saveBundle(bundle: AnalysisBundle): SaveResult {
    const item = historyItemOf(bundle);
    memory.set(item.id, bundle);
    memoryOrder = [item, ...memoryOrder.filter((x) => x.id !== item.id)].slice(0, max);
    for (const id of [...memory.keys()]) if (!memoryOrder.some((x) => x.id === id)) memory.delete(id);

    const b = backend();
    if (!b) return { persisted: false };
    let json: string;
    try {
      json = JSON.stringify(bundle);
    } catch {
      return { persisted: false };
    }

    // Newest first; keep at most `max`, dropping the oldest.
    let index = [item, ...readIndex().filter((x) => x.id !== item.id)];
    const dropped = index.slice(max);
    index = index.slice(0, max);
    for (const d of dropped) removeFromStorage(d.id);

    // On a quota error, drop the oldest other bundle and try again, until it fits or nothing is left to drop.
    for (;;) {
      try {
        b.setItem(bundleKey(item.id), json);
        break;
      } catch {
        const victim = index.slice(1).pop();
        if (!victim) return { persisted: false };
        removeFromStorage(victim.id);
        index = index.filter((x) => x.id !== victim.id);
      }
    }
    if (!writeIndex(index)) {
      removeFromStorage(item.id);
      return { persisted: false };
    }
    return { persisted: true };
  }

  function getBundle(id: string): BundleLookup | null {
    const b = backend();
    if (b) {
      try {
        const raw = b.getItem(bundleKey(id));
        if (raw) {
          let json: unknown;
          try {
            json = JSON.parse(raw);
          } catch {
            json = undefined; // corrupt JSON
          }
          const parsed = parseBundle(json);
          if (parsed.ok) return { bundle: parsed.bundle, source: "storage" };
          removeFromStorage(id); // corrupt or outdated: forget it
        }
      } catch {
        /* blocked storage: fall through to memory */
      }
    }
    const m = memory.get(id);
    return m ? { bundle: m, source: "memory" } : null;
  }

  function listHistory(): HistoryItem[] {
    const stored = readIndex();
    const seen = new Set(stored.map((x) => x.id));
    const extra = memoryOrder.filter((x) => !seen.has(x.id));
    return [...extra, ...stored].sort((a, b) => b.analysedAt.localeCompare(a.analysedAt));
  }

  function deleteBundle(id: string) {
    memory.delete(id);
    memoryOrder = memoryOrder.filter((x) => x.id !== id);
    removeFromStorage(id);
    const index = readIndex().filter((x) => x.id !== id);
    writeIndex(index);
  }

  function clearAll() {
    memory.clear();
    memoryOrder = [];
    for (const item of readIndex()) removeFromStorage(item.id);
    try {
      backend()?.removeItem(INDEX_KEY);
    } catch {
      /* nothing to do */
    }
  }

  /** True when a real store is reachable (it can still fill up). */
  function isAvailable(): boolean {
    const b = backend();
    if (!b) return false;
    try {
      const k = `${STORAGE_PREFIX}probe`;
      b.setItem(k, "1");
      b.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  return { saveBundle, getBundle, listHistory, deleteBundle, clearAll, isAvailable };
}

/** The browser's localStorage, or null on the server or when access throws (private mode, blocked cookies). */
function browserBackend(): StorageBackend | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

const shared = createStorage({ backend: browserBackend });

export const saveBundle = shared.saveBundle;
export const getBundle = shared.getBundle;
export const listHistory = shared.listHistory;
export const deleteBundle = shared.deleteBundle;
export const clearAll = shared.clearAll;
export const isStorageAvailable = shared.isAvailable;
