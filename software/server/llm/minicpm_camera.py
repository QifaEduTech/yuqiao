#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
01 大模型工程师：摄像头取帧 + MiniCPM 视觉观察（独立可运行）

用途
----
打开摄像头或读取一张图片，把画面交给 MiniCPM-V，得到一份“看到了什么”的
结构化观察。它只做视觉观察和候选提示，不是手语翻译结论，也不替医生诊断。

独立运行
--------
    python server/llm/minicpm_camera.py --demo
    python server/llm/minicpm_camera.py --image path/to/frame.jpg
    python server/llm/minicpm_camera.py --camera 0
    python server/llm/minicpm_camera.py --image xxx.jpg --endpoint http://127.0.0.1:8000/v1

依赖
----
    demo 模式：只用 Python 标准库
    摄像头模式：opencv-python
    本地模型：torch + transformers + 对应 MiniCPM-V 权重
    接口模式：任何兼容 OpenAI /chat/completions 的视觉模型服务

输出
----
    outputs/four-role/01_大模型工程师/observation.json   结构化观察
    outputs/four-role/01_大模型工程师/observation.md     给人看的摘要
    outputs/four-role/01_大模型工程师/capture.jpg        摄像头抓拍（摄像头模式）
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
MODULE_ID = "01_大模型工程师"
DEFAULT_MODEL = "openbmb/MiniCPM-V-4_5"
DEFAULT_SCENE = "hospital_mutual_aid"

SYSTEM_PROMPT = """你是医院互助场景的视觉观察助手。
你只描述画面中确实看得见的人、手、物体和动作线索。
不要诊断疾病，不要判断能否挂号，不要编造没有看见的词。
如果画面不足以判断，把不确定内容写进 unknowns。
只输出一个 JSON 对象，不要输出 Markdown。"""

USER_PROMPT = """请观察这张医院互助场景图片，并按以下 JSON 结构回答：
{
  "scene": "hospital_mutual_aid",
  "observed": ["只写看得见的事实"],
  "sign_candidates": [
    {"word": "候选词", "evidence": "画面中支持这个词的可见证据", "confidence": 0.0}
  ],
  "unknowns": ["看不清或无法判断的内容"],
  "medical_advice": false
}
要求：
1. 没有可见证据的词不要放进 sign_candidates。
2. confidence 只能是 0 到 1 之间的小数。
3. 不要输出诊断、处方、挂号结论。"""


class ObservationError(RuntimeError):
    """模型输出或输入不满足观察协议。"""


def enable_utf8() -> None:
    """Windows 控制台默认可能是 GBK，这里尽量切到 UTF-8。"""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def build_prompt(scene: str = DEFAULT_SCENE) -> str:
    """把场景约束拼进提示词；场景只影响措辞，不改变证据要求。"""
    return USER_PROMPT.replace("hospital_mutual_aid", scene)


def parse_json_response(text: str) -> dict[str, Any]:
    """模型可能返回```json 包裹或前后说明文字，这里只取第一个 JSON 对象。"""
    if not isinstance(text, str) or not text.strip():
        raise ObservationError("模型返回为空。")
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ObservationError("模型返回里没有 JSON 对象。")
    try:
        value = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ObservationError(f"模型 JSON 解析失败：{exc}") from exc
    if not isinstance(value, dict):
        raise ObservationError("模型 JSON 顶层必须是对象。")
    return value


