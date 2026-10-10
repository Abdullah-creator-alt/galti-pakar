import { expect, test as base, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

/** The fixture manifest written by scripts/make-test-bundles.ts. */
export interface FixtureInfo {
  name: string;
  valid: boolean;
  note: string;
}
const dir = path.join(process.cwd(), "tests", "fixtures", "bundles");
export const manifest: FixtureInfo[] = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8"));
export const validFixtures = manifest.filter((m) => m.valid).map((m) => m.name);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Bundle = { report: any; extras?: any; debug?: any };
export const loadBundle = (name: string): Bundle => JSON.parse(readFileSync(path.join(dir, `${name}.json`), "utf8"));

/** Console messages that are expected noise in development and do not indicate a defect. */
const IGNORED = [/Download the React DevTools/i, /favicon/i, /\[Fast Refresh\]/i, /\[HMR\]/i];

export interface Problems {
  console: string[];
  page: string[];
  unexpectedRequests: string[];
}

/**
 * Every test gets: console and page-error capture, and a guard that fails the test if the app tries to reach the AI
 * service or calls /api/analyze without the test having mocked it.
 */
export const test = base.extend<{ problems: Problems }>({
  problems: [
    async ({ page }, use) => {
      const problems: Problems = { console: [], page: [], unexpectedRequests: [] };
      page.on("console", (m) => {
        if ((m.type() === "error" || m.type() === "warning") && !IGNORED.some((re) => re.test(m.text()))) problems.console.push(`${m.type()}: ${m.text()}`);
      });
      page.on("pageerror", (e) => problems.page.push(e.message));
      await page.route(/generativelanguage\.googleapis\.com/, (r) => {
        problems.unexpectedRequests.push(`AI request: ${r.request().url()}`);
        return r.abort();
      });
      // Default for /api/analyze: a test that forgets to mock it fails loudly instead of calling the backend.
      await page.route("**/api/analyze", (r) => {
        problems.unexpectedRequests.push("unmocked /api/analyze");
        return r.fulfill({ status: 599, body: "unmocked" });
      });
      await use(problems);
    },
    { auto: true },
  ],
});
export { expect };

/** Replaces the default /api/analyze guard with a mocked response. */
export async function mockAnalyze(
  page: Page,
  opts: { status?: number; body?: unknown; delayMs?: number; headers?: Record<string, string>; abort?: boolean; onRequest?: (route: Route) => void } = {},
) {
  await page.route("**/api/analyze", async (route) => {
    opts.onRequest?.(route);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.abort) return route.abort("failed");
    return route.fulfill({ status: opts.status ?? 200, contentType: "application/json", headers: opts.headers, body: JSON.stringify(opts.body ?? {}) });
  });
}

/** Sets the theme before the first paint, the way the site's own toggle does. */
export async function setTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("gp-theme", t);
    } catch {
      /* storage may be blocked in a test */
    }
  }, theme);
}

/** Puts a bundle into localStorage under the app's own keys, so /report/<id> opens without going through upload. */
export async function seedBundle(page: Page, bundle: Bundle) {
  const r = bundle.report;
  const item = { id: r.id, topic: r.topic, analysedAt: r.analysedAt, overallScore: r.overallScore, overallOutOf: r.overallOutOf, verdict: r.verdict, isExample: r.isExample };
  const payload = JSON.stringify({ report: r, ...(bundle.extras ? { extras: bundle.extras } : {}) });
  await page.addInitScript(
    ([id, json, itemJson]) => {
      try {
        localStorage.setItem(`galtipakar:v1:bundle:${id}`, json);
        localStorage.setItem("galtipakar:v1:index", `[${itemJson}]`);
      } catch {
        /* ignored */
      }
    },
    [r.id, payload, JSON.stringify(item)],
  );
}

/** A JPEG with noise (so it does not compress to nothing) at an exact size. Generated in code; no real photos are used. */
export async function makeJpeg(width: number, height: number, seed = 1): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 120 + seed * 20, g: 110, b: 100 }, noise: { type: "gaussian", mean: 128, sigma: 40 } } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** Extracts the field names and file parts from a raw multipart body. */
export function parseMultipart(buf: Buffer, contentType: string): { fields: string[]; files: { name: string; bytes: Buffer }[]; text: Record<string, string> } {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) throw new Error("not multipart");
  const parts = buf.toString("latin1").split(`--${boundary}`).slice(1, -1);
  const fields: string[] = [];
  const files: { name: string; bytes: Buffer }[] = [];
  const text: Record<string, string> = {};
  for (const p of parts) {
    const headEnd = p.indexOf("\r\n\r\n");
    const head = p.slice(0, headEnd);
    const name = /name="([^"]+)"/.exec(head)?.[1] ?? "";
    const body = p.slice(headEnd + 4, p.length - 2);
    fields.push(name);
    if (/filename=/.test(head)) files.push({ name, bytes: Buffer.from(body, "latin1") });
    else text[name] = Buffer.from(body, "latin1").toString("utf8");
  }
  return { fields, files, text };
}

/** Picks photos on /new, fills the topic and waits for compression, ready to submit. */
export async function fillUpload(page: Page, jpegs: { name: string; buffer: Buffer }[], topic = "Water scarcity in Pakistan") {
  await page.goto("/new");
  await page.getByLabel("Essay topic").fill(topic);
  await page.locator('input[type="file"][multiple]').setInputFiles(jpegs.map((j) => ({ name: j.name, mimeType: "image/jpeg", buffer: j.buffer })));
  await expect(page.getByText(/after compression/)).toBeVisible({ timeout: 30_000 });
}

export async function submitUpload(page: Page) {
  const submit = page.getByRole("button", { name: "Analyse my essay" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await page.waitForURL("**/analysing");
}

/** After a test, fail on any console error, page error or request the test did not mock. */
export function assertClean(problems: Problems) {
  expect(problems.unexpectedRequests, "requests the test did not mock").toEqual([]);
  expect(problems.page, "uncaught page errors").toEqual([]);
  expect(problems.console, "console errors and warnings").toEqual([]);
}

/** True when the page scrolls sideways. */
export const hasHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
