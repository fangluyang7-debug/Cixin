#!/usr/bin/env python
"""Read CSV/XLS/XLSX product rows and print JSON rows to stdout."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import pandas as pd


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser()
    parser.add_argument("file", help="CSV, XLS, or XLSX file to read")
    args = parser.parse_args()

    path = Path(args.file)
    suffix = path.suffix.lower()
    if suffix == ".csv":
        frames = {"csv": read_csv(path)}
    elif suffix in {".xlsx", ".xls"}:
        frames = read_excel(path)
    else:
        raise SystemExit(f"Unsupported tabular file type: {path}")

    rows: list[dict[str, Any]] = []
    multi_sheet = len(frames) > 1
    for sheet_name, frame in frames.items():
        frame = frame.dropna(how="all")
        for _, row in frame.iterrows():
            record = {
                str(column).strip(): clean_cell(value)
                for column, value in row.items()
                if str(column).strip() and clean_cell(value) is not None
            }
            if not record:
                continue
            if multi_sheet:
                record["_sourceSheet"] = sheet_name
            rows.append(record)

    print(json.dumps(rows, ensure_ascii=False))


def read_csv(path: Path) -> pd.DataFrame:
    errors: list[str] = []
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return pd.read_csv(path, dtype=object, encoding=encoding)
        except UnicodeDecodeError as error:
            errors.append(f"{encoding}: {error}")
    raise RuntimeError(f"Could not decode CSV {path}: {'; '.join(errors)}")


def read_excel(path: Path) -> dict[str, pd.DataFrame]:
    try:
        raw_sheets = pd.read_excel(path, sheet_name=None, dtype=object, header=None)
        return {
            sheet_name: normalize_excel_frame(frame)
            for sheet_name, frame in raw_sheets.items()
        }
    except ImportError as error:
        raise RuntimeError(
            "Excel support requires openpyxl for .xlsx or xlrd for .xls. "
            "Use --python to point at a Python environment that has the needed package."
        ) from error


def normalize_excel_frame(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.dropna(how="all")
    if frame.empty:
        return frame

    first_row = [clean_cell(value) for value in frame.iloc[0].tolist()]
    if looks_like_header(first_row):
        headers = dedupe_headers(first_row)
        data = frame.iloc[1:].copy()
        data.columns = headers
        return data

    data = frame.copy()
    data.columns = [f"column{index + 1}" for index in range(len(data.columns))]
    return data


def looks_like_header(values: list[Any]) -> bool:
    known_headers = {
        "关键词",
        "搜索词",
        "店铺名称",
        "店铺链接",
        "地理位置",
        "产品名称",
        "商品名称",
        "商品",
        "标题",
        "产品价格",
        "商品价格",
        "现价",
        "价格",
        "折后价",
        "原价",
        "付款人数",
        "销量",
        "评价数",
        "图片地址",
        "商品图片",
        "列表页图片链接",
        "主图",
        "商品链接",
        "详情链接",
        "详情页链接",
        "页面网址",
        "当前页面网址",
        "当前时间",
        "页码",
        "当前页码",
    }
    normalized = {str(value).strip() for value in values if value is not None}
    return len(normalized & known_headers) >= 2


def dedupe_headers(values: list[Any]) -> list[str]:
    headers: list[str] = []
    seen: dict[str, int] = {}
    for index, value in enumerate(values):
        header = str(value).strip() if value is not None else ""
        if not header:
            header = f"column{index + 1}"
        count = seen.get(header, 0)
        seen[header] = count + 1
        headers.append(header if count == 0 else f"{header}.{count}")
    return headers


def clean_cell(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if pd.isna(value):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    text = str(value).strip()
    return text or None


if __name__ == "__main__":
    main()
