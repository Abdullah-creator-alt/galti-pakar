/** Test helpers: build documents and canned model responses without any live API call. */
import { buildLinks } from "./link.ts";
import { normalizeEssay, type NormalizedEssay } from "./normalize.ts";
import type { CompleteFn } from "./extract.ts";
import type { ArgumentElement, ArgumentRole } from "./types.ts";

export const ESSAY_A = [
  "Education is the foundation of national progress. Pakistan must therefore invest more in public schooling.",
  "Investment in schools raises literacy. For example, Kerala's literacy programme lifted enrolment sharply. Some critics argue that public budgets are too limited. However, targeted spending on primary schools is affordable and repays itself in higher productivity.",
  "In conclusion, Pakistan should fund education first.",
].join("\n\n");

export interface ElementSpec {
  s: string | string[];
  role: ArgumentRole;
  conf?: number;
  alt?: ArgumentRole;
}

export const rawElements = (specs: ElementSpec[]) =>
  specs.map((x) => ({ sentenceIds: Array.isArray(x.s) ? x.s : [x.s], role: x.role, confidence: x.conf ?? 0.9, ...(x.alt ? { alternativeRole: x.alt } : {}) }));

export const mockComplete = (specs: ElementSpec[]): CompleteFn => async () => JSON.stringify({ elements: rawElements(specs) });

export const ESSAY_A_SPECS: ElementSpec[] = [
  { s: "s1", role: "premise", conf: 0.8 },
  { s: "s2", role: "thesis" },
  { s: "s3", role: "claim", conf: 0.85 },
  { s: "s4", role: "evidence" },
  { s: "s5", role: "counterclaim", conf: 0.8 },
  { s: "s6", role: "rebuttal", conf: 0.85 },
  { s: "s7", role: "conclusion" },
];

/** Builds elements directly from sentence ids, bypassing the model. Ids e1.. follow the spec order. */
export function buildDoc(text: string, specs: ElementSpec[]): { essay: NormalizedEssay; elements: ArgumentElement[] } {
  const essay = normalizeEssay(text);
  const byId = new Map(essay.sentences.map((s) => [s.id, s]));
  const elements = specs.map((x, i): ArgumentElement => {
    const ids = Array.isArray(x.s) ? x.s : [x.s];
    const first = byId.get(ids[0])!;
    const last = byId.get(ids[ids.length - 1])!;
    return {
      id: `e${i + 1}`,
      role: x.role,
      sentenceIds: ids,
      paragraphId: first.paragraphId,
      text: text.slice(first.start, last.end),
      start: first.start,
      end: last.end,
      modelConfidence: x.conf ?? 0.9,
      ...(x.alt ? { alternativeRole: x.alt } : {}),
    };
  });
  return { essay, elements };
}

export function linksFor(text: string, specs: ElementSpec[]) {
  const { essay, elements } = buildDoc(text, specs);
  return { essay, elements, links: buildLinks({ sentences: essay.sentences, elements }) };
}
