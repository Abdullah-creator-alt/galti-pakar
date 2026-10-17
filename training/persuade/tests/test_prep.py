import csv
import io
import os
import tempfile
import unittest

from persuade_prep import align, labels, prepare


def row(text, typ, start=0):
    return {"discourse_text": text, "discourse_type": typ, "discourse_start": str(start)}


class LabelMapping(unittest.TestCase):
    def test_every_label_has_a_mapping_and_a_fit(self):
        for l in labels.PERSUADE_LABELS:
            self.assertIn(l, labels.GALTI_ROLE)
            self.assertIn(l, labels.MAPPING_FIT)

    def test_only_compatible_labels_map_to_galti_roles(self):
        self.assertEqual(labels.GALTI_ROLE["Position"], "thesis")
        self.assertEqual(labels.GALTI_ROLE["Concluding Statement"], "conclusion")
        self.assertIsNone(labels.GALTI_ROLE["Lead"])
        self.assertEqual(labels.MAPPING_FIT["Evidence"], "partial")
        self.assertNotIn("premise", labels.GALTI_ROLE.values())
        self.assertIn("premise", labels.GALTI_ROLES_WITHOUT_SOURCE)

    def test_bio_tags_are_consistent(self):
        self.assertEqual(labels.BIO_TAGS[0], "O")
        self.assertEqual(len(labels.BIO_TAGS), 1 + 2 * len(labels.PERSUADE_LABELS))
        self.assertEqual(len(set(labels.BIO_TAGS)), len(labels.BIO_TAGS))

    def test_galti_roles_match_the_typescript_contract(self):
        ts = open(os.path.join(os.path.dirname(__file__), "..", "..", "..", "lib", "structure", "types.ts"), encoding="utf-8").read()
        for role in [r for r in labels.GALTI_ROLE.values() if r] + labels.GALTI_ROLES_WITHOUT_SOURCE:
            self.assertIn(f'"{role}"', ts)


