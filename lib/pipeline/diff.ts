import { COACH } from "../config.ts";

interface Tok {
  text: string;
  start: number;
  end: number;
}

/** Words and single punctuation marks, so "Pakistan" and "Pakistan," differ only by the comma. */
const tokenize = (s: string): Tok[] => [...s.matchAll(/[\w’'-]+|[^\s\w]/g)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));

/** Phrases made of consecutive unmatched words. Each is an exact substring of `source`. */
function runs(toks: Tok[], matched: boolean[], source: string): { phrase: string; start: number }[] {
  const out: { phrase: string; start: number }[] = [];
  let i = 0;
  while (i < toks.length) {
    if (matched[i]) { i++; continue; }
    let j = i;
    while (j + 1 < toks.length && !matched[j + 1]) j++;
    out.push({ phrase: source.slice(toks[i].start, toks[j].end), start: toks[i].start });
    i = j + 1;
  }
  return out;
}

/** The `max` longest phrases, back in reading order. */
function cap(items: { phrase: string; start: number }[], max: number): string[] {
  return [...items].sort((a, b) => b.phrase.length - a.phrase.length).slice(0, max).sort((a, b) => a.start - b.start).map((x) => x.phrase);
}

/**
 * Word-level diff by longest common subsequence. `removed` phrases are exact substrings of the original and
 * `added` phrases are exact substrings of the improved text. Computed in code; the model never supplies them.
 */
export function wordDiff(original: string, improved: string, max: number = COACH.MAX_DIFF_PHRASES): { removed: string[]; added: string[] } {
  const a = tokenize(original);
  const b = tokenize(improved);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].text === b[j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ma = new Array<boolean>(n).fill(false);
  const mb = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].text === b[j].text) { ma[i++] = true; mb[j++] = true; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { removed: cap(runs(a, ma, original), max), added: cap(runs(b, mb, improved), max) };
}
