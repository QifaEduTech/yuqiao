#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
03 AI 应用工程师：FastAPI 接口 + AI 工作流编排（独立可运行）

用途
----
把视觉模块和大模型模块编排成一条医院互助观察工作流：
    校验输入 → 并行调用视觉/大模型 → 合并结果 → 策略闸门 → 返回统一 JSON

独立运行
--------
    python server/service/fastapi_workflow.py --demo
    python server/service/fastapi_workflow.py --serve --port 8010
    python server/service/fastapi_workflow.py --serve --vision-url http://127.0.0.1:8020/segment \
                              --llm-url http://127.0.0.1:8030/observe

说明：01/02 当前是 CLI，不是 HTTP 服务；上面的 URL 需要另加轻量 HTTP 包装。
不传 URL 时使用 mock 适配器，本模块仍能独立跑完整工作流。

接口
----
    GET  /health
    POST /v1/workflow/hospital     上传图片或发送 image_base64
    GET  /v1/jobs/{workflow_id}
    POST /v1/jobs/{workflow_id}/cancel

边界
----
- 不诊断疾病，不决定挂号、检查或是否接诊。
- 没有视觉证据的候选词直接丢弃，不交给语言模型补。
- 所有结果都带 human_review_required=true。
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
MODULE_ID = "03_AI应用工程师"
DEFAULT_TIMEOUT = 20.0

JOBS: dict[str, dict[str, Any]] = {}


class WorkflowError(RuntimeError):
    """输入或工作流状态不满足协议。"""


def enable_utf8() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


async def mock_vision(image_bytes: bytes) -> dict[str, Any]:
    """视觉模块不可用时的独立演示结果，明确标注 mock。"""
    await asyncio.sleep(0.05)
    return {
        "module": "02_视觉工程师",
        "mode": "mock",
        "image_bytes": len(image_bytes),
        "instances": [
            {"id": 1, "class": "person", "confidence": 0.93, "box": [120, 40, 520, 470], "mask_area": 162000},
            {"id": 2, "class": "chair", "confidence": 0.81, "box": [30, 300, 110, 460], "mask_area": 12800},
        ],
        "counts": {"person": 1, "chair": 1},
        "notes": ["mock 结果，不是 YOLO 推理。"],
    }


async def mock_llm(image_bytes: bytes) -> dict[str, Any]:
    """大模型模块不可用时的独立演示结果，故意带一条无证据候选验证闸门。"""
    await asyncio.sleep(0.06)
    return {
        "module": "01_大模型工程师",
        "mode": "mock",
        "image_bytes": len(image_bytes),
        "observed": ["一名来访者面向镜头", "右手从胸前向自身方向回收"],
        "sign_candidates": [
            {"word": "需要", "evidence": "右手掌心向上并向自身方向回收", "confidence": 0.42},
            {"word": "帮助", "evidence": "", "confidence": 0.30},
        ],
        "unknowns": ["单帧无法确认完整动作起止"],
        "medical_advice": False,
        "human_review_required": True,
    }


