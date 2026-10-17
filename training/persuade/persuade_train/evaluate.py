"""Run inference and validation evaluation on the trained PERSUADE checkpoint."""

import os
import sys
import json
import torch
import pytorch_ocl
from transformers import AutoTokenizer, AutoConfig, AutoModelForTokenClassification

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from persuade_train.metrics import decode_bio_to_spans, evaluate_spans
from persuade_prep.labels import BIO_TAGS, PERSUADE_LABELS


def run_inference(text: str, model, tokenizer, device, max_length=256, stride=128):
    """Run windowed sliding inference over essay text, returning decoded spans."""
    model.eval()
    encoding = tokenizer(
        text,
        return_offsets_mapping=True,
        truncation=False,
        add_special_tokens=False
    )
    input_ids = encoding["input_ids"]
    offset_mapping = encoding["offset_mapping"]
    total_tokens = len(input_ids)
    
    if total_tokens == 0:
        return []

    effective_max = max_length - 2
    cls_id = tokenizer.cls_token_id
    sep_id = tokenizer.sep_token_id
    pad_id = tokenizer.pad_token_id
    
    num_tags = len(BIO_TAGS)
    # Accumulate logits per token across overlapping windows
    token_logits = torch.zeros((total_tokens, num_tags), dtype=torch.float32)
    token_counts = torch.zeros((total_tokens, 1), dtype=torch.float32)

    start_idx = 0
    with torch.no_grad():
        while start_idx < total_tokens:
            end_idx = min(start_idx + effective_max, total_tokens)
            chunk_len = end_idx - start_idx
            
            chunk_ids = [cls_id] + input_ids[start_idx:end_idx] + [sep_id]
            chunk_mask = [1] * len(chunk_ids)
            
            pad_len = max_length - len(chunk_ids)
            if pad_len > 0:
                chunk_ids += [pad_id] * pad_len
                chunk_mask += [0] * pad_len
                
            in_t = torch.tensor([chunk_ids], dtype=torch.long, device=device)
            mask_t = torch.tensor([chunk_mask], dtype=torch.long, device=device)
            
            out = model(input_ids=in_t, attention_mask=mask_t)
            logits = out.logits[0].to("cpu")  # (max_length, num_tags)
            
            # Slice excluding [CLS] and [SEP]
            content_logits = logits[1:1+chunk_len]
            token_logits[start_idx:end_idx] += content_logits
            token_counts[start_idx:end_idx] += 1.0
            
            if end_idx == total_tokens:
                break
            start_idx += stride

    avg_logits = token_logits / token_counts.clamp(min=1.0)
    pred_tag_ids = torch.argmax(avg_logits, dim=-1).tolist()
    pred_bio_tags = [BIO_TAGS[idx] for idx in pred_tag_ids]
    
    return decode_bio_to_spans(pred_bio_tags, offset_mapping, text)


def main():
    ckpt_dir = os.path.expanduser("~/galti-pakar-data/persuade/checkpoints/checkpoint-balanced-epoch-2")
    val_file = os.path.expanduser("~/galti-pakar-data/persuade/prepared/val.jsonl")
    device_name = "ocl:0"
    device = torch.device(device_name)
    
    print(f"Loading checkpoint from {ckpt_dir}...")
    tokenizer = AutoTokenizer.from_pretrained(ckpt_dir)
    config = AutoConfig.from_pretrained(ckpt_dir)
    model = AutoModelForTokenClassification.from_config(config)
    
    weights = torch.load(os.path.join(ckpt_dir, "pytorch_model.bin"), map_location="cpu")
    model.load_state_dict(weights)
    model = model.to(device)
    print("Checkpoint successfully loaded onto ocl:0!")
    
    # 1. Quick test on a synthetic essay snippet
    sample_text = (
        "I strongly believe that community service should be mandatory in high school. "
        "First, volunteering helps students develop a strong sense of responsibility and empathy. "
        "Some might argue that students are already overburdened with academic workload. "
        "However, dedicating even one hour a week teaches time management and creates well-rounded individuals. "
        "Therefore, schools must incorporate community service into their graduation requirements."
    )
    print("\n--- Running Inference Test on Sample Essay ---")
    predicted_spans = run_inference(sample_text, model, tokenizer, device)
    for s in predicted_spans:
        print(f"[{s['label']}] (chars {s['start']}-{s['end']}): {s['text']}")
        
    # 2. Evaluation on 50 validation essays
    print("\n--- Evaluating on Validation Set (50 essays) ---")
    gold_list = []
    pred_list = []
    
    count = 0
    with open(val_file, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            item = json.loads(line)
            text = item["text"]
            gold_spans = item.get("spans", [])
            
            preds = run_inference(text, model, tokenizer, device)
            gold_list.append(gold_spans)
            pred_list.append(preds)
            
            count += 1
            if count >= 50:
                break
                
    metrics = evaluate_spans(gold_list, pred_list, iou_threshold=0.5)
    print("\nValidation Span-Level Metrics (IoU >= 0.5):")
    print(f"{'Class':<22} | {'Precision':<10} | {'Recall':<10} | {'F1':<10}")
    print("-" * 60)
    for label, res in metrics["per_class"].items():
        m = res["iou_0.5"]
        print(f"{label:<22} | {m['p']:<10.4f} | {m['r']:<10.4f} | {m['f1']:<10.4f}")
    print("-" * 60)
    print(f"Macro F1 (IoU >= 0.5): {metrics['macro_f1_iou']:.4f}")
    
    # Save evaluation report
    report_path = os.path.join(ckpt_dir, "evaluation_report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    print(f"\nEvaluation metrics saved to {report_path}")


if __name__ == "__main__":
    main()
