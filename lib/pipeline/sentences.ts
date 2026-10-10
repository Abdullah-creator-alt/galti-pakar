export interface SentenceSpan {
  start: number;
  end: number;
  text: string;
}

/** Tokens ending in a period that do not end a sentence. Lowercase, without the period. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "etc", "viz", "cf", "no", "nos", "fig", "approx",
  "gen", "col", "lt", "capt", "sen", "rep", "gov", "hon", "rs", "est", "dept", "govt", "inc", "ltd", "co", "ca",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

function precedingToken(text: string, periodIdx: number): string {
  let i = periodIdx - 1;
  while (i >= 0 && !/\s/.test(text[i])) i--;
  return text.slice(i + 1, periodIdx);
}

function isAbbreviation(token: string): boolean {
  const bare = token.replace(/^[("'‘“]+/, "");
  if (/^([A-Za-z]\.)*[A-Za-z]$/.test(bare) && (bare.includes(".") || bare.length === 1)) return true; // U.S, e.g, i.e, single initial
  return ABBREVIATIONS.has(bare.toLowerCase());
}

/**
 * Splits text into sentences, returning exact [start, end) offsets so that
 * text.slice(start, end) is the sentence. Handles Mr./Dr./U.S./e.g. and decimals.
 */
export function splitSentences(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  let start = 0;
  const push = (s: number, e: number) => {
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) out.push({ start: s, end: e, text: text.slice(s, e) });
  };

  const re = /[.!?]+["')\]’”]*(?=\s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const periodIdx = m.index; // first terminator char
    const after = m.index + m[0].length;
    const isDot = text[periodIdx] === "." && !/[!?]/.test(m[0]);
    // What follows must look like the start of a new sentence.
    const rest = text.slice(after).match(/^\s+(\S)/);
    if (!rest) continue;
    const next = rest[1];
    if (!/[A-Z0-9"'(\[‘“]/.test(next)) continue;
    if (isDot && m[0] === "." && isAbbreviation(precedingToken(text, periodIdx))) continue;
    push(start, after);
    start = after;
  }
  push(start, text.length);
  return out;
}

export function countTextWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
