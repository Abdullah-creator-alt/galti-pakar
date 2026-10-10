# Reference essays (raw, never committed)

Put reference essays here as `.txt` files. **Everything in this folder except this README is git-ignored.
Never commit full essay texts.** Only paraphrased key points and numbers reach `data/benchmark.json`.

## Format

Each file starts with front matter between `---` lines, then the essay text:

```
---
title: Climate change and Pakistan's economy
topic: Climate change and Pakistan's economic future
theme: climate-water
source: https://example.org/essay   (or: self-written: Your Name)
permission: own
quality_basis: self-written
---
Essay text starts here...
```

## Fields (all required)

| Field | Allowed values |
|---|---|
| `title` | free text |
| `topic` | the essay topic |
| `theme` | a key from `data/themes.json`: governance, economy, climate-water, education, security-extremism, society-gender, foreign-policy |
| `source` | a URL, or `self-written: <name>` |
| `permission` | `own`, `permission-granted`, `openly-licensed:<licence>`, or `public-domain` |
| `quality_basis` | `qualifier-model`, `academy-sample`, `op-ed-proxy`, `self-written`, or `other` |

Files missing `permission` or `quality_basis` are refused by `npm run validate:reference`.

## Workflow

1. `npm run validate:reference` checks the files and prints counts per theme and quality basis.
2. `npm run build:benchmark` extracts key points (one Gemini call per essay, cached) and writes `data/benchmark.json`.
3. `npm run eval:benchmark` checks coverage separation and recommends a threshold.

Aim for at least 3 essays per theme (8 or more for the comparison to stop being labelled "indicative only").
