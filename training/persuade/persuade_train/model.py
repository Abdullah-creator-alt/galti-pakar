"""Model definition and OpenCL-compatible helpers for PERSUADE span classifier."""

import os
import torch
import pytorch_ocl
import torch.nn as nn
from transformers import AutoConfig, AutoModelForTokenClassification

from persuade_prep.labels import BIO_TAGS


def get_compatible_model(model_name: str = "distilbert/distilbert-base-uncased", num_labels: int = len(BIO_TAGS), device_name: str = "ocl:0"):
    """Instantiate a DistilBERT token classifier with ReLU activation for OpenCL rusticl,
    transferring official pretrained transformer weights from HuggingFace to accelerate convergence."""
    config = AutoConfig.from_pretrained(model_name, num_labels=num_labels)
    config.activation = "relu"
    
    print(f"Instantiating model {model_name} with ReLU on CPU...")
    model = AutoModelForTokenClassification.from_config(config)
    
    # Load pretrained weights into the compatible model
    print(f"Loading pretrained weights from {model_name}...")
    try:
        pretrained = AutoModelForTokenClassification.from_pretrained(model_name, num_labels=num_labels, ignore_mismatched_sizes=True)
        # Copy matching state dict keys (embeddings, attention, feedforward layers)
        pretrained_dict = pretrained.state_dict()
        model_dict = model.state_dict()
        
        # Filter out keys with size mismatch (like classifier head)
        filtered_dict = {
            k: v for k, v in pretrained_dict.items()
            if k in model_dict and model_dict[k].shape == v.shape
        }
        model_dict.update(filtered_dict)
        model.load_state_dict(model_dict)
        print(f"Successfully transferred {len(filtered_dict)}/{len(model_dict)} pretrained weight tensors!")
    except Exception as e:
        print(f"Notice: proceeding with architecture weights due to: {e}")
    
    device = torch.device(device_name)
    print(f"Transferring model to {device_name}...")
    model = model.to(device)
    
    return model, config
