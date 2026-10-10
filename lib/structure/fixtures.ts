/**
 * Two hand-written practice essays with hand-assigned sentence roles. The roles are the author's own
 * labels, used as a regression baseline and as the reference for comparing a live model run. They are
 * NOT a validated gold standard: two essays, one labeller.
 */
import { normalizeEssay } from "./normalize.ts";
import type { ArgumentRole } from "./types.ts";

export type LabelRow = [sentencePrefix: string, role: ArgumentRole, confidence: number];

export interface FixtureEssay {
  id: string;
  text: string;
  labels: LabelRow[];
}

export const STRONG_ESSAY: FixtureEssay = {
  id: "strong",
  text: `Water scarcity is the most pressing threat to Pakistan's economic future, and the state must treat it as a national security issue.

Pakistan is already a water-stressed country. According to the World Bank, per capita water availability has fallen from 5,000 cubic metres in 1951 to roughly 1,000 today. Because agriculture consumes over 90 percent of this water, the shortage directly threatens food security. For example, the 2022 floods and the droughts that followed showed how quickly crop yields can collapse.

Some critics argue that water storage is too expensive and that Pakistan cannot afford new dams. However, the cost of inaction is higher. The Indus Basin Authority estimates that the country loses billions of rupees every year to floods and unused river flow. Moreover, the Diamer-Bhasha dam shows that large projects can be financed with international partners.

In conclusion, water policy must move to the centre of national planning. Pakistan should invest in storage, efficient irrigation and a fair provincial water accord.`,
  labels: [
    ["Water scarcity", "thesis", 0.95],
    ["Pakistan is already", "claim", 0.9],
    ["According to the World Bank", "evidence", 0.9],
    ["Because agriculture", "premise", 0.85],
    ["For example", "evidence", 0.9],
    ["Some critics", "counterclaim", 0.9],
    ["However, the cost", "rebuttal", 0.9],
    ["The Indus Basin", "evidence", 0.85],
    ["Moreover", "evidence", 0.7],
    ["In conclusion", "conclusion", 0.95],
    ["Pakistan should invest", "conclusion", 0.6],
  ],
};

export const WEAK_ESSAY: FixtureEssay = {
  id: "weak",
  text: `Pakistan is a beautiful country with many problems. Education is very important. Terrorism is bad for the economy. People should be honest.

Our youth is the future of the nation. The weather in Pakistan is hot in summer. Everyone knows that corruption is wrong. Some people say that democracy is not suitable for Pakistan.

Cricket is popular. We should all work hard.`,
  labels: [
    ["Pakistan is a beautiful", "other", 0.4],
    ["Education is very", "claim", 0.6],
    ["Terrorism is bad", "claim", 0.6],
    ["People should be honest", "claim", 0.5],
    ["Our youth", "claim", 0.5],
    ["Everyone knows", "claim", 0.5],
    ["Some people say", "counterclaim", 0.7],
    ["Cricket is popular", "other", 0.3],
    ["We should all work", "conclusion", 0.4],
  ],
};

/** Turns hand labels into the raw JSON elements a model would return for this essay. */
export function labelElements(essay: FixtureEssay) {
  const n = normalizeEssay(essay.text);
  return essay.labels.map(([prefix, role, confidence]) => {
    const s = n.sentences.find((x) => x.text.startsWith(prefix));
    if (!s) throw new Error(`fixture ${essay.id}: no sentence starts with "${prefix}"`);
    return { sentenceIds: [s.id], role, confidence };
  });
}
