/** Small, dependency-free text helpers for rule-based linking: content stems and discourse cues. */

const STOPWORDS = new Set(
  ("a an the and or but nor so yet of in on at to for from by with without into onto over under about as is are was were be been being am do does did done have has had having " +
    "it its this that these those there here which who whom whose what when where why how not no than then too very can could may might must shall should will would also just " +
    "i we you he she they them their our your his her my me us one some any all each many much more most other such only own same both few").split(" "),
);

/** Crude suffix stripper: enough to match school/schools/schooling and invest/investment. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  for (const suffix of ["ments", "ment", "ations", "ation", "ings", "ing", "ies", "ied", "ed", "ly", "es", "s"]) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      if (suffix === "ies" || suffix === "ied") w += "y";
      break;
    }
  }
  return w;
}

export function contentStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    out.add(stem(w));
  }
  return out;
}

/** |A ∩ B| / min(|A|, |B|), 0 when either set is empty. */
export function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / Math.min(a.size, b.size);
}

export type CueFunction = "example" | "reason" | "result" | "contrast" | "concession" | "conclusion";

interface CueRule {
  fn: CueFunction;
  label: string;
  re: RegExp;
}

/**
 * Lexicon of discourse cues. A cue is a hint about the *sentence it appears in*, not a proof of a relation;
 * link.ts decides what a cue means in context (for example, "however" supports a rebuttal link but counts
 * against a support link). Patterns avoid common false positives such as temporal "since 1947".
 */
const CUES: CueRule[] = [
  { fn: "example", label: "for example", re: /\bfor (?:example|instance)\b|\be\.g\.|\bsuch as\b|\bto illustrate\b|\bconsider (?:the case|how)\b/i },
  { fn: "example", label: "according to", re: /\baccording to\b|\b(?:a|the) (?:study|survey|report|census) (?:by|from|of|shows?|found)\b|\bstatistics (?:show|indicate|reveal)\b|\bevidence shows?\b/i },
  { fn: "reason", label: "because", re: /\bbecause\b|\bsince (?!\d{4}\b)|\bdue to\b|\bowing to\b|\bgiven that\b|\bas a result of\b|\bthe reason (?:is|being)\b/i },
  { fn: "result", label: "therefore", re: /\btherefore\b|\bthus\b|\bhence\b|\bconsequently\b|\bas a result\b|\bit follows that\b|\baccordingly\b/i },
  { fn: "contrast", label: "however", re: /\bhowever\b|\bnevertheless\b|\bnonetheless\b|\bon the other hand\b|\bin contrast\b|\bdespite\b|\bin spite of\b|\balthough\b|\bwhereas\b|(?:^|[.;,]\s*)(?:but|yet)\b/i },
  { fn: "concession", label: "some argue", re: /\b(?:some|many|critics|opponents|sceptics|skeptics|others)\b[^.!?]{0,40}\b(?:argue|claim|say|believe|contend|maintain|suggest|assert)\b|\bit is (?:often |sometimes )?(?:argued|said|claimed|believed)\b|\bone might (?:argue|say|object)\b/i },
  { fn: "conclusion", label: "in conclusion", re: /\bin conclusion\b|\bto conclude\b|\bin summary\b|\bto sum up\b|\bin short\b|\boverall\b|\ball in all\b/i },
];

export interface CueMatch {
  fn: CueFunction;
  label: string;
}

export function findCues(sentence: string): CueMatch[] {
  const seen = new Set<CueFunction>();
  const out: CueMatch[] = [];
  for (const rule of CUES) {
    if (!seen.has(rule.fn) && rule.re.test(sentence)) {
      seen.add(rule.fn);
      out.push({ fn: rule.fn, label: rule.label });
    }
  }
  return out;
}

export function hasCue(sentence: string, fn: CueFunction): CueMatch | undefined {
  return findCues(sentence).find((c) => c.fn === fn);
}