class Alignment(unittest.TestCase):
    TEXT = "I agree. Phones distract drivers!\n\nFor example, crashes rise. Thus ban them."

    def rows(self):
        return [
            row("I agree.", "Position", 100),  # given offsets are deliberately wrong and only used for order
            row("Phones distract drivers!", "Claim", 109),
            row("For example, crashes rise.", "Evidence", 135),
            row("Thus ban them.", "Concluding Statement", 163),
        ]

    def test_spans_index_the_original_text_exactly(self):
        res = align.align_essay(self.TEXT, self.rows())
        self.assertTrue(res.ok, res.problems)
        self.assertEqual([self.TEXT[s.start : s.end] for s in res.spans], ["I agree.", "Phones distract drivers!", "For example, crashes rise.", "Thus ban them."])
        self.assertEqual([s.label for s in res.spans], ["Position", "Claim", "Evidence", "Concluding Statement"])

    def test_row_order_comes_from_given_start_not_list_order(self):
        res = align.align_essay(self.TEXT, list(reversed(self.rows())))
        self.assertTrue(res.ok)
        self.assertEqual(res.spans[0].label, "Position")

    def test_repeated_text_is_placed_in_order(self):
        text = "Yes. Maybe. Yes."
        res = align.align_essay(text, [row("Yes.", "Claim", 1), row("Maybe.", "Unannotated", 6), row("Yes.", "Rebuttal", 13)])
        self.assertTrue(res.ok)
        self.assertEqual([(s.start, s.label) for s in res.spans], [(0, "Claim"), (12, "Rebuttal")])

    def test_unannotated_gaps_are_not_spans_but_keep_the_cursor_honest(self):
        text = "Intro words. Claim here."
        res = align.align_essay(text, [row("Intro words.", "Unannotated", 0), row("Claim here.", "Claim", 14)])
        self.assertTrue(res.ok)
        self.assertEqual(len(res.spans), 1)
        self.assertEqual(text[res.spans[0].start : res.spans[0].end], "Claim here.")

    def test_unalignable_row_marks_the_essay_not_ok(self):
        res = align.align_essay(self.TEXT, self.rows() + [row("Never written.", "Claim", 200)])
        self.assertFalse(res.ok)
        self.assertIn("text_not_found", res.problems)

    def test_skipped_text_between_spans_is_rejected(self):
        res = align.align_essay("A one. Hidden words here. B two.", [row("A one.", "Claim", 0), row("B two.", "Claim", 30)])
        self.assertFalse(res.ok)
        self.assertIn("non_whitespace_gap", res.problems)

    def test_dropped_final_period_is_absorbed_into_the_span_before_it(self):
        text = "Phones distract drivers. Ban them now."
        res = align.align_essay(text, [row("Phones distract drivers", "Claim", 0), row("Ban them now", "Concluding Statement", 25)])
        self.assertTrue(res.ok, res.problems)
        self.assertEqual([text[s.start : s.end] for s in res.spans], ["Phones distract drivers.", "Ban them now."])
        self.assertEqual(res.absorbed, ["into_previous", "into_previous"][:len(res.absorbed)])

    def test_dropped_first_letter_is_absorbed_into_the_span_after_it(self):
        text = "Intro here. I think phones are bad."
        res = align.align_essay(text, [row("Intro here.", "Unannotated", 0), row("think phones are bad.", "Position", 14)])
        self.assertTrue(res.ok, res.problems)
        self.assertEqual(text[res.spans[0].start : res.spans[0].end], "I think phones are bad.")
        self.assertEqual(res.absorbed, ["into_next"])

    def test_gap_of_real_words_is_still_rejected(self):
        res = align.align_essay("One claim. Missing sentence of text. Two claim.", [row("One claim.", "Claim", 0), row("Two claim.", "Claim", 40)])
        self.assertFalse(res.ok)
        self.assertIn("non_whitespace_gap", res.problems)

    def test_short_unannotated_tail_is_kept_as_unlabelled_text(self):
        text = "Claim one is here and it is a long enough sentence to matter. Thanks!"
        res = align.align_essay(text, [row("Claim one is here and it is a long enough sentence to matter.", "Claim", 0)])
        self.assertTrue(res.ok, res.problems)
        self.assertEqual(len(res.spans), 1)
        self.assertEqual(res.absorbed, ["tail_unlabelled"])
        self.assertNotIn("Thanks", text[res.spans[0].start : res.spans[0].end])

    def test_trailing_unlabelled_text_is_rejected(self):
        res = align.align_essay("A one. Left over words.", [row("A one.", "Claim", 0)])
        self.assertFalse(res.ok)
        self.assertIn("trailing_text", res.problems)

    def test_unicode_utf16_offsets_for_astral_characters(self):
        text = "Hi \U0001F600 there. Second one."
        res = align.align_essay(text, [row("Hi \U0001F600 there.", "Position", 0), row("Second one.", "Claim", 14)])
        self.assertTrue(res.ok)
        s1, s2 = res.spans
        self.assertEqual(text[s2.start : s2.end], "Second one.")
        self.assertEqual(s2.start, 12)  # code points
        self.assertEqual(s2.start_u16, 13)  # the emoji is one code point but two UTF-16 units
        self.assertEqual(s1.end_u16 - s1.start_u16, len("Hi \U0001F600 there.".encode("utf-16-le")) // 2)
        # JavaScript-style slicing over the UTF-16 units reproduces the span
        units = text.encode("utf-16-le")
        self.assertEqual(units[2 * s2.start_u16 : 2 * s2.end_u16].decode("utf-16-le"), "Second one.")

    def test_non_ascii_text_and_curly_quotes(self):
        text = "Café owners say “no”. Students disagree."
        res = align.align_essay(text, [row("Café owners say “no”.", "Counterclaim", 0), row("Students disagree.", "Rebuttal", 24)])
        self.assertTrue(res.ok)
        self.assertEqual(text[res.spans[1].start : res.spans[1].end], "Students disagree.")

    def test_surrounding_whitespace_in_annotation_text_is_tolerated(self):
        res = align.align_essay("A one. B two.", [row(" A one. ", "Claim", 0), row("B two. ", "Claim", 8)])
        self.assertTrue(res.ok)
        self.assertEqual([s.end - s.start for s in res.spans], [6, 6])


CSV_HEADER = ["essay_id", "essay_id_comp", "competition_set", "full_text", "discourse_start", "discourse_text", "discourse_type", "prompt_name", "task", "gender", "race_ethnicity", "student_disability_status", "holistic_essay_score"]


def make_csv(essays):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CSV_HEADER)
    w.writeheader()
    for eid, prompt, parts in essays:
        text = " ".join(t for t, _ in parts)
        pos = 0
        for t, typ in parts:
            w.writerow({"essay_id": "1.0E+12", "essay_id_comp": eid, "competition_set": "train", "full_text": text, "discourse_start": pos, "discourse_text": t, "discourse_type": typ,
                        "prompt_name": prompt, "task": "Independent", "gender": "SECRET", "race_ethnicity": "SECRET", "student_disability_status": "SECRET", "holistic_essay_score": "6"})
            pos += len(t) + 1
    return buf.getvalue()


