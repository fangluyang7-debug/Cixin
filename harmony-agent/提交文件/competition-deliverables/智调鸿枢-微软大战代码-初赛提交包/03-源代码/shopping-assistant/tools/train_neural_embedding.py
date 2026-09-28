#!/usr/bin/env python3
"""Train and export the real device-side neural text embedding model.

The student encoder is intentionally compact and operator-conservative:

    token ids -> Embedding -> masked mean -> Linear/ReLU/Linear -> L2 norm

It is distilled from the reproducible LSA teacher already generated from the
bundled 2700-product corpus. The exported TorchScript model is converted to a
MindSpore Lite .ms file by tools/convert_neural_embedding.ps1.
"""

from __future__ import annotations

import argparse
import base64
import json
import random
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as functional
from torch.utils.data import DataLoader, TensorDataset

from train_lsa_embedding import (
    corpus_fingerprint,
    extract_tokens,
    load_products,
    product_text,
    quantize_rows,
)


MODEL_VERSION = "soleai-neural-char-v1"
SEQUENCE_LENGTH = 48
HIDDEN_DIMENSION = 512
OUTPUT_DIMENSION = 256
SUPPORTED_DIMENSIONS = (16, 64, 256)
TRAINING_SEED = 20260725


class NeuralTextEncoder(nn.Module):
    def __init__(self, vocabulary_size: int) -> None:
        super().__init__()
        self.embedding = nn.Embedding(
            vocabulary_size + 1,
            HIDDEN_DIMENSION,
            padding_idx=0,
        )
        self.hidden = nn.Linear(HIDDEN_DIMENSION, HIDDEN_DIMENSION)
        self.output = nn.Linear(HIDDEN_DIMENSION, OUTPUT_DIMENSION)

    def forward(self, token_ids: torch.Tensor) -> torch.Tensor:
        indexes = token_ids.to(torch.int64)
        mask = (indexes != 0).to(torch.float32).unsqueeze(-1)
        embedded = self.embedding(indexes) * mask
        token_count = torch.clamp(mask.sum(dim=1), min=1.0)
        pooled = embedded.sum(dim=1) / token_count
        projected = self.output(torch.relu(self.hidden(pooled)))
        norm = torch.clamp(
            torch.sqrt(torch.sum(projected * projected, dim=1, keepdim=True)),
            min=1.0e-6,
        )
        return projected / norm


def set_deterministic_seed() -> None:
    random.seed(TRAINING_SEED)
    np.random.seed(TRAINING_SEED)
    torch.manual_seed(TRAINING_SEED)
    torch.use_deterministic_algorithms(True)


def decode_teacher_vectors(artifact: dict[str, object]) -> np.ndarray:
    product_count = int(artifact["productCount"])
    dimension = int(artifact["embeddingDimension"])
    quantized = np.frombuffer(
        base64.b64decode(str(artifact["quantizedProductVectorsBase64"])),
        dtype=np.int8,
    ).reshape(product_count, dimension)
    scales = np.asarray(artifact["productScales"], dtype=np.float32)
    vectors = quantized.astype(np.float32) * scales[:, None]
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return (vectors / norms).astype(np.float32)


def encode_token_ids(text: str, vocabulary_index: dict[str, int]) -> np.ndarray:
    token_ids = np.zeros(SEQUENCE_LENGTH, dtype=np.int32)
    write_index = 0
    for token in extract_tokens(text):
        token_id = vocabulary_index.get(token)
        if token_id is None:
            continue
        token_ids[write_index] = token_id
        write_index += 1
        if write_index >= SEQUENCE_LENGTH:
            break
    return token_ids


def multi_resolution_loss(
    predictions: torch.Tensor,
    targets: torch.Tensor,
) -> torch.Tensor:
    loss = torch.zeros((), dtype=predictions.dtype, device=predictions.device)
    weights = (0.20, 0.30, 0.50)
    for dimension, weight in zip(SUPPORTED_DIMENSIONS, weights):
        predicted_prefix = functional.normalize(predictions[:, :dimension], dim=1)
        target_prefix = functional.normalize(targets[:, :dimension], dim=1)
        loss = loss + weight * (1.0 - (predicted_prefix * target_prefix).sum(dim=1)).mean()
    return loss + 0.05 * functional.mse_loss(predictions, targets)


def infer_batches(model: nn.Module, token_ids: np.ndarray) -> np.ndarray:
    outputs: list[np.ndarray] = []
    model.eval()
    with torch.no_grad():
        for start in range(0, len(token_ids), 256):
            batch = torch.from_numpy(token_ids[start : start + 256])
            outputs.append(model(batch).cpu().numpy())
    return np.concatenate(outputs, axis=0).astype(np.float32)


