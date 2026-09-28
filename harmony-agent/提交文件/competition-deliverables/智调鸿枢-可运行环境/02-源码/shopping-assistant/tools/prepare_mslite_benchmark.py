#!/usr/bin/env python3
"""Create MindSpore Lite benchmark input and golden output files."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np


def prepare(artifact_path: Path, output_dir: Path) -> None:
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    validation = artifact["validationQueries"][0]
    token_ids = np.asarray(validation["tokenIds"], dtype=np.int32).reshape(1, -1)
    embedding = np.asarray(validation["embedding"], dtype=np.float32).reshape(1, -1)

    output_dir.mkdir(parents=True, exist_ok=True)
    input_path = output_dir / "neural_embedding_input.bin"
    golden_path = output_dir / "neural_embedding_output.out"
    token_ids.tofile(input_path)
    golden_path.write_text(
        f"embedding 2 1 {embedding.shape[1]}\n"
        + " ".join(f"{value:.9g}" for value in embedding.reshape(-1))
        + "\n",
        encoding="utf-8",
    )
    print(f"input={input_path}")
    print(f"golden={golden_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    arguments = parser.parse_args()
    prepare(arguments.artifact, arguments.output_dir)


if __name__ == "__main__":
    main()
