"""Dataset and chunking utilities for PERSUADE span classifier."""

import json
from typing import List, Dict, Any, Generator
import torch
from torch.utils.data import IterableDataset

from persuade_prep.labels import BIO_TAGS, TAG_TO_ID


def spans_to_bio(text: str, spans: List[Dict[str, Any]], offset_mapping: List[tuple]) -> List[int]:
    """Given original text, character spans with labels, and token offset mappings,
    returns the list of BIO tag IDs for each token. Special tokens (0, 0) get -100."""
    labels = []
    
    # Sort spans by start
    sorted_spans = sorted(spans, key=lambda s: s["start"])
    
    for start, end in offset_mapping:
        if start == end:  # special tokens like [CLS], [SEP], padding
            labels.append(-100)
            continue
            
        matched_span = None
        is_start = False
        
        for s in sorted_spans:
            s_start, s_end, s_label = s["start"], s["end"], s["label"]
            if s_start <= start < s_end:
                matched_span = s
                # First token of span gets B-, subsequent get I-
                # Token starts at or very close to span start
                if start == s_start or start - s_start <= 2:
                    is_start = True
                break
            elif start < s_start:
                break
                
        if matched_span:
            prefix = "B" if is_start else "I"
            tag = f"{prefix}-{matched_span['label']}"
            labels.append(TAG_TO_ID.get(tag, TAG_TO_ID["O"]))
        else:
            labels.append(TAG_TO_ID["O"])
            
    return labels


class PersuadeDataset(IterableDataset):
    """Streaming chunked dataset over prepared jsonl files."""
    def __init__(self, jsonl_path: str, tokenizer, max_length: int = 256, stride: int = 64, max_samples: int = None):
        self.jsonl_path = jsonl_path
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.stride = stride
        self.max_samples = max_samples

    def __iter__(self) -> Generator[Dict[str, torch.Tensor], None, None]:
        count = 0
        with open(self.jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                item = json.loads(line)
                text = item["text"]
                spans = item.get("spans", [])
                
                # Tokenize full text with offsets
                encoding = self.tokenizer(
                    text,
                    return_offsets_mapping=True,
                    truncation=False,
                    add_special_tokens=False
                )
                
                input_ids = encoding["input_ids"]
                offset_mapping = encoding["offset_mapping"]
                
                # Create BIO tags for each token
                token_labels = spans_to_bio(text, spans, offset_mapping)
                
                # Chunk with sliding window
                total_tokens = len(input_ids)
                cls_id = self.tokenizer.cls_token_id
                sep_id = self.tokenizer.sep_token_id
                
                effective_max = self.max_length - 2  # room for [CLS] and [SEP]
                
                start_idx = 0
                while start_idx < total_tokens:
                    end_idx = min(start_idx + effective_max, total_tokens)
                    
                    chunk_ids = [cls_id] + input_ids[start_idx:end_idx] + [sep_id]
                    chunk_mask = [1] * len(chunk_ids)
                    chunk_labels = [-100] + token_labels[start_idx:end_idx] + [-100]
                    chunk_offsets = [(0, 0)] + offset_mapping[start_idx:end_idx] + [(0, 0)]
                    
                    # Pad to max_length
                    pad_len = self.max_length - len(chunk_ids)
                    if pad_len > 0:
                        chunk_ids += [self.tokenizer.pad_token_id] * pad_len
                        chunk_mask += [0] * pad_len
                        chunk_labels += [-100] * pad_len
                        chunk_offsets += [(0, 0)] * pad_len
                        
                    yield {
                        "input_ids": torch.tensor(chunk_ids, dtype=torch.long),
                        "attention_mask": torch.tensor(chunk_mask, dtype=torch.long),
                        "labels": torch.tensor(chunk_labels, dtype=torch.long),
                    }
                    
                    if end_idx == total_tokens:
                        break
                    start_idx += self.stride
                    
                count += 1
                if self.max_samples and count >= self.max_samples:
                    break
