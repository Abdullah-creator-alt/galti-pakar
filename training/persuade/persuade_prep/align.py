"""Recover exact character spans for PERSUADE annotations.

The corpus' discourse_start/discourse_end do not index full_text (the error grows along the essay and `end` behaves as the
last character), so they are NOT trusted. Instead each annotation's text is located in order inside full_text, which keeps
the original text untouched. A span is accepted only if what lies between the previous span and this one is whitespace.

Offsets: Python string indices count code points; the TypeScript app counts UTF-16 code units. Both are stored.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Span:
    start: int  # code-point offset, inclusive
    end: int  # code-point offset, exclusive
    label: str
    start_u16: int = 0  # UTF-16 code-unit offset, inclusive (what lib/structure uses)
    end_u16: int = 0  # UTF-16 code-unit offset, exclusive


@dataclass
class AlignResult:
    spans: list[Span] = field(default_factory=list)  # annotated spans only (Unannotated excluded), in text order
    ok: bool = True
    problems: list[str] = field(default_factory=list)
    absorbed: list[str] = field(default_factory=list)  # how short gaps were handled, for the data summary


def utf16_offsets(text: str) -> list[int]:
    """offsets[i] = UTF-16 offset of code point i; has len(text)+1 entries so offsets[len(text)] is the total length."""
    out = [0] * (len(text) + 1)
    n = 0
    for i, ch in enumerate(text):
        out[i] = n
        n += 2 if ord(ch) > 0xFFFF else 1
    out[len(text)] = n
    return out


MAX_TAIL_FRACTION = 0.2  # unlabelled text after the last annotation is kept as "outside any span" up to this share of the essay
MAX_GAP_CHARS = 3  # a gap this short between located annotations is a dropped period/letter, not missing text


def align_essay(full_text: str, rows: list[dict], unannotated: str = "Unannotated") -> AlignResult:
    """rows: dicts with discourse_text, discourse_type and discourse_start (used only for ordering).

    Returns spans for annotated rows. Annotations often omit a sentence-final period or a first letter, leaving a gap of
    one to three characters between located rows. Such a gap is absorbed into the adjacent labelled span (a trailing
    punctuation gap goes to the span before it, anything else to the span after it) and counted in `absorbed`.
    A longer gap, or a tail longer than MAX_TAIL_FRACTION of the essay, means text is unaccounted for: `ok` is False and the essay should be
    excluded rather than trained on with guessed labels.
    """
    res = AlignResult()
    ordered = sorted(rows, key=lambda r: _order_key(r))
    cursor = 0
    placed: list[list] = []  # [start, end, label]
    for r in ordered:
        needle = (r.get("discourse_text") or "").strip()
        label = r.get("discourse_type") or ""
        if not needle:
            continue
        idx = full_text.find(needle, cursor)
        if idx < 0:
            res.ok = False
            res.problems.append("text_not_found")
            continue
        start, end = idx, idx + len(needle)
        gap = full_text[cursor:idx]
        stripped = gap.strip()
        if stripped:
            if len(stripped) > MAX_GAP_CHARS:
                res.ok = False
                res.problems.append("non_whitespace_gap")
            else:
                first = cursor + (len(gap) - len(gap.lstrip()))
                last = cursor + len(gap.rstrip())
                prev = placed[-1] if placed else None
                prev_labelled = prev is not None and prev[2] != unannotated
                punct_only = not any(ch.isalnum() for ch in stripped)
                if prev_labelled and punct_only and first == cursor:
                    prev[1] = last
                    res.absorbed.append("into_previous")
                elif label != unannotated:
                    start = first
                    res.absorbed.append("into_next")
                elif prev_labelled and first == cursor:
                    prev[1] = last
                    res.absorbed.append("into_previous")
        placed.append([start, end, label])
        cursor = idx + len(needle)
    if not res.ok:
        return res
    tail = full_text[cursor:]
    if tail.strip():
        if len(tail.strip()) <= MAX_GAP_CHARS and placed and placed[-1][2] != unannotated and not tail[0].isspace():
            placed[-1][1] = cursor + len(tail.rstrip())
            res.absorbed.append("into_previous")
        elif len(tail.strip()) <= MAX_GAP_CHARS:
            res.absorbed.append("ignored")  # short tail after an unannotated row or after whitespace: left as unlabelled
        elif len(tail.strip()) <= MAX_TAIL_FRACTION * len(full_text):
            res.absorbed.append("tail_unlabelled")  # short unannotated ending (often a sign-off): outside any span
        else:
            res.ok = False
            res.problems.append("trailing_text")
            return res
    u16 = utf16_offsets(full_text)
    for s, e, label in placed:
        if label != unannotated:
            res.spans.append(Span(s, e, label, u16[s], u16[e]))
    return res


def _order_key(r: dict) -> float:
    try:
        return float(r.get("discourse_start", 0))
    except (TypeError, ValueError):
        return 0.0
