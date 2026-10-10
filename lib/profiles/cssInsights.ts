/**
 * Data for the report's "For the CSS English Essay" section. Pure code, no model calls.
 *
 * It reorganises what the structure analysis already found, through the CSS profile's criterion labels, into:
 *  - a few plain readings of the essay's structure ("insights"), each tied to the findings or measurements behind it;
 *  - one row per profile criterion saying whether the analysis could look at it, and what it flagged;
 *  - the caveats an examiner needs: what is official, what is inferred, and what this cannot assess.
 *
 * It adds no findings, assigns no marks, weights, score or grade, and never calls a signal an error. A missing signal
 * does not mean a part is strong. Wording is deliberately hedged; see CSS_PROFILE.md.
 */
import { LOW_MODEL_CONFIDENCE, type AnalysisProfile, type StructuralFindingType } from "../structure/index.ts";
import { alignStructureParagraphs } from "../pipeline/findings.ts";
import type { StructureAnalysis } from "../structure/index.ts";
import type { TranscribedEssay } from "../pipeline/transcribe.types.ts";
import type { CssCriterionRow, CssInsight, CssProfileInfo } from "../types.extras.ts";
import type { EssayReport } from "../types.ts";
import { CSS_ESSAY_PROFILE, FPSC_QUOTES, FPSC_SYLLABUS_DOC_ID } from "./cssEssay.ts";

export interface CssInsightsInput {
  structure: StructureAnalysis;
  essay: Pick<TranscribedEssay, "paragraphs">;
  report: Pick<EssayReport, "paragraphs" | "driftThreshold">;
  /** False when topic relevance could not be measured, so the drift numbers must not be read. */
  driftMeasured: boolean;
  profile?: AnalysisProfile;
}

const MAX_OBSERVATIONS = 6;
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const label = (pid: string) => pid.replace(/^p/i, "P");
const joinLabels = (ids: string[]) => ids.map(label).join(", ");
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const byParagraph = (a: string, b: string) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, ""));

