#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
02 视觉工程师：YOLO 实例分割（独立可运行）

用途
----
对一张图片、一段视频或摄像头画面做 YOLO 实例分割，输出每个实例的类别、
置信度、边界框、mask 面积和 mask 多边形，并保存标注图。

重要边界
--------
- COCO 预训练类别里没有“手”这个类。第一版分割人物/物体；手部区域需要
  MediaPipe 手部关键点或自定义手部分割模型，不能把人物 mask 冒充手部 mask。
- 分割结果只是视觉证据，不是手语词义，也不是医疗判断。
- 不做人脸识别，不保存身份信息。

独立运行
--------
    python server/vision/yolo_segmentation.py --demo
    python server/vision/yolo_segmentation.py --source 0                     # 摄像头
    python server/vision/yolo_segmentation.py --source path/to/image.jpg     # 任意图片
    python server/vision/yolo_segmentation.py --source 0 --model yolo11n-seg.pt
    python server/vision/yolo_segmentation.py --source demo.mp4 --conf 0.3

依赖
----
    demo 模式：Python 标准库
    真实分割：ultralytics + opencv-python + numpy

输出
----
    outputs/four-role/02_视觉工程师/segmentation.json  实例、类别、框、mask
    outputs/four-role/02_视觉工程师/annotated.jpg      YOLO 标注图（真实模式）
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
MODULE_ID = "02_视觉工程师"
DEFAULT_MODEL = "yolo11n-seg.pt"


class VisionError(RuntimeError):
    """输入、模型或分割结果不满足协议。"""


def enable_utf8() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def load_yolo_model(model_path: str):
    """延迟导入 ultralytics，保证 --demo 不需要安装重型依赖。"""
    try:
        from ultralytics import YOLO  # type: ignore
    except ImportError as exc:
        raise VisionError(
            "真实分割需要 ultralytics；请先 pip install ultralytics opencv-python numpy，"
            "或运行 python server/vision/yolo_segmentation.py --demo 查看独立演示结果。"
        ) from exc
    return YOLO(model_path)


