from __future__ import annotations

import base64
import hashlib
import io
import os
import threading
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from PIL import Image, ImageOps
from pydantic import BaseModel, Field


class ExtractSubjectOptions(BaseModel):
    detectionClasses: list[str] | str | None = None
    detectionConf: float | None = None
    cropPadding: float | None = None
    squarePadColor: list[int] | None = None
    manualBboxNorm: list[float] | None = None
    outputSize: int | None = None
    jpegQuality: int | None = None


class ImagePayload(BaseModel):
    imageUrl: str | None = None
    imageBase64: str | None = None
    localImagePath: str | None = None
    text: str | None = None
    textHint: str | None = None
    role: str | None = None
    productId: str | None = None
    styleId: str | None = None
    tags: dict[str, Any] = Field(default_factory=dict)
    debugOptions: ExtractSubjectOptions | None = None


class ExtractSubjectResponse(BaseModel):
    strategy: str
    usedOriginalImage: bool
    confidence: float
    bboxPx: list[int] | None
    bboxNorm: list[float] | None
    imageWidth: int
    imageHeight: int
    croppedImageBase64: str
    contentType: str
    metadata: dict[str, Any]


class EmbeddingResponse(BaseModel):
    provider: str
    modelName: str
    dimension: int
    vector: list[float]
    vectorHash: str


class ExtractAndEmbedResponse(BaseModel):
    subject: ExtractSubjectResponse
    embedding: EmbeddingResponse


@dataclass
class SubjectCrop:
    image: Image.Image
    strategy: str
    used_original: bool
    confidence: float
    bbox_px: list[int] | None
    bbox_norm: list[float] | None
    metadata: dict[str, Any]


