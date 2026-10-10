import test from "node:test";
import assert from "node:assert/strict";
import { MAX_BUNDLES, STORAGE_PREFIX, createStorage, type StorageBackend } from "./storage.ts";
import { mockBundle } from "./mock-extras.ts";
import type { AnalysisBundle } from "./types.extras.ts";

class FakeStorage implements StorageBackend {
  data = new Map<string, string>();
  /** Bytes allowed before setItem throws a quota error; Infinity for none. */
  quota = Infinity;
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => {
    const used = [...this.data].filter(([key]) => key !== k).reduce((n, [, val]) => n + val.length, 0);
    if (used + v.length > this.quota) throw new DOMException("quota", "QuotaExceededError");
    this.data.set(k, v);
  };
  removeItem = (k: string) => void this.data.delete(k);
}

function bundle(id: string, day = 1): AnalysisBundle {
  return { report: { ...mockBundle.report, id, analysedAt: `2026-10-${String(day).padStart(2, "0")}T09:00:00.000Z`, isExample: false } };
}

test("save, read back, list newest first, delete", () => {
  const fs = new FakeStorage();
  const s = createStorage({ backend: () => fs });
  assert.deepEqual(s.saveBundle(bundle("a", 1)), { persisted: true });
  s.saveBundle(bundle("b", 3));
  s.saveBundle(bundle("c", 2));
  assert.equal(s.getBundle("a")?.source, "storage");
  assert.equal(s.getBundle("a")?.bundle.report.id, "a");
  assert.deepEqual(s.listHistory().map((h) => h.id), ["b", "c", "a"], "newest first by analysis date");
  assert.equal(s.getBundle("zzz"), null);
  s.deleteBundle("c");
  assert.deepEqual(s.listHistory().map((h) => h.id), ["b", "a"]);
  assert.equal(s.getBundle("c"), null);
  assert.ok([...fs.data.keys()].every((k) => k.startsWith(STORAGE_PREFIX)), "all keys carry the version prefix");
});

test("extras survive a round trip, and re-saving the same id replaces it", () => {
  const fs = new FakeStorage();
  const s = createStorage({ backend: () => fs });
  s.saveBundle({ ...mockBundle, report: { ...mockBundle.report, id: "x", isExample: false } });
  const back = s.getBundle("x")!.bundle;
  assert.ok(back.extras?.claimMap && back.extras.trace && back.extras.benchmark);
  s.saveBundle(bundle("x", 5));
  assert.equal(s.listHistory().length, 1);
  assert.equal(s.getBundle("x")!.bundle.extras, undefined);
});

test("keeps at most 20 bundles and drops the oldest", () => {
  const fs = new FakeStorage();
  const s = createStorage({ backend: () => fs });
  for (let i = 0; i < MAX_BUNDLES + 3; i++) s.saveBundle(bundle(`r${i}`, 1 + (i % 28)));
  const ids = s.listHistory().map((h) => h.id);
  assert.equal(ids.length, MAX_BUNDLES);
  assert.ok(!ids.includes("r0") && !ids.includes("r1") && !ids.includes("r2"), "the first three saved are gone");
  assert.equal([...fs.data.keys()].filter((k) => k.includes("bundle:")).length, MAX_BUNDLES, "dropped bundles are also removed from storage");
  assert.ok(ids.includes(`r${MAX_BUNDLES + 2}`));
});

test("quota error: older bundles are dropped to make room, and the new one is saved", () => {
  const fs = new FakeStorage();
  const s = createStorage({ backend: () => fs });
  s.saveBundle(bundle("old1", 1));
  s.saveBundle(bundle("old2", 2));
  const size = fs.data.get(`${STORAGE_PREFIX}bundle:old1`)!.length;
  fs.quota = size * 2 + 800; // room for about two bundles plus the index
  const r = s.saveBundle(bundle("new", 9));
  assert.equal(r.persisted, true);
  assert.equal(s.getBundle("new")?.source, "storage");
  assert.equal(fs.data.has(`${STORAGE_PREFIX}bundle:old1`), false, "the oldest was sacrificed from storage");
  assert.equal(s.getBundle("old1")?.source, "memory", "but this tab still has it for the session");
});