def mask_to_polygon(mask, width: int, height: int, max_points: int = 32) -> list[list[int]]:
    """把二值 mask 转成简化多边形；找不到轮廓时返回空列表。"""
    import cv2  # type: ignore
    import numpy as np  # type: ignore

    binary = (mask > 0.5).astype(np.uint8)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []
    contour = max(contours, key=cv2.contourArea)
    epsilon = max(1.0, 0.01 * cv2.arcLength(contour, True))
    approx = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
    if len(approx) > max_points:
        step = max(1, len(approx) // max_points)
        approx = approx[::step][:max_points]
    return [[int(x), int(y)] for x, y in approx]


# ===== 展示代码 START =====
def summarize_result(result, image_path: str, model_path: str) -> dict[str, Any]:
    """核心流程：逐实例取框、类别、mask → 统一 JSON。"""
    names = result.names or {}                                           # [敲]
    height, width = result.orig_shape[:2]                                # [敲]
    boxes = result.boxes                                               # [敲]
    masks = result.masks                                               # [敲]

    instances: list[dict[str, Any]] = []
    for index in range(len(boxes)):                                       # [敲]
        cls_id = int(boxes.cls[index].item())                             # [敲]
        confidence = float(boxes.conf[index].item())                      # [敲]
        xyxy = [round(float(v), 2) for v in boxes.xyxy[index].tolist()]   # [敲]
        instance = {
            "id": index + 1,
            "class": str(names.get(cls_id, cls_id)),
            "class_id": cls_id,
            "confidence": round(confidence, 4),
            "box": xyxy,
            "mask_area": None,
            "mask_polygon": [],
        }
        if masks is not None and masks.data is not None and index < len(masks.data):  # [敲]
            mask = masks.data[index].detach().cpu().numpy()                # [敲]
            instance["mask_area"] = int((mask > 0.5).sum())                # [敲]
            instance["mask_polygon"] = mask_to_polygon(mask, width, height)  # [敲]
        instances.append(instance)

    counts: dict[str, int] = {}                                            # [敲]
    for item in instances:                                                 # [敲]
        counts[item["class"]] = counts.get(item["class"], 0) + 1           # [敲]

    return {
        "schema_version": SCHEMA_VERSION,
        "module": MODULE_ID,
        "mode": "yolo_instance_segmentation",
        "source": str(image_path),
        "model": str(model_path),
        "image": {"width": width, "height": height},
        "instances": instances,
        "counts": counts,
        "notes": [
            "COCO 预训练类别不含 hand；手部区域需另接 MediaPipe 或自定义模型。",
            "mask 多边形为轮廓简化结果，不是像素级精确边界。",
            "分割结果不是手语词义，也不做身份识别。",
        ],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


def run_yolo(model, image_path: str, conf: float = 0.25):
    """只推理一次，同时返回结构化结果和原始结果供标注图复用。"""
    results = model.predict(source=image_path, conf=conf, verbose=False)  # [敲]
    if not results:
        raise VisionError("YOLO 没有返回结果。")
    raw = results[0]                                                     # [敲]
    return summarize_result(raw, image_path, getattr(model, "ckpt_path", DEFAULT_MODEL)), raw
# ===== 展示代码 END =====


def annotate_yolo(result, out_path: Path) -> Path:
    """把 YOLO 自带标注图写到磁盘。"""
    import cv2  # type: ignore

    annotated = result.plot()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(out_path), annotated):
        raise VisionError("标注图保存失败。")
    return out_path


def write_ppm(path: Path, width: int = 640, height: int = 480) -> Path:
    """不依赖 Pillow 生成一张演示图：白底 + 两个色块。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            if 120 <= x <= 520 and 40 <= y <= 470:
                row += bytes((235, 220, 205))   # 人物区域
            elif 30 <= x <= 110 and 300 <= y <= 460:
                row += bytes((205, 225, 235))   # 椅子区域
            else:
                row += bytes((250, 250, 250))
        rows.append(bytes(row))
    with path.open("wb") as handle:
        handle.write(f"P6\n{width} {height}\n255\n".encode("ascii"))
        for row in rows:
            handle.write(row)
    return path


def demo_result(image_path: Path) -> dict[str, Any]:
    """固定演示：明确标注 demo_synthetic，不冒充 YOLO 结果。"""
    width, height = 640, 480
    instances = [
        {
            "id": 1,
            "class": "person",
            "class_id": 0,
            "confidence": 0.93,
            "box": [120.0, 40.0, 520.0, 470.0],
            "mask_area": 162000,
            "mask_polygon": [[120, 40], [520, 40], [520, 470], [120, 470]],
        },
        {
            "id": 2,
            "class": "chair",
            "class_id": 56,
            "confidence": 0.81,
            "box": [30.0, 300.0, 110.0, 460.0],
            "mask_area": 12800,
            "mask_polygon": [[30, 300], [110, 300], [110, 460], [30, 460]],
        },
    ]
    return {
        "schema_version": SCHEMA_VERSION,
        "module": MODULE_ID,
        "mode": "demo_synthetic_not_yolo",
        "source": str(image_path),
        "model": "demo-fixed-instances",
        "image": {"width": width, "height": height},
        "instances": instances,
        "counts": {"person": 1, "chair": 1},
        "notes": [
            "这是固定演示数据，不是 YOLO 推理结果。",
            "COCO 预训练类别不含 hand；手部区域需另接 MediaPipe 或自定义模型。",
            "分割结果不是手语词义，也不做身份识别。",
        ],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


def write_outputs(result: dict[str, Any], out_dir: Path, annotated: Path | None = None) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "segmentation.json"
    md_path = out_dir / "segmentation.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# YOLO 实例分割结果",
        "",
        f"- 模式：{result['mode']}",
        f"- 输入：{result['source']}",
        f"- 模型：{result['model']}",
        f"- 尺寸：{result['image']['width']}×{result['image']['height']}",
        f"- 标注图：{annotated if annotated else '无（演示模式）'}",
        "",
        "## 实例",
    ]
    if result["instances"]:
        for item in result["instances"]:
            lines.append(
                f"- #{item['id']} {item['class']} {item['confidence']:.2f} "
                f"box={item['box']} mask_area={item['mask_area']}"
            )
    else:
        lines.append("- 无")
    lines += ["", "## 边界"] + [f"- {x}" for x in result["notes"]]
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="02 视觉工程师：YOLO 实例分割")
    parser.add_argument("--source", default="0", help="图片/视频路径，或摄像头编号 0")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="YOLO 分割权重")
    parser.add_argument("--conf", type=float, default=0.25, help="置信度门槛")
    parser.add_argument("--demo", action="store_true", help="不装 ultralytics，跑固定演示")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[2] / "outputs/four-role/02_视觉工程师"), help="输出目录")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    enable_utf8()
    args = parse_args(argv)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        if args.demo:
            image_path = write_ppm(out_dir / "demo_input.ppm")
            result = demo_result(image_path)
            annotated = None
        else:
            source = int(args.source) if str(args.source).isdigit() else args.source
            model = load_yolo_model(args.model)
            result, raw = run_yolo(model, str(source), args.conf)
            annotated = annotate_yolo(raw, out_dir / "annotated.jpg")
        json_path, md_path = write_outputs(result, out_dir, annotated)
    except VisionError as exc:
        print(f"[失败] {exc}", file=sys.stderr)
        return 2

    print(json.dumps(
        {
            "mode": result["mode"],
            "counts": result["counts"],
            "json": str(json_path),
            "markdown": str(md_path),
            "annotated": str(annotated) if annotated else None,
        },
        ensure_ascii=False,
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
