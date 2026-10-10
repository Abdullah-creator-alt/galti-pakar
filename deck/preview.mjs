// Screenshots deck/preview/slideN.html to deck/preview/slideN.png (layout check).
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
for (let i = 1; i <= 5; i++) {
  await p.goto(pathToFileURL(path.resolve(`deck/preview/slide${i}.html`)).href);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `deck/preview/slide${i}.png` });
}
await b.close();
