/**
 * Exploratory prompt-evaluation cases. NOT ground truth. Each sentence lists the labels a reasonable
 * reader could accept (null = leave unlabelled) and whether the case is genuinely ambiguous. The essay
 * is written independently of the strong/weak fixtures and of the prompt's own wording, to reduce overfitting.
 */
import type { ArgumentRole } from "./types.ts";

export interface PromptCase {
  prefix: string;
  /** Labels a reasonable annotator could accept. null = unlabelled / filler. */
  accept: (ArgumentRole | null)[];
  /** The kind of sentence being probed. */
  probe: "thesis" | "vague_assertion" | "normative_claim" | "factual_assertion" | "filler" | "evidence" | "counterclaim" | "rebuttal" | "conclusion" | "opinion";
  ambiguous: boolean;
  note: string;
}

export const CASES_TOPIC = "Should cities ban private cars from their centres?";

export const CASES_TEXT = `Cities should ban private cars from their centres. Traffic is a problem everywhere. The city council met on Tuesday.

Air quality improves when fewer engines run downtown. A 2019 study in Oslo recorded a 25 percent drop in nitrogen dioxide after a partial ban. Everyone loves a quiet street. Shopkeepers fear that banning cars will empty their stores. In fact, when Ghent pedestrianised its centre, retail turnover rose. The weather was pleasant last summer.

Citizens ought to care about the air their neighbours breathe. I think this is a good idea. In short, car-free centres make cities healthier and fairer.`;

export const PROMPT_CASES: PromptCase[] = [
  { prefix: "Cities should ban", accept: ["thesis"], probe: "thesis", ambiguous: false, note: "Clear central position." },
  { prefix: "Traffic is a problem", accept: ["claim", "premise"], probe: "vague_assertion", ambiguous: false, note: "Vague, unsupported, but argumentative; must not be skipped." },
  { prefix: "The city council met", accept: [null, "other"], probe: "filler", ambiguous: false, note: "Background that argues no point." },
  { prefix: "Air quality improves", accept: ["claim", "premise"], probe: "factual_assertion", ambiguous: false, note: "Unsourced factual assertion, not evidence." },
  { prefix: "A 2019 study", accept: ["evidence"], probe: "evidence", ambiguous: false, note: "Dated, quantified, sourced." },
  { prefix: "Everyone loves a quiet street", accept: ["claim", "premise", "other", null], probe: "vague_assertion", ambiguous: true, note: "Rhetorical generalisation: could be a weak premise or decoration." },
  { prefix: "Shopkeepers fear", accept: ["counterclaim"], probe: "counterclaim", ambiguous: false, note: "Reports an opposing view." },
  { prefix: "In fact, when Ghent", accept: ["rebuttal", "evidence"], probe: "rebuttal", ambiguous: true, note: "A concrete case that also answers the counterclaim: rebuttal and evidence are both defensible." },
  { prefix: "The weather was pleasant", accept: [null, "other"], probe: "filler", ambiguous: false, note: "Unrelated to the topic." },
  { prefix: "Citizens ought to care", accept: ["claim", "premise", "other"], probe: "normative_claim", ambiguous: true, note: "Vague moral assertion; reasonable people may call it a claim, a premise or padding." },
  { prefix: "I think this is a good idea", accept: ["claim", "other", null], probe: "opinion", ambiguous: true, note: "Bare personal stance with no content of its own." },
  { prefix: "In short", accept: ["conclusion"], probe: "conclusion", ambiguous: false, note: "Signals and performs a summing up." },
];
