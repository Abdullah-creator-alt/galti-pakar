"""Export fine-tuned checkpoint to ONNX and perform int8 dynamic quantization for Vercel deployment budget audit."""

import os
import sys
import torch
from transformers import AutoTokenizer, AutoConfig, AutoModelForTokenClassification
import onnx
from onnxruntime.quantization import quantize_dynamic, QuantType

def export_and_quantize():
    ckpt_dir = os.path.expanduser("~/galti-pakar-data/persuade/checkpoints/checkpoint-balanced-epoch-2")
    output_dir = os.path.expanduser("~/galti-pakar-data/persuade/onnx")
    os.makedirs(output_dir, exist_ok=True)
    
    fp32_onnx_path = os.path.join(output_dir, "model_fp32.onnx")
    int8_onnx_path = os.path.join(output_dir, "model_int8.onnx")
    
    print(f"Loading checkpoint from {ckpt_dir} for ONNX export...")
    config = AutoConfig.from_pretrained(ckpt_dir)
    model = AutoModelForTokenClassification.from_config(config)
    weights = torch.load(os.path.join(ckpt_dir, "pytorch_model.bin"), map_location="cpu")
    model.load_state_dict(weights)
    model.eval()
    
    # Create dummy input on CPU
    dummy_input_ids = torch.randint(0, 1000, (1, 128), dtype=torch.long)
    dummy_attention_mask = torch.ones((1, 128), dtype=torch.long)
    
    print("Exporting PyTorch model to ONNX (FP32)...")
    torch.onnx.export(
        model,
        (dummy_input_ids, dummy_attention_mask),
        fp32_onnx_path,
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch_size", 1: "sequence_length"},
            "attention_mask": {0: "batch_size", 1: "sequence_length"},
            "logits": {0: "batch_size", 1: "sequence_length"}
        },
        opset_version=14,
        do_constant_folding=True
    )
    
    fp32_size_mb = os.path.getsize(fp32_onnx_path) / (1024 * 1024)
    print(f"ONNX FP32 exported: {fp32_onnx_path} ({fp32_size_mb:.2f} MB)")
    
    print("Quantizing ONNX model to INT8...")
    quantize_dynamic(
        model_input=fp32_onnx_path,
        model_output=int8_onnx_path,
        weight_type=QuantType.QInt8
    )
    
    int8_size_mb = os.path.getsize(int8_onnx_path) / (1024 * 1024)
    print(f"ONNX INT8 quantized: {int8_onnx_path} ({int8_size_mb:.2f} MB)")
    
    # Save budget verification JSON
    report = {
        "fp32_size_mb": round(fp32_size_mb, 2),
        "int8_size_mb": round(int8_size_mb, 2),
        "vercel_budget_ceiling_mb": 100.0,
        "within_budget": int8_size_mb <= 100.0
    }
    with open(os.path.join(output_dir, "deployment_audit.json"), "w") as f:
        import json
        json.dump(report, f, indent=2)
    print("\nAudit Summary:", report)

if __name__ == "__main__":
    export_and_quantize()
