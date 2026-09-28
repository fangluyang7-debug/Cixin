#!/usr/bin/env python3
"""Export the trained TorchScript embedding model to checked ONNX."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import onnx
import onnxruntime
import torch


SEQUENCE_LENGTH = 48


def export(torchscript_path: Path, output_path: Path) -> None:
    model = torch.jit.load(str(torchscript_path), map_location="cpu")
    model.eval()
    example = torch.zeros((1, SEQUENCE_LENGTH), dtype=torch.int32)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        example,
        str(output_path),
        input_names=["token_ids"],
        output_names=["embedding"],
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )

    onnx_model = onnx.load(str(output_path))
    onnx.checker.check_model(onnx_model)

    token_ids = np.zeros((1, SEQUENCE_LENGTH), dtype=np.int32)
    token_ids[0, :6] = np.asarray([1, 2, 3, 4, 5, 6], dtype=np.int32)
    with torch.no_grad():
        torch_output = model(torch.from_numpy(token_ids)).numpy()
    session = onnxruntime.InferenceSession(
        str(output_path),
        providers=["CPUExecutionProvider"],
    )
    onnx_output = session.run(["embedding"], {"token_ids": token_ids})[0]
    max_difference = float(np.max(np.abs(torch_output - onnx_output)))
    if max_difference > 1.0e-5:
        raise RuntimeError(f"ONNX validation mismatch: {max_difference}")

    print(f"onnx_bytes={output_path.stat().st_size}")
    print(f"max_torch_onnx_difference={max_difference:.9f}")
    print(f"onnx={output_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--torchscript", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    export(arguments.torchscript, arguments.output)


if __name__ == "__main__":
    main()