def train(arguments: argparse.Namespace) -> None:
    set_deterministic_seed()
    products = load_products(arguments.rawfile_dir)
    teacher_artifact = json.loads(arguments.teacher_artifact.read_text(encoding="utf-8"))
    vocabulary = list(teacher_artifact["vocabulary"])
    vocabulary_index = {token: index + 1 for index, token in enumerate(vocabulary)}
    teacher_vectors = decode_teacher_vectors(teacher_artifact)
    token_ids = np.stack(
        [
            encode_token_ids(product_text(product), vocabulary_index)
            for product in products
        ]
    )

    model = NeuralTextEncoder(len(vocabulary))
    optimizer = torch.optim.AdamW(model.parameters(), lr=2.0e-3, weight_decay=1.0e-5)
    dataset = TensorDataset(
        torch.from_numpy(token_ids),
        torch.from_numpy(teacher_vectors),
    )
    generator = torch.Generator().manual_seed(TRAINING_SEED)
    loader = DataLoader(
        dataset,
        batch_size=arguments.batch_size,
        shuffle=True,
        generator=generator,
        num_workers=0,
    )

    model.train()
    for epoch in range(arguments.epochs):
        running_loss = 0.0
        for batch_ids, batch_targets in loader:
            optimizer.zero_grad(set_to_none=True)
            predictions = model(batch_ids)
            loss = multi_resolution_loss(predictions, batch_targets)
            loss.backward()
            optimizer.step()
            running_loss += float(loss.detach())
        if epoch == 0 or (epoch + 1) % 10 == 0 or epoch + 1 == arguments.epochs:
            print(f"epoch={epoch + 1} loss={running_loss / len(loader):.6f}")

    product_vectors = infer_batches(model, token_ids)
    dimension_cosines: dict[str, float] = {}
    for dimension in SUPPORTED_DIMENSIONS:
        student = product_vectors[:, :dimension]
        teacher = teacher_vectors[:, :dimension]
        student /= np.maximum(np.linalg.norm(student, axis=1, keepdims=True), 1.0e-6)
        teacher /= np.maximum(np.linalg.norm(teacher, axis=1, keepdims=True), 1.0e-6)
        dimension_cosines[str(dimension)] = float(np.mean(np.sum(student * teacher, axis=1)))

    quantized_products, product_scales = quantize_rows(product_vectors)
    validation_texts = [
        "推荐适合学生的5000元电脑",
        "耐克运动鞋",
        "男生通勤鞋",
    ]
    validation_ids = np.stack(
        [encode_token_ids(text, vocabulary_index) for text in validation_texts]
    )
    validation_vectors = infer_batches(model, validation_ids)

    artifact = {
        "formatVersion": 2,
        "modelId": "soleai_neural_text_embedding",
        "modelVersion": MODEL_VERSION,
        "modelFile": arguments.model_file_name,
        "encoderType": "MINDSPORE_LITE_EMBEDDING_MEAN_MLP",
        "teacherModelVersion": teacher_artifact["modelVersion"],
        "trainingSeed": TRAINING_SEED,
        "productCount": len(products),
        "vocabularySize": len(vocabulary),
        "sequenceLength": SEQUENCE_LENGTH,
        "hiddenDimension": HIDDEN_DIMENSION,
        "embeddingDimension": OUTPUT_DIMENSION,
        "supportedDimensions": list(SUPPORTED_DIMENSIONS),
        "corpusSha256": corpus_fingerprint(products),
        "meanTeacherCosineByDimension": dimension_cosines,
        "vocabulary": vocabulary,
        "productExternalIds": [product["externalId"] for product in products],
        "productScales": product_scales.tolist(),
        "quantizedProductVectorsBase64": base64.b64encode(
            quantized_products.tobytes(order="C")
        ).decode("ascii"),
        "validationQueries": [
            {
                "text": text,
                "tokenIds": validation_ids[index].tolist(),
                "embedding": validation_vectors[index].tolist(),
            }
            for index, text in enumerate(validation_texts)
        ],
    }

    arguments.output_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = arguments.output_dir / arguments.artifact_file_name
    torchscript_path = arguments.output_dir / arguments.torchscript_file_name
    artifact_path.write_text(
        json.dumps(artifact, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    model.eval()
    example = torch.zeros((1, SEQUENCE_LENGTH), dtype=torch.int32)
    traced = torch.jit.trace(model, example, strict=True)
    traced.save(str(torchscript_path))

    print(f"model_version={MODEL_VERSION}")
    print(f"parameters={sum(parameter.numel() for parameter in model.parameters())}")
    print(f"torchscript_bytes={torchscript_path.stat().st_size}")
    print(f"artifact_bytes={artifact_path.stat().st_size}")
    print(f"mean_teacher_cosine={dimension_cosines}")
    print(f"torchscript={torchscript_path}")
    print(f"artifact={artifact_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rawfile-dir", type=Path, required=True)
    parser.add_argument("--teacher-artifact", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument(
        "--torchscript-file-name",
        default="soleai_neural_embedding_v1.pt",
    )
    parser.add_argument(
        "--artifact-file-name",
        default="soleai_neural_embedding_v1.json",
    )
    parser.add_argument(
        "--model-file-name",
        default="soleai_neural_embedding_v1.ms",
    )
    train(parser.parse_args())


if __name__ == "__main__":
    main()
