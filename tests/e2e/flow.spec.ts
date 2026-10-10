import sharp from "sharp";
import { assertClean, expect, fillUpload, hasHorizontalScroll, loadBundle, makeJpeg, mockAnalyze, parseMultipart, submitUpload, test } from "./helpers";
import type { Route } from "@playwright/test";

const SIZES: [number, number][] = [[900, 600], [800, 600], [700, 600]];
const photos = async () => Promise.all(SIZES.map(async ([w, h], i) => ({ name: `page-${i + 1}.jpg`, buffer: await makeJpeg(w, h, i) })));

test.describe("upload flow", () => {
  test("three photos, reorder, compressed upload, slow response, report saved and survives reload", async ({ page, problems }) => {
    const bundle = loadBundle("full");
    let captured: { ct: string; body: Buffer } | undefined;
    await mockAnalyze(page, {
      body: bundle,
      delayMs: 4000,
      onRequest: (r: Route) => {
        captured = { ct: r.request().headers()["content-type"], body: r.request().postDataBuffer()! };
      },
    });
    await fillUpload(page, await photos());
    // Reorder: move page 1 later, so the upload order is 2, 1, 3.
    await page.getByRole("button", { name: "Move page 1 later" }).click();
    await expect(page.getByText(/after compression/)).toBeVisible({ timeout: 30_000 });
    await submitUpload(page);

    // While the response is held the last step must not be marked done.
    await expect(page.getByRole("img", { name: "In progress" })).toBeVisible();
    await page.waitForURL(`**/report/${bundle.report.id}`, { timeout: 30_000 });
    await expect(page.locator("h1")).toHaveText(bundle.report.topic);

    // The multipart body: exactly "topic" and three "images", in the reordered order, under the size budget.
    expect(captured).toBeTruthy();
    const mp = parseMultipart(captured!.body, captured!.ct);
    expect(mp.fields).toEqual(["topic", "images", "images", "images"]);
    expect(mp.text.topic).toBe("Water scarcity in Pakistan");
    expect(captured!.body.length).toBeLessThan(3.8 * 1024 * 1024);
    const widths = await Promise.all(mp.files.map(async (f) => (await sharp(f.bytes).metadata()).width));
    expect(widths).toEqual([800, 900, 700]);

    // Listed in history and still there after a reload.
    await page.goto("/history");
    await expect(page.getByText(bundle.report.topic)).toBeVisible();
    await page.goto(`/report/${bundle.report.id}`);
    await page.reload();
    await expect(page.locator("h1")).toHaveText(bundle.report.topic);
    assertClean(problems);
  });

  test("the last step stays in progress until the response arrives (18 s hold)", async ({ page, problems }) => {
    test.setTimeout(120_000);
    const bundle = loadBundle("full");
    await mockAnalyze(page, { body: bundle, delayMs: 18_000 });
    await fillUpload(page, (await photos()).slice(0, 1));
    await submitUpload(page);
    await page.waitForTimeout(17_000);
    await expect(page.getByRole("img", { name: "In progress" })).toBeVisible();
    await expect(page).toHaveURL(/\/analysing/);
    await page.waitForURL(`**/report/${bundle.report.id}`, { timeout: 30_000 });
    assertClean(problems);
  });

  test("a report that cannot be saved says so", async ({ page, problems }) => {
    const bundle = loadBundle("full");
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("blocked", "QuotaExceededError");
      };
    });
    await mockAnalyze(page, { body: bundle });
    await fillUpload(page, (await photos()).slice(0, 1));
    await submitUpload(page);
    await page.waitForURL(`**/report/${bundle.report.id}`);
    await expect(page.getByText("This report can't be saved on this device.")).toBeVisible();
    await expect(page.locator("h1")).toHaveText(bundle.report.topic);
    assertClean(problems);
  });

  test("dev debug: ?debug=1 sends x-debug and shows the Stages table; without it neither", async ({ page, problems }) => {
    const bundle = loadBundle("real-degraded-debug");
    const headers: (string | undefined)[] = [];
    await mockAnalyze(page, { body: bundle, onRequest: (r) => void headers.push(r.request().headers()["x-debug"]) });
    await page.goto("/new?debug=1");
    await page.getByLabel("Essay topic").fill("Water scarcity in Pakistan");
    await page.locator('input[type="file"][multiple]').setInputFiles([{ name: "a.jpg", mimeType: "image/jpeg", buffer: (await photos())[0].buffer }]);
    await expect(page.getByText(/after compression/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Analyse my essay" }).click();
    await page.waitForURL(`**/report/${bundle.report.id}`);
    expect(headers.at(-1)).toBe("1");
    await expect(page.getByTestId("stages-panel")).toBeVisible();

    // Without the flag: no header, and a fresh page load has no debug data (kept in memory only).
    await fillUpload(page, (await photos()).slice(0, 1));
    await submitUpload(page);
    await page.waitForURL(`**/report/${bundle.report.id}`);
    expect(headers.at(-1)).toBeUndefined();
    await page.reload();
    await expect(page.getByTestId("stages-panel")).toHaveCount(0);
    assertClean(problems);
  });
});