class ModelRegistry:
    def __init__(self) -> None:
        self.device = self._resolve_device()
        self.detector = None
        self.detector_classes: tuple[str, ...] | None = None
        self.detector_lock = threading.Lock()
        self.embedding_model = None
        self.embedding_preprocess = None
        self.embedding_tokenizer = None
        self.embedding_model_name = os.getenv("IMAGE_WORKER_EMBEDDING_MODEL", "ViT-B-32")
        self.embedding_pretrained = os.getenv(
            "IMAGE_WORKER_EMBEDDING_PRETRAINED",
            "laion2b_s34b_b79k",
        )

    def health(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "service": "image-worker",
            "cudaAvailable": torch.cuda.is_available(),
            "device": str(self.device),
            "gpuName": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "detectionModelLoaded": self.detector is not None,
            "embeddingModelLoaded": self.embedding_model is not None,
            "embeddingModel": self.model_name_for_api(),
            "embeddingDimension": int(os.getenv("IMAGE_WORKER_EMBEDDING_DIMENSION", "512")),
        }

    def model_name_for_api(self) -> str:
        return f"open_clip:{self.embedding_model_name}:{self.embedding_pretrained}"

    def warmup_detector(self) -> None:
        with self.detector_lock:
            self._detector(self._det_classes(None, "query"))

    def detect_subject(
        self,
        image: Image.Image,
        options: ExtractSubjectOptions | None = None,
        role: str | None = None,
    ) -> SubjectCrop:
        original = ImageOps.exif_transpose(image).convert("RGB")
        width, height = original.size
        classes = self._det_classes(options, role)
        detection_conf = self._det_conf(options, role)
        crop_padding = self._crop_padding(options)
        pad_color = self._square_pad_color(options)
        output_size = self._output_size(options)
        jpeg_quality = self._jpeg_quality(options)
        option_metadata = {
            "detectionModel": os.getenv("IMAGE_WORKER_DETECTION_MODEL", "yolov8s-world.pt"),
            "classes": classes,
            "detectionConf": detection_conf,
            "cropPadding": crop_padding,
            "squarePadColor": list(pad_color),
            "outputSize": output_size,
            "jpegQuality": jpeg_quality,
        }
        manual_bbox = self._manual_bbox_px(options, width, height)
        if manual_bbox:
            crop, bbox_px = self._crop_with_padding(original, manual_bbox, crop_padding)
            return SubjectCrop(
                image=self._standardize_output(self._square_pad(crop, pad_color), output_size),
                strategy="manual_bbox_crop_v1",
                used_original=False,
                confidence=1.0,
                bbox_px=bbox_px,
                bbox_norm=[
                    round(bbox_px[0] / width, 6),
                    round(bbox_px[1] / height, 6),
                    round(bbox_px[2] / width, 6),
                    round(bbox_px[3] / height, 6),
                ],
                metadata={
                    **option_metadata,
                    "manualBboxNorm": options.manualBboxNorm if options else None,
                },
            )
        try:
            with self.detector_lock:
                detector = self._detector(classes)
                results = detector.predict(
                    original,
                    verbose=False,
                    conf=detection_conf,
                    device=str(self.device),
                )
            boxes = []
            if results and getattr(results[0], "boxes", None) is not None:
                result_boxes = results[0].boxes
                xyxy = result_boxes.xyxy.detach().cpu().tolist()
                confs = result_boxes.conf.detach().cpu().tolist()
                class_ids = result_boxes.cls.detach().cpu().tolist()
                names = getattr(results[0], "names", {})
                for bbox, conf, class_id in zip(xyxy, confs, class_ids):
                    x1, y1, x2, y2 = [float(v) for v in bbox]
                    area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
                    class_index = int(class_id)
                    selected_class = (
                        names.get(class_index)
                        if isinstance(names, dict)
                        else names[class_index]
                    )
                    boxes.append(
                        (
                            conf * max(area, 1.0),
                            conf,
                            [x1, y1, x2, y2],
                            class_index,
                            str(selected_class),
                        )
                    )
            if boxes:
                ranked_boxes = sorted(boxes, key=lambda item: item[0], reverse=True)
                _, confidence, bbox, class_index, selected_class = ranked_boxes[0]
                same_class_min_confidence = max(
                    detection_conf,
                    float(confidence) * 0.35,
                )
                same_class_boxes = [
                    item[2]
                    for item in ranked_boxes
                    if item[4] == selected_class
                    and float(item[1]) >= same_class_min_confidence
                ]
                bbox = self._union_bboxes(same_class_boxes or [bbox])
                crop, bbox_px = self._crop_with_padding(original, bbox, crop_padding)
                return SubjectCrop(
                    image=self._standardize_output(self._square_pad(crop, pad_color), output_size),
                    strategy="yolo_world_bbox_crop_v1",
                    used_original=False,
                    confidence=float(confidence),
                    bbox_px=bbox_px,
                    bbox_norm=[
                        round(bbox_px[0] / width, 6),
                        round(bbox_px[1] / height, 6),
                        round(bbox_px[2] / width, 6),
                        round(bbox_px[3] / height, 6),
                    ],
                    metadata={
                        **option_metadata,
                        "selectedClass": selected_class,
                        "selectedClassIndex": class_index,
                        "combinedDetectionCount": len(same_class_boxes) or 1,
                        "detections": [
                            {
                                "class": item[4],
                                "classIndex": item[3],
                                "confidence": round(float(item[1]), 6),
                                "bboxPx": [
                                    round(float(value), 2) for value in item[2]
                                ],
                            }
                            for item in ranked_boxes[:5]
                        ],
                    },
                )
        except Exception as exc:  # fallback is explicit and observable
            return self._original_subject(
                original,
                f"detector_error:{type(exc).__name__}",
                pad_color,
                option_metadata,
            )

        return self._original_subject(
            original,
            "no_subject_detected",
            pad_color,
            option_metadata,
        )

    def embed_image(self, image: Image.Image) -> EmbeddingResponse:
        model, preprocess, _ = self._embedding()
        image_tensor = preprocess(ImageOps.exif_transpose(image).convert("RGB")).unsqueeze(0).to(self.device)
        with torch.inference_mode():
            features = model.encode_image(image_tensor)
            features = features / features.norm(dim=-1, keepdim=True)
        vector = [round(float(v), 8) for v in features.squeeze(0).detach().cpu().tolist()]
        return self._embedding_response(vector)

    def embed_image_with_text(self, image: Image.Image, text: str) -> EmbeddingResponse:
        model, preprocess, tokenizer = self._embedding()
        image_tensor = preprocess(ImageOps.exif_transpose(image).convert("RGB")).unsqueeze(0).to(self.device)
        text_tokens = tokenizer([text]).to(self.device)
        with torch.inference_mode():
            image_features = model.encode_image(image_tensor)
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            text_features = model.encode_text(text_tokens)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            features = image_features + text_features
            features = features / features.norm(dim=-1, keepdim=True)
        vector = [round(float(v), 8) for v in features.squeeze(0).detach().cpu().tolist()]
        return self._embedding_response(vector)

    def embed_text(self, text: str) -> EmbeddingResponse:
        model, _, tokenizer = self._embedding()
        tokens = tokenizer([text]).to(self.device)
        with torch.inference_mode():
            features = model.encode_text(tokens)
            features = features / features.norm(dim=-1, keepdim=True)
        vector = [round(float(v), 8) for v in features.squeeze(0).detach().cpu().tolist()]
        return self._embedding_response(vector)

    def _embedding_response(self, vector: list[float]) -> EmbeddingResponse:
        vector_hash = hashlib.sha256(str(vector).encode("utf-8")).hexdigest()
        return EmbeddingResponse(
            provider="local_gpu_worker",
            modelName=self.model_name_for_api(),
            dimension=len(vector),
            vector=vector,
            vectorHash=vector_hash,
        )

    def _resolve_device(self) -> torch.device:
        configured = os.getenv("IMAGE_WORKER_DEVICE", "auto")
        if configured == "auto":
            return torch.device("cuda" if torch.cuda.is_available() else "cpu")
        return torch.device(configured)

    def _detector(self, classes: list[str]):
        if self.detector is None:
            from ultralytics import YOLOWorld

            model_name = os.getenv("IMAGE_WORKER_DETECTION_MODEL", "yolov8s-world.pt")
            self.detector = YOLOWorld(model_name)
        class_key = tuple(classes)
        if self.detector_classes != class_key:
            self.detector.set_classes(classes)
            self.detector_classes = class_key
        return self.detector

    def _embedding(self):
        if self.embedding_model is None:
            import open_clip

            model, _, preprocess = open_clip.create_model_and_transforms(
                self.embedding_model_name,
                pretrained=self.embedding_pretrained,
                device=self.device,
            )
            model.eval()
            self.embedding_model = model
            self.embedding_preprocess = preprocess
            self.embedding_tokenizer = open_clip.get_tokenizer(self.embedding_model_name)
        return self.embedding_model, self.embedding_preprocess, self.embedding_tokenizer

    def _det_classes(
        self,
        options: ExtractSubjectOptions | None = None,
        role: str | None = None,
    ) -> list[str]:
        if options and options.detectionClasses:
            raw_option = options.detectionClasses
            if isinstance(raw_option, str):
                items = raw_option.split(",")
            else:
                items = raw_option
            classes = [str(item).strip() for item in items if str(item).strip()]
            if classes:
                return classes
        if role == "query":
            raw = os.getenv(
                "IMAGE_WORKER_QUERY_DETECTION_CLASSES",
                "shoe,camera,headphones,smartwatch,mobile phone,laptop,tablet,keyboard,computer mouse,electronics",
            )
        else:
            raw = os.getenv(
                "IMAGE_WORKER_DETECTION_CLASSES",
                "shoe,sneaker,boot,sandal,camera,headphones,earphones,earbuds,headset,watch,smartwatch,cell phone,mobile phone,smartphone,laptop,computer,tablet,keyboard,computer keyboard,computer mouse,mouse,electronics,digital device,clothing,shirt,t-shirt,pants,jacket,coat,dress,uniform,food,snack,drink,beverage,bottle,can,box,package,product,object,container",
            )
        return [item.strip() for item in raw.split(",") if item.strip()]

    def _det_conf(
        self,
        options: ExtractSubjectOptions | None = None,
        role: str | None = None,
    ) -> float:
        default_conf = (
            float(os.getenv("IMAGE_WORKER_QUERY_DETECTION_CONF", "0.02"))
            if role == "query"
            else float(os.getenv("IMAGE_WORKER_DETECTION_CONF", "0.08"))
        )
        return self._bounded_float(
            options.detectionConf if options else None,
            default_conf,
            0.0,
            1.0,
        )

    def _crop_padding(self, options: ExtractSubjectOptions | None = None) -> float:
        return self._bounded_float(
            options.cropPadding if options else None,
            float(os.getenv("IMAGE_WORKER_CROP_PADDING", "0.12")),
            0.0,
            1.0,
        )

    def _square_pad_color(self, options: ExtractSubjectOptions | None = None) -> tuple[int, int, int]:
        default = (245, 245, 245)
        if not options or not options.squarePadColor or len(options.squarePadColor) != 3:
            return default
        return tuple(self._bounded_int(value, 0, 255) for value in options.squarePadColor)

    def _output_size(self, options: ExtractSubjectOptions | None = None) -> int:
        return self._bounded_int(
            options.outputSize if options else None,
            int(os.getenv("IMAGE_WORKER_OUTPUT_SIZE", "480")),
            0,
            1024,
        )

    def _jpeg_quality(self, options: ExtractSubjectOptions | None = None) -> int:
        return self._bounded_int(
            options.jpegQuality if options else None,
            int(os.getenv("IMAGE_WORKER_JPEG_QUALITY", "88")),
            50,
            100,
        )

    def jpeg_quality(self, options: ExtractSubjectOptions | None = None) -> int:
        return self._jpeg_quality(options)

    def _manual_bbox_px(
        self,
        options: ExtractSubjectOptions | None,
        width: int,
        height: int,
    ) -> list[float] | None:
        if not options or not options.manualBboxNorm or len(options.manualBboxNorm) != 4:
            return None
        coords = [
            self._bounded_float(value, 0.0, 0.0, 1.0)
            for value in options.manualBboxNorm
        ]
        x1, y1, x2, y2 = coords
        left, right = sorted([x1, x2])
        top, bottom = sorted([y1, y2])
        if right - left < 0.01 or bottom - top < 0.01:
            return None
        return [left * width, top * height, right * width, bottom * height]

    def _crop_with_padding(
        self,
        image: Image.Image,
        bbox: list[float],
        padding_ratio: float,
    ) -> tuple[Image.Image, list[int]]:
        width, height = image.size
        x1, y1, x2, y2 = bbox
        pad = max(x2 - x1, y2 - y1) * padding_ratio
        left = max(0, int(x1 - pad))
        top = max(0, int(y1 - pad))
        right = min(width, int(x2 + pad))
        bottom = min(height, int(y2 + pad))
        return image.crop((left, top, right, bottom)), [left, top, right, bottom]

    def _union_bboxes(self, boxes: list[list[float]]) -> list[float]:
        return [
            min(box[0] for box in boxes),
            min(box[1] for box in boxes),
            max(box[2] for box in boxes),
            max(box[3] for box in boxes),
        ]

    def _square_pad(self, image: Image.Image, color: tuple[int, int, int]) -> Image.Image:
        target = max(image.size)
        background = Image.new("RGB", (target, target), color)
        offset = ((target - image.width) // 2, (target - image.height) // 2)
        background.paste(image, offset)
        return background

    def _standardize_output(self, image: Image.Image, output_size: int) -> Image.Image:
        if output_size <= 0:
            return image
        return image.resize((output_size, output_size), Image.Resampling.LANCZOS)

    def _original_subject(
        self,
        image: Image.Image,
        reason: str,
        pad_color: tuple[int, int, int],
        metadata: dict[str, Any],
    ) -> SubjectCrop:
        output_size = int(metadata.get("outputSize") or self._output_size(None))
        return SubjectCrop(
            image=self._standardize_output(self._square_pad(image, pad_color), output_size),
            strategy="original_image_fallback_v1",
            used_original=True,
            confidence=0.0,
            bbox_px=None,
            bbox_norm=None,
            metadata={**metadata, "fallbackReason": reason},
        )

    def _bounded_float(self, value: float | None, default: float, minimum: float, maximum: float) -> float:
        if value is None:
            return default
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return default
        return min(maximum, max(minimum, parsed))

    def _bounded_int(self, value: int, minimum: int, maximum: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return minimum
        return min(maximum, max(minimum, parsed))


registry = ModelRegistry()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.getenv("IMAGE_WORKER_WARMUP_DETECTOR", "true").lower() == "true":
        registry.warmup_detector()
    yield


app = FastAPI(
    title="Shopping Assistant Local Image Worker",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/v1/health")
def health() -> dict[str, Any]:
    return registry.health()


@app.post("/v1/images/extract-subject", response_model=ExtractSubjectResponse)
def extract_subject(payload: ImagePayload) -> ExtractSubjectResponse:
    image = load_image(payload)
    subject = registry.detect_subject(image, payload.debugOptions, payload.role)
    encoded = encode_jpeg_base64(subject.image, registry.jpeg_quality(payload.debugOptions))
    width, height = image.size
    return ExtractSubjectResponse(
        strategy=subject.strategy,
        usedOriginalImage=subject.used_original,
        confidence=round(subject.confidence, 6),
        bboxPx=subject.bbox_px,
        bboxNorm=subject.bbox_norm,
        imageWidth=width,
        imageHeight=height,
        croppedImageBase64=encoded,
        contentType="image/jpeg",
        metadata={
            **subject.metadata,
            "role": payload.role,
            "productId": payload.productId,
            "styleId": payload.styleId,
        },
    )


@app.post("/v1/images/embed", response_model=EmbeddingResponse)
def embed(payload: ImagePayload) -> EmbeddingResponse:
    if payload.imageUrl or payload.imageBase64 or payload.localImagePath:
        image = load_image(payload)
        text = payload.textHint or payload.text
        if text and text.strip():
            return registry.embed_image_with_text(image, text.strip())
        return registry.embed_image(image)
    text = payload.text or payload.textHint
    if text and text.strip():
        return registry.embed_text(text.strip())
    raise HTTPException(status_code=400, detail="IMAGE_OR_TEXT_REQUIRED")


@app.post("/v1/images/extract-and-embed", response_model=ExtractAndEmbedResponse)
def extract_and_embed(payload: ImagePayload) -> ExtractAndEmbedResponse:
    subject = extract_subject(payload)
    embedding = registry.embed_image(decode_base64_image(subject.croppedImageBase64))
    return ExtractAndEmbedResponse(subject=subject, embedding=embedding)


def load_image(payload: ImagePayload) -> Image.Image:
    try:
        if payload.imageBase64:
            return decode_base64_image(payload.imageBase64)
        if payload.localImagePath:
            return Image.open(payload.localImagePath).convert("RGB")
        if payload.imageUrl:
            return load_image_from_url_or_path(payload.imageUrl)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"IMAGE_LOAD_FAILED:{type(exc).__name__}") from exc
    raise HTTPException(status_code=400, detail="IMAGE_REQUIRED")


def load_image_from_url_or_path(value: str) -> Image.Image:
    if value.startswith("file://"):
        return Image.open(value.replace("file://", "", 1)).convert("RGB")
    path = Path(value)
    if path.exists():
        return Image.open(path).convert("RGB")
    response = requests.get(value, timeout=30)
    response.raise_for_status()
    return Image.open(io.BytesIO(response.content)).convert("RGB")


def decode_base64_image(value: str) -> Image.Image:
    if "," in value and value.split(",", 1)[0].startswith("data:"):
        value = value.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(value))).convert("RGB")


def encode_jpeg_base64(image: Image.Image, quality: int = 88) -> str:
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=quality, optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.getenv("IMAGE_WORKER_HOST", "127.0.0.1"),
        port=int(os.getenv("IMAGE_WORKER_PORT", "7800")),
        reload=os.getenv("IMAGE_WORKER_RELOAD", "false").lower() == "true",
    )
