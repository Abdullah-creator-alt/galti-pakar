"""Phase 3 Evaluation Comparison:
Compares the specialized fine-tuned PERSUADE classifier vs the production Gemini extractor
at the sentence level using the standardized >= 50% character overlap rule on the same held-out essays.
"""

import os
import sys
import json
from collections import defaultdict
import torch
import pytorch_ocl
from transformers import AutoTokenizer, AutoConfig, AutoModelForTokenClassification

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from persuade_train.evaluate import run_inference
from persuade_prep.labels import GALTI_ROLE, PERSUADE_LABELS


def derive_sentence_label_from_spans(sentence, spans):
    """Given a sentence dict {start, end} and spans {start, end, label},
    assigns the label of the span that covers >= 50% of the sentence characters, else 'unlabelled'."""
    s_len = sentence["end"] - sentence["start"]
    if s_len <= 0:
        return "unlabelled"
        
    best_label = "unlabelled"
    best_coverage = 0.0
    
    for span in spans:
        intersect = max(0, min(sentence["end"], span["end"]) - max(sentence["start"], span["start"]))
        coverage = intersect / s_len
        if coverage >= 0.5 and coverage > best_coverage:
            best_coverage = coverage
            # Map through GALTI_ROLE
            role = GALTI_ROLE.get(span["label"])
            if role:
                best_label = role
            else:
                best_label = "unlabelled"
                
    return best_label


def map_gemini_role(role):
    """Map Gemini roles to comparable evaluation classes (merging evidence & premise)."""
    if role in ("evidence", "premise"):
        return "evidence"
    if role in ("thesis", "claim", "counterclaim", "rebuttal", "conclusion"):
        return role
    return "unlabelled"


def compute_metrics(gold_labels, pred_labels, classes):
    metrics = {}
    f1s = []
    for c in classes:
        tp = sum(1 for g, p in zip(gold_labels, pred_labels) if g == c and p == c)
        fp = sum(1 for g, p in zip(gold_labels, pred_labels) if g != c and p == c)
        fn = sum(1 for g, p in zip(gold_labels, pred_labels) if g == c and p != c)
        
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
        
        metrics[c] = {"precision": round(prec, 4), "recall": round(rec, 4), "f1": round(f1, 4), "support": sum(1 for g in gold_labels if g == c)}
        f1s.append(f1)
        
    macro_f1 = sum(f1s) / len(f1s) if f1s else 0.0
    return metrics, round(macro_f1, 4)


def main():
    cache_dir = os.path.abspath("training/persuade/artifacts/gemini_cache")
    val_file = os.path.expanduser("~/galti-pakar-data/persuade/prepared/val.jsonl")
    ckpt_dir = os.path.expanduser("~/galti-pakar-data/persuade/checkpoints/checkpoint-balanced-epoch-2")
    device = torch.device("ocl:0")
    
    print("=== Phase 3: Head-to-Head Comparison (Specialized Classifier vs Gemini) ===")
    print(f"Loading trained classifier from {ckpt_dir}...")
    tokenizer = AutoTokenizer.from_pretrained(ckpt_dir)
    config = AutoConfig.from_pretrained(ckpt_dir)
    model = AutoModelForTokenClassification.from_config(config)
    weights = torch.load(os.path.join(ckpt_dir, "pytorch_model.bin"), map_location="cpu")
    model.load_state_dict(weights)
    model = model.to(device)
    
    # Read gold essays
    essays_by_id = {}
    with open(val_file, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            item = json.loads(line)
            essays_by_id[item["essay_id"]] = item
            
    cached_files = [f for f in os.listdir(cache_dir) if f.endswith(".json")]
    print(f"Found {len(cached_files)} cached Gemini evaluation essays.")
    
    gold_all = []
    classifier_all = []
    gemini_all = []
    
    total_sentences = 0
    agreement_count = 0
    
    for cf in cached_files:
        with open(os.path.join(cache_dir, cf), "r", encoding="utf-8") as f:
            cache_data = json.load(f)
            
        if not cache_data.get("ok"):
            continue
            
        essay_id = cache_data["essay_id"]
        if essay_id not in essays_by_id:
            continue
            
        gold_item = essays_by_id[essay_id]
        gold_spans = gold_item.get("spans", [])
        text = gold_item["text"]
        sentences = cache_data["sentences"]
        
        # 1. Run classifier predictions
        pred_spans = run_inference(text, model, tokenizer, device)
        
        # 2. Derive sentence labels
        for s in sentences:
            s_dict = {"start": s["start"], "end": s["end"]}
            gold_lbl = derive_sentence_label_from_spans(s_dict, gold_spans)
            clf_lbl = derive_sentence_label_from_spans(s_dict, pred_spans)
            
            gem_raw_role = cache_data["sentenceRoles"].get(s["id"], "unlabelled")
            gem_lbl = map_gemini_role(gem_raw_role)
            
            gold_all.append(gold_lbl)
            classifier_all.append(clf_lbl)
            gemini_all.append(gem_lbl)
            
            total_sentences += 1
            if clf_lbl == gem_lbl:
                agreement_count += 1
                
    comparable_classes = ["thesis", "claim", "counterclaim", "rebuttal", "conclusion", "evidence"]
    
    clf_metrics, clf_macro_f1 = compute_metrics(gold_all, classifier_all, comparable_classes)
    gem_metrics, gem_macro_f1 = compute_metrics(gold_all, gemini_all, comparable_classes)
    
    print("\n" + "=" * 75)
    print(f"{'Role':<14} | {'Classifier F1':<14} | {'Gemini F1':<14} | {'Gold Count':<10}")
    print("-" * 75)
    for c in comparable_classes:
        c_f1 = clf_metrics[c]['f1']
        g_f1 = gem_metrics[c]['f1']
        count = clf_metrics[c]['support']
        print(f"{c:<14} | {c_f1:<14.4f} | {g_f1:<14.4f} | {count:<10}")
    print("-" * 75)
    print(f"{'Macro F1':<14} | {clf_macro_f1:<14.4f} | {gem_macro_f1:<14.4f} | Total Sentences: {total_sentences}")
    print(f"Classifier & Gemini Inter-System Agreement: {agreement_count}/{total_sentences} ({agreement_count/max(1, total_sentences)*100:.1f}%)")
    print("=" * 75)
    
    # Save comparison report
    report = {
        "total_sentences": total_sentences,
        "inter_system_agreement_rate": round(agreement_count / max(1, total_sentences), 4),
        "classifier": {"per_class": clf_metrics, "macro_f1": clf_macro_f1},
        "gemini": {"per_class": gem_metrics, "macro_f1": gem_macro_f1}
    }
    report_file = os.path.join(cache_dir, "phase3_comparison_report.json")
    with open(report_file, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nPhase 3 Comparison Report saved to {report_file}")

if __name__ == "__main__":
    main()