class Prepare(unittest.TestCase):
    def write_tmp(self, content):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "t.csv")
        open(p, "w", encoding="utf-8", newline="").write(content)
        return p

    def test_sensitive_columns_are_never_read(self):
        p = self.write_tmp(make_csv([("A1", "P", [("One claim here.", "Claim")])]))
        rows = list(prepare.read_rows(p))
        self.assertEqual(set(rows[0]), set(prepare.KEEP))
        self.assertNotIn("SECRET", repr(rows))
        for banned in ("gender", "race_ethnicity", "student_disability_status", "holistic_essay_score", "essay_id"):
            self.assertNotIn(banned, prepare.KEEP)

    def test_essays_are_keyed_by_the_comp_id_not_the_lossy_numeric_id(self):
        p = self.write_tmp(make_csv([("AAA", "P", [("One.", "Claim")]), ("BBB", "P", [("Two.", "Claim")])]))
        essays, stats = prepare.build_essays(prepare.read_rows(p))
        self.assertEqual(sorted(e["essay_id"] for e in essays), ["AAA", "BBB"])
        self.assertEqual(stats["essays_read"], 2)

    def test_unalignable_essays_are_excluded_and_counted(self):
        good = ("G", "P", [("Good claim.", "Claim"), ("Good end.", "Concluding Statement")])
        p = self.write_tmp(make_csv([good]))
        essays, stats = prepare.build_essays(prepare.read_rows(p))
        self.assertEqual(len(essays), 1)
        bad_rows = [{**r, "discourse_text": "Not in text at all."} for r in prepare.read_rows(p)][:1]
        essays2, stats2 = prepare.build_essays(iter(bad_rows))
        self.assertEqual(essays2, [])
        self.assertEqual(stats2["excluded_unalignable"], 1)

    def test_duplicate_essays_are_removed_case_and_whitespace_insensitively(self):
        a = {"text": "Phones are bad.  Really bad.", "essay_id": "1"}
        b = {"text": "phones are bad. really bad.", "essay_id": "2"}
        c = {"text": "Different essay.", "essay_id": "3"}
        kept, removed = prepare.dedupe([a, b, c])
        self.assertEqual([e["essay_id"] for e in kept], ["1", "3"])
        self.assertEqual(removed, 1)

    def test_split_is_by_essay_stratified_by_prompt_deterministic_and_disjoint(self):
        essays = [{"essay_id": f"{p}{i:02d}", "prompt_name": p, "text": f"{p}{i}", "spans": []} for p in "ABC" for i in range(20)]
        tr, va = prepare.split_by_essay(essays, 0.1, seed=7)
        self.assertEqual(len(tr) + len(va), 60)
        self.assertEqual({e["essay_id"] for e in tr} & {e["essay_id"] for e in va}, set())
        self.assertEqual({e["prompt_name"] for e in va}, {"A", "B", "C"})
        self.assertEqual(len(va), 6)
        tr2, va2 = prepare.split_by_essay(list(reversed(essays)), 0.1, seed=7)
        self.assertEqual([e["essay_id"] for e in va], [e["essay_id"] for e in va2], "input order must not change the split")

    def test_refuses_to_write_inside_the_repository(self):
        inside = os.path.join(os.path.dirname(prepare.__file__), "out")
        self.assertEqual(prepare.main(["--train-csv", "x.csv", "--out-dir", inside]), 2)

    def test_end_to_end_writes_jsonl_and_summary_without_sensitive_fields(self):
        import json

        essays = [(f"E{i}", "P", [(f"Claim number {i}.", "Claim"), (f"Reason number {i}.", "Evidence")]) for i in range(10)]
        p = self.write_tmp(make_csv(essays))
        out = tempfile.mkdtemp()
        self.assertEqual(prepare.main(["--train-csv", p, "--out-dir", out, "--val-fraction", "0.2"]), 0)
        for name in ("train.jsonl", "val.jsonl", "summary.json"):
            self.assertTrue(os.path.exists(os.path.join(out, name)))
        blob = open(os.path.join(out, "train.jsonl"), encoding="utf-8").read() + open(os.path.join(out, "val.jsonl"), encoding="utf-8").read()
        self.assertNotIn("SECRET", blob)
        first = json.loads(blob.splitlines()[0])
        self.assertEqual(set(first), {"essay_id", "prompt_name", "task", "text", "spans"})
        for s in first["spans"]:
            self.assertEqual(first["text"][s["start"] : s["end"]].strip(), first["text"][s["start"] : s["end"]])


if __name__ == "__main__":
    unittest.main()
