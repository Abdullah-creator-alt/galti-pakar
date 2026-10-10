"""Read the PERSUADE CSV, drop sensitive columns at read time, align spans, dedupe, split by essay, write JSONL.

Raw data and outputs live outside the repository (see README). Only counts are printed; no essay text is logged.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
import re
import sys
from collections import Counter, defaultdict

from .align import align_essay
from .labels import PERSUADE_LABELS, UNANNOTATED

# The only columns ever read. Demographic and score columns are deliberately absent.
KEEP = ["essay_id_comp", "full_text", "discourse_start", "discourse_text", "discourse_type", "prompt_name", "task", "competition_set"]


def read_rows(path: str):
    csv.field_size_limit(10**9)
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            yield {k: row.get(k, "") for k in KEEP}


def normalise_for_dedupe(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def build_essays(rows) -> tuple[list[dict], dict]:
    by: dict[str, dict] = {}
    for r in rows:
        eid = r["essay_id_comp"]
        if not eid:
            continue
        e = by.setdefault(eid, {"essay_id": eid, "text": r["full_text"], "prompt_name": r["prompt_name"], "task": r["task"], "rows": []})
        e["rows"].append(r)
    stats = Counter()
    essays = []
    for e in by.values():
        stats["essays_read"] += 1
        res = align_essay(e["text"], e["rows"], UNANNOTATED)
        for a in res.absorbed:
            stats[f"gap_absorbed_{a}"] += 1
        if not res.ok:
            stats["excluded_unalignable"] += 1
            for p in set(res.problems):
                stats[f"problem_{p}"] += 1
            continue
        essays.append(
            {
                "essay_id": e["essay_id"],
                "prompt_name": e["prompt_name"],
                "task": e["task"],
                "text": e["text"],
                "spans": [{"start": s.start, "end": s.end, "start_u16": s.start_u16, "end_u16": s.end_u16, "label": s.label} for s in res.spans],
            }
        )
    return essays, dict(stats)


def dedupe(essays: list[dict]) -> tuple[list[dict], int]:
    seen: set[str] = set()
    out = []
    for e in essays:
        h = hashlib.sha1(normalise_for_dedupe(e["text"]).encode("utf-8")).hexdigest()
        if h in seen:
            continue
        seen.add(h)
        out.append(e)
    return out, len(essays) - len(out)


def split_by_essay(essays: list[dict], val_fraction: float, seed: int) -> tuple[list[dict], list[dict]]:
    """Essay-level split, stratified by prompt so every prompt appears in both parts."""
    rng = random.Random(seed)
    by_prompt = defaultdict(list)
    for e in sorted(essays, key=lambda x: x["essay_id"]):
        by_prompt[e["prompt_name"]].append(e)
    train, val = [], []
    for prompt in sorted(by_prompt):
        items = by_prompt[prompt]
        rng.shuffle(items)
        k = max(1, round(len(items) * val_fraction)) if len(items) > 1 else 0
        val.extend(items[:k])
        train.extend(items[k:])
    return train, val


def summarise(essays: list[dict]) -> dict:
    c = Counter()
    words = 0
    for e in essays:
        words += len(e["text"].split())
        for s in e["spans"]:
            c[s["label"]] += 1
    return {"essays": len(essays), "words": words, "spans_per_label": {l: c.get(l, 0) for l in PERSUADE_LABELS}}


def write_jsonl(path: str, essays: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for e in essays:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Prepare PERSUADE 2.0 train/val JSONL (essay-level split).")
    ap.add_argument("--train-csv", required=True)
    ap.add_argument("--out-dir", required=True, help="Must be outside the git repository.")
    ap.add_argument("--val-fraction", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=13)
    a = ap.parse_args(argv)
    repo_marker = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    if os.path.abspath(a.out_dir).startswith(repo_marker + os.sep):
        print("Refusing to write dataset copies inside the repository. Choose --out-dir outside it.", file=sys.stderr)
        return 2
    os.makedirs(a.out_dir, exist_ok=True)

    essays, stats = build_essays(r for r in read_rows(a.train_csv) if r["competition_set"] in ("train", ""))
    essays, dups = dedupe(essays)
    train, val = split_by_essay(essays, a.val_fraction, a.seed)
    write_jsonl(os.path.join(a.out_dir, "train.jsonl"), train)
    write_jsonl(os.path.join(a.out_dir, "val.jsonl"), val)
    summary = {"seed": a.seed, "val_fraction": a.val_fraction, "read": stats, "duplicates_removed": dups, "train": summarise(train), "val": summarise(val)}
    with open(os.path.join(a.out_dir, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
