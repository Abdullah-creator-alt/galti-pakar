// Captures real screenshots of the example report for the deck. Needs the app running on http://localhost:3000.
// Run: node deck/capture.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = "deck/img";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
await ctx.addInitScript(() => localStorage.setItem("gp-theme", "light"));
const page = await ctx.newPage();
await page.goto("http://localhost:3000/report/example");
await page.waitForTimeout(1500);

// 1. The marked-up essay with the "how we found this" panel open on a red passage.
await page.locator("#span-p2-523-588").scrollIntoViewIfNeeded();
await page.locator("#span-p2-523-588").click();
await page.waitForTimeout(500);
const p2 = await page.locator("#p2").boundingBox();
const panel = await page.getByRole("complementary", { name: "Why this passage was marked" }).boundingBox();
const sy = await page.evaluate(() => window.scrollY);
const top = p2.y + sy - 20;
await page.screenshot({ path: `${out}/essay-trace.png`, clip: { x: p2.x - 40, y: top, width: panel.x + panel.width - p2.x + 60, height: Math.min(560, panel.y + sy + panel.height - top + 20) }, fullPage: true });

// 2. Scorecard.
await page.locator("ul.grid").filter({ hasText: "Thesis" }).first().screenshot({ path: `${out}/scorecard.png` });

// 3. Before and after.
await page.locator("div.grid").filter({ hasText: "Your paragraph" }).filter({ hasText: "A stronger version" }).first().screenshot({ path: `${out}/before-after.png` });

// 4. The report header with the verdict.
await page.locator("header").nth(1).screenshot({ path: `${out}/header.png` }).catch(() => undefined);

await browser.close();
console.log("saved to", out);
