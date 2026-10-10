# One real end-to-end run (local)

Purpose: prove the whole pipeline once with a real photo and the real AI, spending as little free-tier quota as possible. The automated tests never do this; they use saved fixtures.

**Do it once.** One run is roughly 5 text requests and about 60 to 95 embedded texts. Text models allow about 20 requests a day each and embeddings about 1,000 texts a day. Do not repeat it casually, and check `/api/health` first (see below). If embeddings are exhausted the report degrades honestly (no drift, genericness, benchmark or claim links) and says so; that is not a representative run, so wait for the quota to reset instead.

## Setup

1. `.env.local` in the project root (git-ignored):
   ```
   GEMINI_API_KEY=<your key>
   ALLOW_DEBUG=true
   ```
   `ALLOW_DEBUG=true` lets the stage-timing table come back. Never set it on Vercel.
2. `npm run dev`, then open **http://localhost:3000/new?debug=1** (the `?debug=1` flag only works in development; the report then shows a collapsible "Stages (development only)" table, kept in memory and gone after a reload).
3. Optional: open http://localhost:3000/api/health first to see the key and model status without spending anything meaningful.

## The photo

Use 1 to 3 pages of a real handwritten practice essay of your own (or a friend's, with permission). Do not commit it: keep it in `tests/assets/private/`, which is git-ignored. Flat, bright, in focus, JPEG or PNG.

## What to expect

- Upload page: pages appear with a size line "N KB after compression" (under 3.8 MB in total).
- `/analysing`: four steps; the last one stays in progress until the answer arrives.
- Time: about 40 to 70 seconds for a typical essay (about 42 s measured with the embedding quota exhausted; allow more with a slow connection). The page waits up to 115 s before giving up with "The analysis took too long".
- Then `/report/<id>`: scorecard, highlighted essay, drift chart, argument map, structure, top 3 fixes, before and after, AI examiner runs, benchmark, notes. The report is in `/history` and survives a reload.
- A 503 means the AI service is busy: wait the shown seconds and use Try again (the photos are kept).

## Manual checklist

- [ ] Handwriting was read correctly (compare the "Your essay" text with the page); uncertain words are marked with dotted underlines.
- [ ] Paragraph count and word count are about right.
- [ ] Every highlight opens a reason; red and amber ones show "How we found this", and "Show the linked passage" scrolls to and flashes the right sentence.
- [ ] Quotes in the examiner panel really appear in your essay (unverifiable ones are dropped, never shown).
- [ ] The three fixes point at real problems; the model paragraph keeps your meaning and its `[add a figure]` slots are clearly marked as slots.
- [ ] No section is empty or says "undefined" or "NaN". If something was skipped there is a grey "Some checks were unavailable" banner and the notes list says what.
- [ ] The Stages table: every stage `ok` (or a stated reason), total near the time you saw.
- [ ] Reload `/report/<id>`: it is still there. `/history` lists it.
- [ ] Dark mode and a phone-width window (390 px) look right.
- [ ] Nothing in the browser console in red.

## Keeping the run as a demo report

The report lives in the browser's localStorage under `galtipakar:v1:bundle:<id>`. In DevTools, Console (on the report page):

```js
copy(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("galtipakar:v1:bundle:"))))
```

Paste into a file such as `demo.json` (outside the repo or in `tests/assets/private/`), then:

```
npm run demo:add -- demo.json
```

This validates it with the app's own schemas, writes `public/demo-reports/<id>.json` and lists it in `public/demo-reports/index.json`. Check it opens at `/report/<id>` with the dev server stopped and the key removed.

Before committing a cached report, make sure it contains no real person's name or private essay text, and say in the demo that it is a saved real run, not a live one. Do not present synthetic or edited output as a real analysis.