def normalize_observation(raw: dict[str, Any], source: str, mode: str) -> dict[str, Any]:
    """把模型输出收紧成固定协议，并执行“无证据不出词”的闸门。"""
    observed = [str(x).strip() for x in raw.get("observed", []) if str(x).strip()]
    unknowns = [str(x).strip() for x in raw.get("unknowns", []) if str(x).strip()]
    candidates: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []

    for item in raw.get("sign_candidates", []) or []:
        if not isinstance(item, dict):
            dropped.append({"item": item, "reason": "candidate_not_object"})
            continue
        word = str(item.get("word", "")).strip()
        evidence = str(item.get("evidence", "")).strip()
        if not word or not evidence:
            dropped.append({"word": word, "reason": "missing_word_or_evidence"})
            continue
        try:
            confidence = float(item.get("confidence", 0))
        except (TypeError, ValueError):
            confidence = 0.0
        candidates.append(
            {
                "word": word,
                "evidence": evidence,
                "confidence": max(0.0, min(1.0, confidence)),
                "status": "candidate_requires_human_review",
            }
        )

    medical_advice = bool(raw.get("medical_advice", False))
    if medical_advice:
        unknowns.append("模型输出了医疗建议，已按策略闸门拦截，不作为结论。")

    for item in dropped:
        unknowns.append(f"已丢弃无证据候选：{item.get('word') or item.get('item')}")

    return {
        "schema_version": SCHEMA_VERSION,
        "module": MODULE_ID,
        "mode": mode,
        "source_image": source,
        "scene": str(raw.get("scene") or DEFAULT_SCENE),
        "observed": observed,
        "sign_candidates": candidates,
        "unknowns": unknowns,
        "medical_advice": False,
        "human_review_required": True,
        "status": "observation_with_candidates" if candidates else "observation_only",
        "limitations": [
            "MiniCPM-V 只做视觉观察，不是手语翻译结论。",
            "任何候选都必须由使用者或手语专业人员确认后才能使用。",
            "单帧画面不能证明完整动作起止、力度和语义。",
        ],
        "dropped_candidates": dropped,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


def capture_frame(camera_index: int, out_dir: Path) -> tuple[Path, dict[str, Any]]:
    """打开摄像头，取若干帧，选最清晰的一帧保存。"""
    try:
        import cv2  # type: ignore
    except ImportError as exc:
        raise ObservationError(
            "摄像头模式需要 opencv-python；可先运行 python server/llm/minicpm_camera.py --demo 或 --image。"
        ) from exc

    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        raise ObservationError(f"无法打开摄像头 {camera_index}。")
    best_frame = None
    best_score = -1.0
    try:
        for _ in range(12):
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            if score > best_score:
                best_score, best_frame = score, frame
    finally:
        cap.release()
    if best_frame is None:
        raise ObservationError("摄像头没有读到有效画面。")

    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "capture.jpg"
    if not cv2.imwrite(str(path), best_frame):
        raise ObservationError("抓拍图保存失败。")
    height, width = best_frame.shape[:2]
    return path, {"width": width, "height": height, "focus_score": round(best_score, 2)}


def encode_image_b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def call_endpoint(endpoint: str, model: str, image_path: Path, prompt: str, timeout: int = 120) -> str:
    """调用兼容 OpenAI 的视觉接口；只发送当前这一帧，不保存到远端项目。"""
    import urllib.request

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{encode_image_b64(image_path)}"},
                    },
                ],
            },
        ],
        "temperature": 0,
        "max_tokens": 800,
    }
    request = urllib.request.Request(
        endpoint.rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = json.loads(response.read().decode("utf-8"))
    try:
        return body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ObservationError(f"接口返回结构不符合预期：{body}") from exc


def call_local(model_id: str, image_path: Path, prompt: str) -> str:
    """本地 MiniCPM-V 推理。不同版本的 chat 签名可能不同，失败时给出明确提示。"""
    try:
        import torch  # type: ignore
        from PIL import Image  # type: ignore
        from transformers import AutoModel, AutoTokenizer  # type: ignore
    except ImportError as exc:
        raise ObservationError(
            "本地模型模式需要 torch、transformers、Pillow 和 MiniCPM-V 权重；"
            "也可以改用 --endpoint 调用视觉服务。"
        ) from exc

    torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    device_map = "auto" if torch.cuda.is_available() else "cpu"
    model = AutoModel.from_pretrained(
        model_id, trust_remote_code=True, torch_dtype=torch_dtype, device_map=device_map
    )
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    image = Image.open(image_path).convert("RGB")
    msgs = [{"role": "user", "content": [image, prompt]}]
    try:
        answer = model.chat(image=None, msgs=msgs, tokenizer=tokenizer, sampling=False)
    except TypeError:
        answer = model.chat(msgs=msgs, tokenizer=tokenizer, sampling=False)
    if isinstance(answer, tuple):
        answer = answer[0]
    return str(answer)


# ===== 展示代码 START =====
def analyze_frame(source: str, args: argparse.Namespace, out_dir: Path) -> dict[str, Any]:
    """核心流程：取帧 → 提示词 → MiniCPM → JSON 解析 → 证据闸门。"""
    mode = "demo"                                        # [敲]
    image_path: Path | None = None
    capture_info: dict[str, Any] = {}

    if source == "--camera":                             # [敲]
        image_path, capture_info = capture_frame(args.camera, out_dir)
        mode = "local" if not args.endpoint else "endpoint"
    elif source == "--image":                            # [敲]
        image_path = Path(args.image).expanduser().resolve()
        if not image_path.exists():
            raise ObservationError(f"图片不存在：{image_path}")
        mode = "local" if not args.endpoint else "endpoint"

    prompt = build_prompt(args.scene)                    # [敲]

    if mode == "demo":                                   # [敲]
        raw = demo_raw()
    elif mode == "endpoint":                             # [敲]
        assert image_path is not None
        text = call_endpoint(args.endpoint, args.model, image_path, prompt, args.timeout)
        raw = parse_json_response(text)
    else:                                                # [敲]
        assert image_path is not None
        text = call_local(args.model, image_path, prompt)
        raw = parse_json_response(text)

    observation = normalize_observation(                 # [敲]
        raw,
        source=str(image_path) if image_path else "demo://hospital_mutual_aid",
        mode=mode,
    )
    if capture_info:
        observation["capture"] = capture_info

    if observation["dropped_candidates"]:                # [敲]
        print(f"[闸门] 丢弃 {len(observation['dropped_candidates'])} 条无证据候选")
    if not observation["sign_candidates"]:               # [敲]
        print("[闸门] 本次只输出视觉观察，不输出任何词")
    return observation
# ===== 展示代码 END =====


def demo_raw() -> dict[str, Any]:
    """没有摄像头/模型时也能独立跑出的固定观察，明确标注 demo。"""
    return {
        "scene": DEFAULT_SCENE,
        "observed": [
            "一名来访者面向镜头，胸前区域可见",
            "右手从胸前向自身方向回收",
            "背景可见医院门诊指示牌，画面没有其他人",
        ],
        "sign_candidates": [
            {
                "word": "需要",
                "evidence": "右手掌心向上并向自身方向回收，轨迹与‘需要’的可见特征相符",
                "confidence": 0.42,
            },
            {
                "word": "帮助",
                "evidence": "",
                "confidence": 0.30,
            },
        ],
        "unknowns": ["单帧无法确认完整动作起止", "无法确认左手是否同时参与"],
        "medical_advice": False,
    }


def write_outputs(observation: dict[str, Any], out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "observation.json"
    md_path = out_dir / "observation.md"
    json_path.write_text(json.dumps(observation, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# MiniCPM 视觉观察",
        "",
        f"- 模式：{observation['mode']}",
        f"- 画面：{observation['source_image']}",
        f"- 状态：{observation['status']}",
        "",
        "## 看见的事实",
    ]
    lines += [f"- {x}" for x in observation["observed"]] or ["- 无"]
    lines += ["", "## 候选（需人工确认）"]
    if observation["sign_candidates"]:
        for item in observation["sign_candidates"]:
            lines.append(f"- {item['word']}（{item['confidence']:.2f}）：{item['evidence']}")
    else:
        lines.append("- 无")
    lines += ["", "## 不确定"]
    lines += [f"- {x}" for x in observation["unknowns"]] or ["- 无"]
    lines += ["", "## 边界"]
    lines += [f"- {x}" for x in observation["limitations"]]
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="01 大模型工程师：摄像头 + MiniCPM 视觉观察")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--demo", action="store_true", help="不接摄像头/模型，跑固定演示")
    group.add_argument("--camera", type=int, metavar="INDEX", help="摄像头编号，如 0")
    group.add_argument("--image", type=str, metavar="PATH", help="读取一张图片")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="本地模型名或接口模型名")
    parser.add_argument("--endpoint", default=os.environ.get("MINICPM_ENDPOINT", ""), help="OpenAI 兼容视觉接口")
    parser.add_argument("--scene", default=DEFAULT_SCENE, help="场景标识")
    parser.add_argument("--timeout", type=int, default=120, help="接口超时秒数")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[2] / "outputs/four-role/01_大模型工程师"), help="输出目录")
    args = parser.parse_args(argv)
    if not (args.demo or args.camera is not None or args.image):
        parser.error("请选择 --demo、--camera 或 --image 之一")
    return args


def main(argv: list[str] | None = None) -> int:
    enable_utf8()
    args = parse_args(argv)
    out_dir = Path(args.out)

    if args.demo:
        source = "--demo"
    elif args.camera is not None:
        source = "--camera"
    else:
        source = "--image"

    try:
        observation = analyze_frame(source, args, out_dir)
        json_path, md_path = write_outputs(observation, out_dir)
    except ObservationError as exc:
        print(f"[失败] {exc}", file=sys.stderr)
        return 2

    print(json.dumps(
        {
            "status": observation["status"],
            "mode": observation["mode"],
            "candidates": [x["word"] for x in observation["sign_candidates"]],
            "json": str(json_path),
            "markdown": str(md_path),
        },
        ensure_ascii=False,
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