def http_post_json(url: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    """标准库 HTTP 调用，避免为了一个适配器引入额外客户端依赖。"""
    import urllib.request

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


async def call_vision(image_bytes: bytes, url: str, timeout: float) -> dict[str, Any]:
    if not url:
        return await mock_vision(image_bytes)
    payload = {"image_base64": base64.b64encode(image_bytes).decode("ascii")}
    return await asyncio.to_thread(http_post_json, url, payload, timeout)


async def call_llm(image_bytes: bytes, url: str, timeout: float) -> dict[str, Any]:
    if not url:
        return await mock_llm(image_bytes)
    payload = {"image_base64": base64.b64encode(image_bytes).decode("ascii")}
    return await asyncio.to_thread(http_post_json, url, payload, timeout)


# ===== 展示代码 START =====
async def run_hospital_workflow(
    image_bytes: bytes,
    vision_url: str = "",
    llm_url: str = "",
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """核心流程：并行调用 → 合并 → 策略闸门 → 统一结果。"""
    if not image_bytes:
        raise WorkflowError("图片为空。")
    if len(image_bytes) > 8 * 1024 * 1024:
        raise WorkflowError("图片超过 8MB。")

    workflow_id = uuid.uuid4().hex[:12]                                  # [敲]
    started = time.perf_counter()                                       # [敲]

    vision_task = call_vision(image_bytes, vision_url, timeout)          # [敲]
    llm_task = call_llm(image_bytes, llm_url, timeout)                   # [敲]
    try:
        vision, observation = await asyncio.wait_for(                       # [敲]
            asyncio.gather(vision_task, llm_task), timeout=timeout          # [敲]
        )
    except asyncio.TimeoutError as exc:                                  # [敲]
        raise WorkflowError(f"工作流超时（>{timeout:.0f}s）。") from exc    # [敲]

    candidates, dropped = [], []                                         # [敲]
    for item in observation.get("sign_candidates", []) or []:           # [敲]
        word = str(item.get("word", "")).strip()
        evidence = str(item.get("evidence", "")).strip()
        if not word or not evidence:                                     # [敲]
            dropped.append({"word": word, "reason": "no_evidence"})      # [敲]
            continue
        candidates.append({                                              # [敲]
            "word": word,
            "evidence": evidence,
            "confidence": max(0.0, min(1.0, float(item.get("confidence", 0) or 0))),
            "status": "candidate_requires_human_review",
        })

    if observation.get("medical_advice"):                                # [敲]
        dropped.append({"word": None, "reason": "medical_advice_blocked"})  # [敲]

    merged = {                                                           # [敲]
        "scene": "hospital_mutual_aid",
        "instances": vision.get("instances", []),
        "counts": vision.get("counts", {}),
        "observed": observation.get("observed", []),
        "unknowns": observation.get("unknowns", []),
        "sign_candidates": candidates,
    }
    result = {                                                           # [敲]
        "schema_version": SCHEMA_VERSION,
        "module": MODULE_ID,
        "workflow_id": workflow_id,
        "status": "completed",
        "result": merged,
        "policy": {
            "medical_advice": False,
            "human_review_required": True,
            "dropped_candidates": dropped,
            "no_evidence_no_word": True,
        },
        "timings_ms": {"total": round((time.perf_counter() - started) * 1000, 1)},
        "created_at": now(),
    }
    JOBS[workflow_id] = {"status": "completed", "result": result}       # [敲]
    return result
# ===== 展示代码 END =====


def create_app():
    """延迟导入 FastAPI，保证 --demo 不需要安装 Web 依赖。"""
    try:
        from fastapi import FastAPI, File, HTTPException, UploadFile  # type: ignore
    except ImportError as exc:
        raise WorkflowError(
            "服务模式需要 fastapi 和 uvicorn；请先 pip install fastapi uvicorn python-multipart，"
            "或运行 python server/service/fastapi_workflow.py --demo。"
        ) from exc

    app = FastAPI(title="语桥四岗 · AI 应用工程师", version="1.0")

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "module": MODULE_ID,
            "vision": "http" if os.environ.get("VISION_URL") else "mock",
            "llm": "http" if os.environ.get("LLM_URL") else "mock",
            "time": now(),
        }

    @app.post("/v1/workflow/hospital")
    async def hospital(file: UploadFile = File(...)) -> dict[str, Any]:
        image_bytes = await file.read()
        try:
            return await run_hospital_workflow(
                image_bytes,
                vision_url=os.environ.get("VISION_URL", ""),
                llm_url=os.environ.get("LLM_URL", ""),
                timeout=float(os.environ.get("WORKFLOW_TIMEOUT", DEFAULT_TIMEOUT)),
            )
        except WorkflowError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/v1/jobs/{workflow_id}")
    async def get_job(workflow_id: str) -> dict[str, Any]:
        job = JOBS.get(workflow_id)
        if not job:
            raise HTTPException(status_code=404, detail="workflow not found")
        return {"workflow_id": workflow_id, **job}

    @app.post("/v1/jobs/{workflow_id}/cancel")
    async def cancel_job(workflow_id: str) -> dict[str, Any]:
        job = JOBS.get(workflow_id)
        if not job:
            raise HTTPException(status_code=404, detail="workflow not found")
        job["status"] = "cancelled"
        return {"workflow_id": workflow_id, "status": "cancelled"}

    return app


try:
    app = create_app()
except WorkflowError:
    # 没装 FastAPI 时仍允许 python server/service/fastapi_workflow.py --demo。
    app = None


def write_output(result: dict[str, Any], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "workflow.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="03 AI 应用工程师：FastAPI + AI 工作流编排")
    parser.add_argument("--demo", action="store_true", help="用 mock 适配器跑完整工作流")
    parser.add_argument("--serve", action="store_true", help="启动 FastAPI 服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--vision-url", default=os.environ.get("VISION_URL", ""))
    parser.add_argument("--llm-url", default=os.environ.get("LLM_URL", ""))
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[2] / "outputs/four-role/03_AI应用工程师"))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    enable_utf8()
    args = parse_args(argv)
    out_dir = Path(args.out)

    if args.serve:
        os.environ["VISION_URL"] = args.vision_url
        os.environ["LLM_URL"] = args.llm_url
        os.environ["WORKFLOW_TIMEOUT"] = str(args.timeout)
        try:
            import uvicorn  # type: ignore
        except ImportError:
            print("[失败] 服务模式需要 uvicorn：pip install fastapi uvicorn python-multipart", file=sys.stderr)
            return 2
        if app is None:
            print("[失败] FastAPI 未安装，无法启动服务。", file=sys.stderr)
            return 2
        uvicorn.run(app, host=args.host, port=args.port)
        return 0

    if not args.demo:
        print("请选择 --demo 或 --serve。", file=sys.stderr)
        return 2

    try:
        result = asyncio.run(
            run_hospital_workflow(
                b"demo-image-bytes",
                vision_url=args.vision_url,
                llm_url=args.llm_url,
                timeout=args.timeout,
            )
        )
        path = write_output(result, out_dir)
    except WorkflowError as exc:
        print(f"[失败] {exc}", file=sys.stderr)
        return 2

    print(json.dumps(
        {
            "workflow_id": result["workflow_id"],
            "status": result["status"],
            "candidates": [x["word"] for x in result["result"]["sign_candidates"]],
            "dropped": result["policy"]["dropped_candidates"],
            "json": str(path),
        },
        ensure_ascii=False,
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