test("quota error with nothing left to drop falls back to memory for the session", () => {
  const fs = new FakeStorage();
  fs.quota = 10; // nothing fits
  const s = createStorage({ backend: () => fs });
  const r = s.saveBundle(bundle("big", 1));
  assert.deepEqual(r, { persisted: false });
  assert.equal(s.getBundle("big")?.source, "memory");
  assert.deepEqual(s.listHistory().map((h) => h.id), ["big"], "it still shows in history this session");
  assert.equal([...fs.data.keys()].filter((k) => k.includes("bundle:")).length, 0, "no half-written bundle is left behind");
});

test("corrupt JSON and outdated shapes are ignored, never thrown", () => {
  const fs = new FakeStorage();
  const s = createStorage({ backend: () => fs });
  s.saveBundle(bundle("good", 1));
  fs.data.set(`${STORAGE_PREFIX}bundle:bad`, "{not json");
  fs.data.set(`${STORAGE_PREFIX}bundle:old`, JSON.stringify({ report: { id: "old", topic: "x" } }));
  assert.equal(s.getBundle("bad"), null);
  assert.equal(s.getBundle("old"), null);
  assert.equal(fs.data.has(`${STORAGE_PREFIX}bundle:bad`), false, "a corrupt entry is forgotten");
  assert.equal(s.getBundle("good")?.bundle.report.id, "good");

  fs.data.set(`${STORAGE_PREFIX}index`, "][ not json");
  assert.deepEqual(s.listHistory().map((h) => h.id), ["good"], "a corrupt index reads as empty; only this tab's own saves remain");
  fs.data.set(`${STORAGE_PREFIX}index`, JSON.stringify([{ id: 5 }, null, "x", { id: "ok", topic: "t", analysedAt: "2026-10-01T00:00:00.000Z", overallScore: 5, overallOutOf: 10, verdict: "borderline", isExample: false }]));
  assert.deepEqual(s.listHistory().map((h) => h.id), ["good", "ok"], "bad index entries are filtered out");
  assert.doesNotThrow(() => s.saveBundle(bundle("after", 2)));
  assert.equal(s.getBundle("after")?.source, "storage");
});

test("private mode: a backend that throws (or is absent) falls back to memory without errors", () => {
  const throwing = createStorage({ backend: () => { throw new DOMException("denied", "SecurityError"); } });
  assert.deepEqual(throwing.saveBundle(bundle("p", 1)), { persisted: false });
  assert.equal(throwing.getBundle("p")?.source, "memory");
  assert.equal(throwing.isAvailable(), false);
  assert.doesNotThrow(() => throwing.deleteBundle("p"));
  assert.equal(throwing.getBundle("p"), null);

  const absent = createStorage({ backend: () => null });
  assert.deepEqual(absent.saveBundle(bundle("q", 1)), { persisted: false });
  assert.deepEqual(absent.listHistory().map((h) => h.id), ["q"]);
  assert.doesNotThrow(() => absent.clearAll());
  assert.deepEqual(absent.listHistory(), []);

  const readOnly: StorageBackend = { getItem: () => null, setItem: () => { throw new Error("read only"); }, removeItem: () => { throw new Error("read only"); } };
  const ro = createStorage({ backend: () => readOnly });
  assert.deepEqual(ro.saveBundle(bundle("r", 1)), { persisted: false });
  assert.equal(ro.getBundle("r")?.source, "memory");

  const server = createStorage(); // no backend at all, as on the server render
  assert.equal(server.getBundle("nothing"), null);
  assert.deepEqual(server.listHistory(), []);
});

test("clearAll removes every stored bundle and the index", () => {
  const fs = new FakeStorage();
  const s = createStorage({ backend: () => fs });
  s.saveBundle(bundle("a", 1));
  s.saveBundle(bundle("b", 2));
  s.clearAll();
  assert.deepEqual(s.listHistory(), []);
  assert.equal(fs.data.size, 0);
});

test("uploaded images are never stored: only the report JSON", () => {
  const fs = new FakeStorage();
  const s = createStorage({ backend: () => fs });
  s.saveBundle(bundle("img", 1));
  for (const v of fs.data.values()) assert.ok(!/data:image|base64,/.test(v));
});