test.describe("errors on the processing page", () => {
  const cases: { name: string; opts: Parameters<typeof mockAnalyze>[1]; text: RegExp; disabled?: boolean }[] = [
    { name: "413", opts: { status: 413, body: {} }, text: /Too many or too large photos/ },
    { name: "422 with the server message", opts: { status: 422, body: { error: { message: "No essay text could be found in these photos." } } }, text: /No essay text could be found/ },
    { name: "503 with Retry-After", opts: { status: 503, headers: { "Retry-After": "30" }, body: {} }, text: /AI service is busy/, disabled: true },
    { name: "504", opts: { status: 504, body: {} }, text: /took too long/ },
    { name: "network abort", opts: { abort: true }, text: /could not reach the server/ },
  ];
  for (const c of cases) {
    test(`${c.name} shows a friendly message and the photos are kept`, async ({ page, problems }) => {
      await mockAnalyze(page, c.opts);
      await fillUpload(page, (await photos()).slice(0, 1));
      await submitUpload(page);
      await expect(page.getByRole("alert").filter({ hasText: c.text })).toBeVisible({ timeout: 20_000 });
      const retry = page.getByRole("button", { name: /Try again/ });
      if (c.disabled) {
        await expect(retry).toBeDisabled();
        await expect(retry).toHaveText(/Try again in \d+s/);
      } else {
        await expect(retry).toBeEnabled();
      }
      expect(await hasHorizontalScroll(page)).toBe(false);
      await page.getByRole("link", { name: "Open a sample analysis instead" }).click();
      await page.waitForURL("**/report/example");
      await expect(page.locator("h1")).toBeVisible();
      // The browser logs a failed fetch / non-2xx as a console error on its own; only page errors must stay empty.
      expect(problems.page).toEqual([]);
      expect(problems.unexpectedRequests).toEqual([]);
    });
  }

  test("Try again resubmits the same files", async ({ page, problems }) => {
    const bundle = loadBundle("full");
    const bodies: Buffer[] = [];
    let n = 0;
    await page.route("**/api/analyze", async (route) => {
      bodies.push(route.request().postDataBuffer()!);
      n += 1;
      if (n === 1) return route.fulfill({ status: 504, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bundle) });
    });
    await fillUpload(page, await photos());
    await submitUpload(page);
    await page.getByRole("button", { name: "Try again" }).click({ timeout: 20_000 });
    await page.waitForURL(`**/report/${bundle.report.id}`);
    expect(bodies).toHaveLength(2);
    const [a, b] = bodies.map((x, i) => parseMultipart(x, "multipart/form-data; boundary=" + /^--(.+)\r\n/.exec(x.toString("latin1", 0, 200))![1]));
    expect(a.fields).toEqual(b.fields);
    expect(a.files.map((f) => f.bytes.length)).toEqual(b.files.map((f) => f.bytes.length));
    expect(problems.page).toEqual([]);
  });
});