/** Returns undefined when the profile was not applied or the structure paragraphs cannot be matched to the transcript. */
export function buildCssProfileInfo(input: CssInsightsInput): CssProfileInfo | undefined {
  const profile = input.profile ?? CSS_ESSAY_PROFILE;
  const applied = input.structure.analysisMetadata.profile;
  if (!applied || applied.profileId !== profile.profileId) return undefined;
  const idFor = alignStructureParagraphs(input.structure, input.essay);
  if (!idFor) return undefined;

  const P = (ids: string[]) => uniq(ids.map((id) => idFor.get(id)).filter((x): x is string => !!x)).sort(byParagraph);
  const findings = input.structure.structuralFindings;
  const ofType = (...t: StructuralFindingType[]) => findings.filter((f) => t.includes(f.type));
  const elements = input.structure.argumentElements;
  const confident = elements.filter((e) => e.modelConfidence >= LOW_MODEL_CONFIDENCE);
  const confidentOf = (role: string) => confident.filter((e) => e.role === role);

  // ---- criterion rows ----
  const mappedTo = (id: string) => profile.mappings.filter((m) => m.criterionIds.includes(id)).map((m) => m.diagnostic);
  const criteria: CssCriterionRow[] = profile.criteria.map((c) => {
    const diagnostics = mappedTo(c.id);
    const mine = findings.filter((f) => f.criteria?.some((x) => x.criterionId === c.id));
    const observations = mine.slice(0, MAX_OBSERVATIONS).map((f) => ({ text: f.description, paragraphIds: P(f.paragraphIds) }));
    let status: CssCriterionRow["status"];
    let note: string | undefined;
    if (diagnostics.length === 0) {
      status = "not_assessed";
      note = c.area === "language" ? "This tool does not assess language or style." : "No check in this tool covers this criterion.";
    } else if (mine.length > 0) {
      status = "signals";
      if (mine.length > MAX_OBSERVATIONS) note = `${mine.length} signals found; the first ${MAX_OBSERVATIONS} are shown.`;
    } else if (c.area === "counterargument" && !elements.some((e) => e.role === "counterclaim")) {
      status = "nothing_to_check";
      note = "No opposing view was identified in the essay, so there was nothing to check. No verified rule requires one.";
    } else if (c.area === "argument_relevance" && confidentOf("thesis").length === 0) {
      status = "not_assessed";
      note = "Relevance to the thesis needs a clearly identified thesis, and none was identified.";
    } else {
      status = "none_flagged";
      note = "The analysis flagged nothing here. That is not a judgement that this part is strong.";
    }
    return {
      id: c.id,
      title: c.title,
      origin: c.origin === "official_requirement" || c.origin === "official_guidance" || c.origin === "inferred_best_practice" ? c.origin : "other",
      assessability: c.checkability,
      status,
      limitations: c.limitations ?? "",
      ...(c.sourceQuote ? { sourceQuote: c.sourceQuote } : {}),
      ...(c.sourceLocator ? { sourceLocator: c.sourceLocator } : {}),
      ...(note ? { note } : {}),
      observations,
    };
  });

  // ---- insights ----
  const insights: CssInsight[] = [];

  // Where to start: the paragraphs holding the most paragraph-level signals (essay-level thesis/conclusion notes excluded).
  const local = ofType("potential_orphan_claim", "potentially_unsupported_reasoning", "unanswered_counterclaim", "weak_thesis_connection");
  if (local.length >= 2) {
    const counts = new Map<string, number>();
    for (const f of local) for (const p of P(f.paragraphIds)) counts.set(p, (counts.get(p) ?? 0) + 1);
    const max = Math.max(...counts.values());
    const top = [...counts].filter(([, n]) => n === max).map(([p]) => p).sort(byParagraph).slice(0, 3);
    if (max >= 2)
      insights.push({
        id: "attention",
        kind: "attention",
        headline: `Start by re-reading ${joinLabels(top)}`,
        detail: `${top.length === 1 ? "This paragraph holds" : "Each of these paragraphs holds"} ${max} of the ${local.length} paragraph-level signals. Signals mark places to re-read; they are not errors.`,
        paragraphIds: top,
      });
  }

  // Support for claims.
  const claims = confidentOf("claim").length;
  const orphan = ofType("potential_orphan_claim");
  const weak = ofType("potentially_unsupported_reasoning");
  if (claims > 0) {
    const flagged = orphan.length + weak.length;
    if (flagged === 0)
      insights.push({
        id: "support",
        kind: "support",
        headline: `${claims === 1 ? "The claim" : `All ${claims} claims`} we identified ${claims === 1 ? "has" : "have"} a supporting passage we could find`,
        detail:
          "This only says a supporting passage was located nearby or by wording. It does not say the support is accurate or enough. The syllabus expects research-based knowledge on the topic, which only an examiner can judge.",
        paragraphIds: [],
      });
    else {
      const parts = [
        orphan.length ? `${orphan.length} ${plural(orphan.length, "claim")} with no supporting passage identified` : "",
        weak.length ? `${weak.length} ${plural(weak.length, "claim")} with only weak signs of support` : "",
      ].filter(Boolean);
      insights.push({
        id: "support",
        kind: "support",
        headline: `${flagged} of ${claims} ${plural(claims, "claim")} ${flagged === 1 ? "needs" : "need"} a closer look for support`,
        detail: `${parts.join(" and ")}. Support may be implicit or elsewhere in the essay, so check each marked claim before deciding anything.`,
        paragraphIds: P([...orphan, ...weak].flatMap((f) => f.paragraphIds)),
      });
    }
  }

  // Position and ending.
  const thesis = confidentOf("thesis");
  insights.push(
    thesis.length > 0
      ? {
          id: "position",
          kind: "position",
          headline: "A central position was identified",
          detail: `It was found in ${joinLabels(P(thesis.map((e) => e.paragraphId)))}. This shows a stated position exists, not that it is clear or well argued.`,
          paragraphIds: P(thesis.map((e) => e.paragraphId)),
        }
      : {
          id: "position",
          kind: "position",
          headline: "No clearly stated central position was identified",
          detail: "The position may be implicit. The examiner should read the opening to decide.",
          paragraphIds: P(ofType("missing_thesis").flatMap((f) => f.paragraphIds)),
        },
  );
  const conclusion = confidentOf("conclusion");
  insights.push(
    conclusion.length > 0
      ? {
          id: "ending",
          kind: "ending",
          headline: "A concluding passage was identified",
          detail: `It was found in ${joinLabels(P(conclusion.map((e) => e.paragraphId)))}. Whether it matches the position and arguments was not assessed.`,
          paragraphIds: P(conclusion.map((e) => e.paragraphId)),
        }
      : {
          id: "ending",
          kind: "ending",
          headline: "No clearly concluding passage was identified",
          detail: "The ending may be present but unlabelled, so the examiner should check.",
          paragraphIds: P(ofType("missing_conclusion").flatMap((f) => f.paragraphIds)),
        },
  );

  // Opposing views.
  const counterclaims = elements.filter((e) => e.role === "counterclaim");
  const unanswered = ofType("unanswered_counterclaim");
  insights.push(
    counterclaims.length === 0
      ? {
          id: "opposing",
          kind: "opposing",
          headline: "No opposing view was identified",
          detail: "No verified rule requires one. Whether one suits your topic and approach is your decision.",
          paragraphIds: [],
        }
      : {
          id: "opposing",
          kind: "opposing",
          headline:
            unanswered.length === 0
              ? `${counterclaims.length} opposing ${plural(counterclaims.length, "view")} raised, and ${counterclaims.length === 1 ? "a response was" : "responses were"} identified`
              : `${counterclaims.length} opposing ${plural(counterclaims.length, "view")} raised, ${unanswered.length} without an identified response`,
          detail:
            unanswered.length === 0
              ? "That only says a possible response was found. It does not say the response is convincing."
              : "A response may be implicit or placed elsewhere. Whether each view needs a reply is for the examiner to decide.",
          paragraphIds: P((unanswered.length ? unanswered.flatMap((f) => f.paragraphIds) : counterclaims.map((e) => e.paragraphId))),
        },
  );

  // Relevance: structural findings plus the separate topic-drift measurement.
  const weakRel = ofType("weak_thesis_connection");
  const drifting = input.driftMeasured ? input.report.paragraphs.filter((p) => p.relevance < input.report.driftThreshold).map((p) => p.id) : [];
  if (weakRel.length > 0 || drifting.length > 0) {
    const parts = [
      weakRel.length ? `${weakRel.length} ${plural(weakRel.length, "claim")} with no clear tie to the thesis` : "",
      drifting.length ? `${drifting.length} ${plural(drifting.length, "paragraph")} measured as drifting from the topic` : "",
    ].filter(Boolean);
    insights.push({
      id: "relevance",
      kind: "relevance",
      headline: `Possible relevance concern: ${parts.join("; ")}`,
      detail: [
        weakRel.length ? "The thesis-tie check relies mainly on shared wording, so a paraphrase can be missed." : "",
        drifting.length ? "The drift measurement compares each paragraph with the topic and is not a verdict on relevance." : "",
        "Treat these as places to re-read, not as proof of irrelevance.",
      ]
        .filter(Boolean)
        .join(" "),
      paragraphIds: uniq([...P(weakRel.flatMap((f) => f.paragraphIds)), ...drifting]).sort(byParagraph),
    });
  }

  // ---- caveats and source ----
  const doc = profile.provenance.documents.find((d) => d.id === FPSC_SYLLABUS_DOC_ID) ?? profile.provenance.documents[0];
  const official = profile.criteria.filter((c) => c.origin.startsWith("official_")).length;
  const caveats = [
    `The FPSC syllabus for English Essay (compulsory, 100 marks) says: “${FPSC_QUOTES.knowledge}” and “${FPSC_QUOTES.style}”`,
    `${profile.criteria.length - official} of the ${profile.criteria.length} criteria below are inferred best practice, not FPSC rules. The syllabus does not mention a thesis, counterarguments, a conclusion or coherence, and it gives no criterion weights.`,
    "This section looks only at structure. It cannot judge knowledge, accuracy, language, style, logic or coherence.",
    "A signal is a place to look, not an error, and no signal does not mean a part is strong. There are no marks here: the examiner makes the evaluation.",
  ];

  const quoted = profile.criteria.find((c) => c.sourceLocator);
  return {
    profileId: profile.profileId,
    profileVersion: profile.version,
    source: { title: doc.title, url: doc.url ?? "https://www.fpsc.gov.pk/Syllabuses?section=CSS+Syllabi", locator: quoted?.sourceLocator ?? "", retrievedOn: doc.retrievedOn ?? "" },
    insights,
    criteria,
    caveats,
  };
}

