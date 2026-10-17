"""Metrics and decoding for PERSUADE span evaluation."""

from typing import List, Dict, Any, Tuple
from collections import defaultdict
from persuade_prep.labels import BIO_TAGS, PERSUADE_LABELS


def decode_bio_to_spans(bio_tags: List[str], offsets: List[Tuple[int, int]], text: str) -> List[Dict[str, Any]]:
    """Decode a sequence of BIO tags and character offsets into span dictionaries."""
    spans = []
    current_label = None
    current_start = None
    current_end = None
    
    for tag, (start, end) in zip(bio_tags, offsets):
        if start == end:
            continue
            
        if tag.startswith("B-"):
            if current_label is not None:
                spans.append({
                    "label": current_label,
                    "start": current_start,
                    "end": current_end,
                    "text": text[current_start:current_end].strip()
                })
            current_label = tag[2:]
            current_start = start
            current_end = end
        elif tag.startswith("I-"):
            label = tag[2:]
            if current_label == label:
                current_end = end
            else:
                # Malformed sequence: treat as new span or close current
                if current_label is not None:
                    spans.append({
                        "label": current_label,
                        "start": current_start,
                        "end": current_end,
                        "text": text[current_start:current_end].strip()
                    })
                current_label = label
                current_start = start
                current_end = end
        else:  # "O" or invalid
            if current_label is not None:
                spans.append({
                    "label": current_label,
                    "start": current_start,
                    "end": current_end,
                    "text": text[current_start:current_end].strip()
                })
                current_label = None
                
    if current_label is not None:
        spans.append({
            "label": current_label,
            "start": current_start,
            "end": current_end,
            "text": text[current_start:current_end].strip()
        })
        
    return spans


def compute_span_overlap_iou(span_a: Tuple[int, int], span_b: Tuple[int, int]) -> float:
    """Compute character-level Intersection over Union between two spans."""
    start_a, end_a = span_a
    start_b, end_b = span_b
    
    intersect_start = max(start_a, start_b)
    intersect_end = min(end_a, end_b)
    intersection = max(0, intersect_end - intersect_start)
    
    union_start = min(start_a, start_b)
    union_end = max(end_a, end_b)
    union = max(0, union_end - union_start)
    
    if union == 0:
        return 0.0
    return intersection / union


def evaluate_spans(gold_spans_list: List[List[Dict[str, Any]]], pred_spans_list: List[List[Dict[str, Any]]], iou_threshold: float = 0.5):
    """Compute exact match and IoU >= threshold span metrics per class."""
    tp_exact = defaultdict(int)
    fp_exact = defaultdict(int)
    fn_exact = defaultdict(int)
    
    tp_iou = defaultdict(int)
    fp_iou = defaultdict(int)
    fn_iou = defaultdict(int)
    
    for gold_spans, pred_spans in zip(gold_spans_list, pred_spans_list):
        matched_gold_exact = set()
        matched_pred_exact = set()
        
        # Exact match
        for p_idx, p in enumerate(pred_spans):
            for g_idx, g in enumerate(gold_spans):
                if g_idx not in matched_gold_exact and p["label"] == g["label"] and p["start"] == g["start"] and p["end"] == g["end"]:
                    matched_gold_exact.add(g_idx)
                    matched_pred_exact.add(p_idx)
                    tp_exact[p["label"]] += 1
                    break
            if p_idx not in matched_pred_exact:
                fp_exact[p["label"]] += 1
                
        for g_idx, g in enumerate(gold_spans):
            if g_idx not in matched_gold_exact:
                fn_exact[g["label"]] += 1
                
        # IoU match
        matched_gold_iou = set()
        matched_pred_iou = set()
        for p_idx, p in enumerate(pred_spans):
            for g_idx, g in enumerate(gold_spans):
                if g_idx not in matched_gold_iou and p["label"] == g["label"]:
                    iou = compute_span_overlap_iou((p["start"], p["end"]), (g["start"], g["end"]))
                    if iou >= iou_threshold:
                        matched_gold_iou.add(g_idx)
                        matched_pred_iou.add(p_idx)
                        tp_iou[p["label"]] += 1
                        break
            if p_idx not in matched_pred_iou:
                fp_iou[p["label"]] += 1
                
        for g_idx, g in enumerate(gold_spans):
            if g_idx not in matched_gold_iou:
                fn_iou[g["label"]] += 1
                
    def calc_prf(tp, fp, fn):
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
        return prec, rec, f1

    results = {}
    f1_list_iou = []
    
    for label in PERSUADE_LABELS:
        prec_e, rec_e, f1_e = calc_prf(tp_exact[label], fp_exact[label], fn_exact[label])
        prec_i, rec_i, f1_i = calc_prf(tp_iou[label], fp_iou[label], fn_iou[label])
        results[label] = {
            "exact": {"p": round(prec_e, 4), "r": round(rec_e, 4), "f1": round(f1_e, 4)},
            "iou_0.5": {"p": round(prec_i, 4), "r": round(rec_i, 4), "f1": round(f1_i, 4)},
        }
        f1_list_iou.append(f1_i)
        
    macro_f1 = sum(f1_list_iou) / len(f1_list_iou) if f1_list_iou else 0.0
    return {"per_class": results, "macro_f1_iou": round(macro_f1, 4)}
