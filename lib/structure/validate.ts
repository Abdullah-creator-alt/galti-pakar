/**
 * The module's own integrity checks on a finished StructureAnalysis. They establish that the data is
 * well-formed and that every reference resolves and matches the original essay text. They do NOT show
 * that any role label, link or finding is logically correct; that is for the later verification stage.
 */
import { structureAnalysisSchema } from "./schema.ts";
import type { StructureAnalysis } from "./types.ts";

export interface IntegrityIssue {
  code: string;
  message: string;
}

export interface IntegrityReport {
  issues: IntegrityIssue[];
  checks: number;
}

const ALLOWED: Record<string, { sources: string[]; targets: string[] }> = {
  supports: { sources: ["evidence", "premise"], targets: ["claim", "premise", "thesis", "rebuttal", "counterclaim"] },
  challenges: { sources: ["counterclaim"], targets: ["thesis", "claim", "premise"] },
  rebuts: { sources: ["rebuttal"], targets: ["counterclaim"] },
  relevant_to: { sources: ["claim", "premise", "evidence"], targets: ["thesis"] },
};

export function validateStructureAnalysis(a: unknown, sourceText: string): IntegrityReport {
  const issues: IntegrityIssue[] = [];
  let checks = 0;
  const check = (ok: boolean, code: string, message: string) => {
    checks++;
    if (!ok) issues.push({ code, message });
  };

  const shape = structureAnalysisSchema.safeParse(a);
  checks++;
  if (!shape.success) {
    for (const i of shape.error.issues.slice(0, 10)) issues.push({ code: "schema_shape", message: `${i.path.join(".") || "(root)"}: ${i.message}` });
    return { issues, checks }; // referential checks need a well-shaped object
  }
  const doc: StructureAnalysis = shape.data;

  const unique = (ids: string[], what: string) => check(new Set(ids).size === ids.length, "duplicate_id", `Duplicate ${what} ids.`);
  unique(doc.paragraphs.map((p) => p.id), "paragraph");
  unique(doc.sentences.map((s) => s.id), "sentence");
  unique(doc.argumentElements.map((e) => e.id), "element");
  unique(doc.argumentLinks.map((l) => l.id), "link");
  unique(doc.structuralFindings.map((f) => f.id), "finding");

  const paragraphs = new Map(doc.paragraphs.map((p) => [p.id, p]));
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const elements = new Map(doc.argumentElements.map((e) => [e.id, e]));
  const links = new Map(doc.argumentLinks.map((l) => [l.id, l]));

  check(doc.essayMetadata.paragraphCount === doc.paragraphs.length, "metadata_mismatch", "paragraphCount does not match paragraphs.");
  check(doc.essayMetadata.sentenceCount === doc.sentences.length, "metadata_mismatch", "sentenceCount does not match sentences.");
  check(doc.essayMetadata.charCount === sourceText.length, "metadata_mismatch", "charCount does not match the source text.");

  let prevEnd = -1;
  for (const p of doc.paragraphs) {
    check(p.end > p.start && p.end <= sourceText.length, "paragraph_range_invalid", `${p.id} has an invalid range.`);
    check(sourceText.slice(p.start, p.end) === p.text, "paragraph_text_mismatch", `${p.id} text does not match the source at [${p.start}, ${p.end}).`);
    check(p.start >= prevEnd, "paragraph_overlap", `${p.id} overlaps the previous paragraph.`);
    prevEnd = p.end;
    for (const sid of p.sentenceIds) check(sentences.get(sid)?.paragraphId === p.id, "paragraph_sentence_mismatch", `${p.id} lists ${sid}, which does not belong to it.`);
  }

  prevEnd = -1;
  doc.sentences.forEach((s, i) => {
    check(s.index === i, "sentence_order", `${s.id} has index ${s.index}, expected ${i}.`);
    check(s.end > s.start && s.end <= sourceText.length, "sentence_range_invalid", `${s.id} has an invalid range.`);
    check(sourceText.slice(s.start, s.end) === s.text, "sentence_text_mismatch", `${s.id} text does not match the source at [${s.start}, ${s.end}).`);
    check(s.start >= prevEnd, "sentence_overlap", `${s.id} overlaps the previous sentence.`);
    prevEnd = s.end;
    const p = paragraphs.get(s.paragraphId);
    check(!!p && s.start >= p.start && s.end <= p.end && p.sentenceIds[s.indexInParagraph] === s.id, "sentence_paragraph_mismatch", `${s.id} is not inside ${s.paragraphId}.`);
  });

  const used = new Set<string>();
  for (const e of doc.argumentElements) {
    const nodes = e.sentenceIds.map((id) => sentences.get(id));
    const known = nodes.every((n) => !!n);
    check(known, "element_unknown_sentence", `${e.id} references an unknown sentence id.`);
    if (!known) continue;
    const ns = nodes as NonNullable<(typeof nodes)[number]>[];
    check(ns.every((n) => n.paragraphId === e.paragraphId), "element_paragraph_mismatch", `${e.id} spans sentences outside ${e.paragraphId}.`);
    check(ns.every((n, i) => i === 0 || n.index === ns[i - 1].index + 1), "element_noncontiguous", `${e.id} sentences are not adjacent and in order.`);
    check(e.start === ns[0].start && e.end === ns[ns.length - 1].end, "element_range_mismatch", `${e.id} range does not match its sentences.`);
    check(sourceText.slice(e.start, e.end) === e.text, "element_text_mismatch", `${e.id} text does not match the source.`);
    check(!e.alternativeRole || e.alternativeRole !== e.role, "element_alternative_same", `${e.id} alternativeRole equals its role.`);
    check(!e.sentenceIds.some((id) => used.has(id)), "element_overlap", `${e.id} reuses a sentence already assigned to another element.`);
    e.sentenceIds.forEach((id) => used.add(id));
  }

  const seen = new Set<string>();
  for (const l of doc.argumentLinks) {
    const src = elements.get(l.sourceId);
    const tgt = elements.get(l.targetId);
    check(!!src && !!tgt, "link_unknown_element", `${l.id} references an unknown element.`);
    check(l.sourceId !== l.targetId, "link_self_reference", `${l.id} links an element to itself.`);
    if (src && tgt) {
      const rule = ALLOWED[l.type];
      check(rule.sources.includes(src.role) && rule.targets.includes(tgt.role), "link_role_incompatible", `${l.id} (${l.type}) cannot go from ${src.role} to ${tgt.role}.`);
    }
    const key = `${l.type}|${l.sourceId}|${l.targetId}`;
    check(!seen.has(key), "link_duplicate", `${l.id} duplicates another ${l.type} link.`);
    seen.add(key);
    const sum = Math.min(1, Math.max(0, l.signals.reduce((s, x) => s + x.value, 0)));
    check(Math.abs(sum - l.strength) < 0.01, "link_strength_mismatch", `${l.id} strength does not equal the sum of its signals.`);
  }

  for (const f of doc.structuralFindings) {
    check(f.paragraphIds.every((id) => paragraphs.has(id)), "finding_unknown_paragraph", `${f.id} references an unknown paragraph.`);
    check(f.sentenceIds.every((id) => sentences.has(id)), "finding_unknown_sentence", `${f.id} references an unknown sentence.`);
    check(f.elementIds.every((id) => elements.has(id)), "finding_unknown_element", `${f.id} references an unknown element.`);
    check(f.linkIds.every((id) => links.has(id)), "finding_unknown_link", `${f.id} references an unknown link.`);
    check(f.paragraphIds.length > 0, "finding_no_locus", `${f.id} points to no paragraph.`);
    check(
      f.sentenceIds.every((sid) => f.paragraphIds.includes(sentences.get(sid)?.paragraphId ?? "")),
      "finding_locus_mismatch",
      `${f.id} lists sentences outside its paragraphs.`,
    );
  }
  return { issues, checks };
}
