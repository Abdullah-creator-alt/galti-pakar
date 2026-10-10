/**
 * Code-written fixes, used only when the model could not produce a fix. Each is built from the same finding
 * (type, paragraph, target sentence, counts) that the X-Ray measured. No LLM.
 */
import type { IssueType } from "./blend.types.ts";
import type { FixTarget } from "./selectFixes.ts";

const snippet = (t: FixTarget) => {
  const s = t.sentences[0]?.text;
  if (!s) return "";
  const w = s.trim().split(/\s+/);
  return ` ("${w.slice(0, 12).join(" ")}${w.length > 12 ? "..." : ""}")`;
};

const TEMPLATES: Record<IssueType, (n: number | null, t: FixTarget) => { title: string; body: string }> = {
  orphan_claim: (n, t) => ({
    title: "Add evidence for your claim",
    body: `The claim in paragraph ${n ?? "?"}${snippet(t)} has no evidence next to it, so an examiner reads it as an assertion. Add one specific example, figure or named source right after it that shows the claim is true.`,
  }),
  weak_link_claim: (n, t) => ({
    title: "Tie your evidence to the claim",
    body: `The evidence near the claim in paragraph ${n ?? "?"}${snippet(t)} is only loosely connected to it. Add a sentence that says exactly how the evidence proves the claim.`,
  }),
  unrebutted_counterclaim: (n, t) => ({
    title: "Answer the opposing view",
    body: `Paragraph ${n ?? "?"} raises an opposing view${snippet(t)} but never answers it. Follow it with a sentence or two that explain why your position still holds, ideally with evidence.`,
  }),
  drift: (n) => ({
    title: "Bring the paragraph back to the topic",
    body: `Paragraph ${n ?? "?"} drifts away from the essay topic, which examiners count as failing to grasp the question. Cut it, or rewrite each sentence so it ties back to the topic.`,
  }),
  generic: (n, t) => ({
    title: "Replace generic sentences with specifics",
    body: `Paragraph ${n ?? "?"} has sentences${snippet(t)} that could appear in any essay. Replace each with a point that is specific to this topic and Pakistan, with a fact, example or institution.`,
  }),
  missing_counter: () => ({
    title: "Add one counter-argument",
    body: "The essay never considers an opposing view. Add a short paragraph that states the strongest objection to your position fairly, then answers it.",
  }),
  no_position: () => ({
    title: "State your position early",
    body: "The introduction does not state a clear position on the topic. Add one sentence that says exactly what you will argue, so the examiner can judge everything against it.",
  }),
  no_conclusion: () => ({
    title: "End with a clear conclusion",
    body: "The essay has no concluding statement. Close with two or three sentences that return to your position and draw together your main points.",
  }),
};

export function templateFix(t: FixTarget, paragraphNumber: number | null): { title: string; body: string } {
  if (t.source === "issue") return TEMPLATES[t.type as IssueType](paragraphNumber, t);
  if (t.source === "benchmark") return { title: "Cover a key point examiners expect", body: `Strong essays on this theme make this point, and yours does not yet: ${t.statement?.split(": ").slice(1).join(": ") ?? "see the benchmark"}. Consider whether it supports your position, and if so add it with evidence.` };
  return { title: "Strengthen a weaker area", body: `${t.statement ?? "This area is weaker than the rest of the essay."} Revisit it and make one concrete improvement.` };
}
