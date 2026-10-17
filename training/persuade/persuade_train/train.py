"""Main training and benchmark execution script for PERSUADE span classifier."""

import os
import sys
import time
import json
import argparse
import math
import torch
import pytorch_ocl
import torch.nn as nn
from torch.utils.data import DataLoader
from transformers import AutoTokenizer

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from persuade_train.model import get_compatible_model
from persuade_train.dataset import PersuadeDataset
from persuade_train.metrics import decode_bio_to_spans, evaluate_spans
from persuade_prep.labels import BIO_TAGS, TAG_TO_ID, PERSUADE_LABELS


def compute_class_weights(device) -> torch.Tensor:
    """Compute smoothed inverse-frequency class weights for the 15 BIO tags based on dataset counts."""
    # Approximate span counts from summary.json
    span_counts = {
        "Lead": 8328,
        "Position": 13776,
        "Claim": 44973,
        "Counterclaim": 5225,
        "Rebuttal": 3896,
        "Evidence": 40911,
        "Concluding Statement": 12087
    }
    
    # Base count for O (unannotated tokens are frequent)
    tag_counts = [50000.0]  # O
    for label in PERSUADE_LABELS:
        count = float(span_counts.get(label, 5000))
        tag_counts.append(count)        # B-label
        tag_counts.append(count * 5.0)  # I-label (spans are multi-token)
        
    total = sum(tag_counts)
    num_classes = len(BIO_TAGS)
    
    # Smoothed inverse frequency (square root damping to avoid overly extreme spikes)
    weights = []
    for count in tag_counts:
        w = math.sqrt(total / (num_classes * count))
        weights.append(w)
        
    weights_tensor = torch.tensor(weights, dtype=torch.float32, device="cpu").to(device)
    print("Class weights initialized (O, B-Lead, I-Lead, ..., B-Rebuttal, I-Rebuttal):")
    print([round(w, 2) for w in weights])
    return weights_tensor


def collate_fn(batch):
    input_ids = torch.stack([item["input_ids"] for item in batch])
    attention_mask = torch.stack([item["attention_mask"] for item in batch])
    labels = torch.stack([item["labels"] for item in batch])
    return {
        "input_ids": input_ids,
        "attention_mask": attention_mask,
        "labels": labels
    }


def main():
    parser = argparse.ArgumentParser(description="Train PERSUADE argument span classifier on OpenCL")
    parser.add_argument("--data-dir", default=os.path.expanduser("~/galti-pakar-data/persuade/prepared"))
    parser.add_argument("--output-dir", default=os.path.expanduser("~/galti-pakar-data/persuade/checkpoints"))
    parser.add_argument("--model-name", default="distilbert/distilbert-base-uncased")
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--max-length", type=int, default=256)
    parser.add_argument("--lr", type=float, default=3e-5)
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--max-train-samples", type=int, default=500, help="Train on 500 diverse essays")
    parser.add_argument("--device", default="ocl:0")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    device = torch.device(args.device)

    print(f"=== Initializing Balanced Training ===")
    print(f"Device: {args.device}")
    print(f"Model: {args.model_name}")
    print(f"Batch size: {args.batch_size}, Max length: {args.max_length}, Epochs: {args.epochs}")

    tokenizer = AutoTokenizer.from_pretrained(args.model_name)
    model, config = get_compatible_model(args.model_name, num_labels=len(BIO_TAGS), device_name=args.device)

    train_path = os.path.join(args.data_dir, "train.jsonl")
    if not os.path.exists(train_path):
        print(f"Error: dataset path not found at {train_path}")
        sys.exit(1)

    train_ds = PersuadeDataset(train_path, tokenizer, max_length=args.max_length, max_samples=args.max_train_samples)
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, collate_fn=collate_fn)

    # Weighted CrossEntropyLoss
    class_weights = compute_class_weights(device)
    loss_fn = nn.CrossEntropyLoss(weight=class_weights, ignore_index=-100)

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)

    print("\n--- Starting Balanced Training Loop ---")
    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        step_count = 0
        epoch_start = time.perf_counter()

        for batch in train_loader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["labels"].to(device)

            optimizer.zero_grad()
            outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            logits = outputs.logits  # (batch_size, seq_len, num_labels)
            
            # Compatible weighted loss for OpenCL:
            flat_logits = logits.view(-1, len(BIO_TAGS))
            flat_labels = labels.view(-1)
            valid_mask = (flat_labels != -100)
            
            active_logits = flat_logits[valid_mask]
            active_labels = flat_labels[valid_mask]
            
            log_probs = torch.nn.functional.log_softmax(active_logits, dim=-1)
            nll_loss = torch.nn.functional.nll_loss(log_probs, active_labels, reduction='none')
            sample_weights = class_weights[active_labels]
            loss = (nll_loss * sample_weights).sum() / sample_weights.sum()
            
            loss.backward()
            optimizer.step()

            total_loss += loss.item()
            step_count += 1

            if step_count % 25 == 0:
                print(f"Epoch {epoch} | Step {step_count} | Loss: {loss.item():.4f}")

        avg_train_loss = total_loss / max(1, step_count)
        epoch_duration = time.perf_counter() - epoch_start
        print(f"\nEpoch {epoch} complete | Avg Loss: {avg_train_loss:.4f} | Duration: {epoch_duration:.1f}s")

        # Save checkpoint
        ckpt_dir = os.path.join(args.output_dir, f"checkpoint-balanced-epoch-{epoch}")
        os.makedirs(ckpt_dir, exist_ok=True)
        torch.save(model.state_dict(), os.path.join(ckpt_dir, "pytorch_model.bin"))
        config.save_pretrained(ckpt_dir)
        tokenizer.save_pretrained(ckpt_dir)
        print(f"Checkpoint saved to {ckpt_dir}")

    print("\nBalanced training completed successfully!")


if __name__ == "__main__":
    main()
