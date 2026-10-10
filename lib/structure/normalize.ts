/**
 * Stage A: split parsed essay text into paragraphs and sentences with stable IDs and exact offsets.
 * The text is never modified. Offsets are UTF-16 code units into the caller's string, start inclusive,
 * end exclusive. Ids are positional (p1.., s1..), so the same input always yields the same ids.
 */
import { splitSentences } from "../pipeline/sentences.ts";
import { STRUCTURE_LIMITS } from "./config.ts";
import type { AnalysisWarning, ParagraphNode, SentenceNode } from "./types.ts";

export interface NormalizedEssay {
  paragraphs: ParagraphNode[];
  sentences: SentenceNode[];
  warnings: AnalysisWarning[];
  wordCount: number;
}

interface Block {
  start: number;
  end: number;
}

/** Trim whitespace from both ends of [start, end) without leaving the range. */
function trimRange(text: string, start: number, end: number): Block | null {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return end > start ? { start, end } : null;
}

function splitOn(text: string, separator: RegExp): Block[] {
  const blocks: Block[] = [];
  let cursor = 0;
  for (const m of text.matchAll(separator)) {
    const b = trimRange(text, cursor, m.index);
    if (b) blocks.push(b);
    cursor = m.index + m[0].length;
  }
  const last = trimRange(text, cursor, text.length);
  if (last) blocks.push(last);
  return blocks;
}

const TERMINAL = /[.!?]["')\]’”]*$/;

/**
 * Paragraph breaks are blank lines. If there are none but the text has line breaks, a single newline is
 * treated as a paragraph break only when every line before the last ends a sentence; otherwise the
 * newlines are assumed to be hard wraps (common in handwriting transcription) and are left inside the text.
 */
export function splitParagraphs(text: string): { blocks: Block[]; singleNewline: boolean } {
  const blocks = splitOn(text, /\r?\n(?:[ \t]*\r?\n)+/g);
  if (blocks.length === 1 && /\n/.test(text.slice(blocks[0].start, blocks[0].end))) {
    const lines = splitOn(text, /\r?\n/g);
    if (lines.length > 1 && lines.slice(0, -1).every((l) => TERMINAL.test(text.slice(l.start, l.end)))) {
      return { blocks: lines, singleNewline: true };
    }
  }
  return { blocks, singleNewline: false };
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function hasLetterOrDigit(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

export function normalizeEssay(text: string): NormalizedEssay {
  const warnings: AnalysisWarning[] = [];
  const { blocks, singleNewline } = splitParagraphs(text);
  if (singleNewline)
    warnings.push({ code: "single_newline_paragraphs", message: "No blank lines found; each line was treated as a paragraph because every line ends a sentence." });

  const paragraphs: ParagraphNode[] = [];
  const sentences: SentenceNode[] = [];
  for (const block of blocks) {
    const pText = text.slice(block.start, block.end);
    const pIndex = paragraphs.length;
    const paragraph: ParagraphNode = { id: `p${pIndex + 1}`, index: pIndex, start: block.start, end: block.end, text: pText, sentenceIds: [] };
    for (const span of splitSentences(pText)) {
      const s = trimRange(text, block.start + span.start, block.start + span.end);
      if (!s) continue;
      const node: SentenceNode = {
        id: `s${sentences.length + 1}`,
        index: sentences.length,
        paragraphId: paragraph.id,
        indexInParagraph: paragraph.sentenceIds.length,
        start: s.start,
        end: s.end,
        text: text.slice(s.start, s.end),
      };
      sentences.push(node);
      paragraph.sentenceIds.push(node.id);
    }
    if (paragraph.sentenceIds.length > 0) paragraphs.push(paragraph);
  }

  const longCount = sentences.filter((s) => countWords(s.text) > 80).length;
  if (longCount > 0)
    warnings.push({ code: "long_sentences", message: `${longCount} sentence(s) exceed 80 words; punctuation may be missing, so roles may be less reliable.` });
  const lowerStart = sentences.filter((s) => /^[a-z]/.test(s.text)).length;
  if (sentences.length > 0 && lowerStart / sentences.length > 0.4)
    warnings.push({ code: "lowercase_sentence_starts", message: "Many sentences start in lowercase; sentence boundaries may be under-detected." });

  return { paragraphs, sentences, warnings, wordCount: countWords(text) };
}
