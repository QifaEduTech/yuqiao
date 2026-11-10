"""Isolated finite-vocabulary experiment. No semantic rewriting or fallback labels.

Feature layout follows wuli-git/gesture_languish_recognize (Apache-2.0).
Changes: batch decoding, strict input limits, whole-clip resampling, missing-hand
checks, explicit four-word scope, no camera access, and structured reports.
See models/sign-word-baseline/LICENSE and source.json for attribution.
"""
import json
import hashlib
import os
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "models/sign-word-baseline"
CATALOG = json.loads((ROOT / 'shared/sign-catalog.json').read_text(encoding='utf8'))
FEATURES = CATALOG['recognitionModel']['features']
if CATALOG['schemaVersion'] != 1 or FEATURES != {'id':'mp-hands-xyz-wrist-maxabs-left-right-v1','sequenceLength':30,'dimensions':126,'mirrored':True}:
    raise ValueError('Feature adapter not implemented')
EXPECTED_LABELS = CATALOG['recognitionModel']['labels']
ENTRIES = {entry['recognitionIndex']: entry for entry in CATALOG['entries']}
if len(ENTRIES) != len(CATALOG['entries']) or len({entry['id'] for entry in CATALOG['entries']}) != len(ENTRIES):
    raise ValueError('Duplicate sign mapping')
if any(EXPECTED_LABELS[index] != entry['text'] for index, entry in ENTRIES.items()):
    raise ValueError('Recognition label mapping mismatch')
ALLOWED = set(ENTRIES)


def classifier():
    from ai_edge_litert.interpreter import Interpreter, OpResolverType
    model_bytes = (MODEL / "dynamic_gesture_classifier.tflite").read_bytes()
    manifest = json.loads((MODEL / "source.json").read_text(encoding="utf8"))
    expected = next(item["sha256"] for item in manifest["files"] if item["path"].endswith(".tflite"))
    if hashlib.sha256(model_bytes).hexdigest() != expected or expected != CATALOG['recognitionModel']['sha256']:
        raise ValueError("模型文件校验失败，请重新安装。")
    engine = Interpreter(model_content=model_bytes, num_threads=2,
                         experimental_op_resolver_type=OpResolverType.BUILTIN_WITHOUT_DEFAULT_DELEGATES)
    engine.allocate_tensors()
    inp, out = engine.get_input_details()[0], engine.get_output_details()[0]
    if list(inp["shape"]) != [1, 30, 126] or list(out["shape"]) != [1, len(EXPECTED_LABELS)]:
        raise ValueError("模型维度与词表不一致，已停止识别。")
    labels = (MODEL / "dynamic_gesture_label.csv").read_text(encoding="utf-8-sig").splitlines()
    if labels != EXPECTED_LABELS:
        raise ValueError("模型标签与当前配置不一致。")
    return engine, inp, out


def predict(engine, inp, out, sequence):
    data = np.asarray(sequence, dtype=np.float32)
    if data.shape != (30, 126) or not np.isfinite(data).all():
        raise ValueError("手部特征格式异常。")
    engine.set_tensor(inp["index"], data[None, ...])
    engine.invoke()
    scores = engine.get_tensor(out["index"])[0]
    if scores.shape != (len(EXPECTED_LABELS),) or not np.isfinite(scores).all():
        raise ValueError("模型分数异常。")
    return scores


def features(results):
    slots = {"Left": np.zeros(63, np.float32), "Right": np.zeros(63, np.float32)}
    if not results.multi_hand_landmarks:
        return None
    for landmarks, hand in zip(results.multi_hand_landmarks, results.multi_handedness or []):
        label = hand.classification[0].label
        if label not in slots:
            continue
        xyz = np.array([[p.x, p.y, p.z] for p in landmarks.landmark], np.float32)
        xyz -= xyz[0]
        scale = np.max(np.abs(xyz))
        if scale > 0:
            xyz /= scale
        slots[label] = xyz.reshape(-1)
    result = np.concatenate([slots["Left"], slots["Right"]])
    return result if np.any(result) and np.isfinite(result).all() else None


def decision(scores, coverage, longest_gap):
    order = np.argsort(scores)[::-1]
    best, second = int(order[0]), int(order[1])
    score, margin = float(scores[best]), float(scores[best] - scores[second])
    checks = [
        {"code": "coverage", "passed": coverage >= 0.6, "detail": f"有手区间内可见比例 {coverage:.1%}，要求至少 60%"},
        {"code": "gap", "passed": longest_gap <= 0.6, "detail": f"区间内部连续丢手 {longest_gap:.2f} 秒，要求不超过 0.60 秒"},
        {"code": "score", "passed": score >= 0.8, "detail": f"模型最高分 {score:.1%}，要求至少 80%"},
        {"code": "margin", "passed": margin >= 0.25, "detail": f"前两类分差 {margin:.1%}，要求至少 25%"},
        {"code": "scope", "passed": best in ALLOWED, "detail": "模型最高分类" + ("在" if best in ALLOWED else "不在") + "本轮开放的四词范围内"},
    ]
    diagnostics = {"checks": checks, "score_margin": round(margin, 4)}
    failed = [item["detail"] for item in checks[:4] if not item["passed"]]
    if failed:
        return {"status": "uncertain", "candidate": None, "score": round(score, 4), "reason": "；".join(failed) + "。", **diagnostics}
    if best not in ALLOWED:
        return {"status": "unsupported", "candidate": None, "score": round(score, 4), "reason": "模型最高分落在本轮开放词表之外，不自动改成其他词。", **diagnostics}
    return {"status": "candidate", "candidate": EXPECTED_LABELS[best], "sign_id": ENTRIES[best]['id'], "score": round(score, 4), "reason": "仅为实验候选，请核对实际含义；分数不是识别准确率。", **diagnostics}


def hand_interval(observations, duration):
    """Exclude only leading/trailing no-hand samples; keep all interior gaps.

    This is a visibility interval, not word segmentation or proof of complete
    action capture. No-hand frames between gestures must still cause rejection.
    """
    found = [i for i, (_, present) in enumerate(observations) if present]
    if not found:
        return {"active_sampled_frames": 0, "active_hand_coverage": 0.0,
                "internal_missing_seconds": 0.0, "trimmed_leading_seconds": 0.0,
                "trimmed_trailing_seconds": 0.0, "active_span_seconds": None}
    first, last = found[0], found[-1]
    missing_since = None
    longest = 0.0
    for timestamp, present in observations[first:last + 1]:
        if not present and missing_since is None:
            missing_since = timestamp
        elif present and missing_since is not None:
            longest = max(longest, timestamp - missing_since)
            missing_since = None
    return {"active_sampled_frames": last - first + 1,
            "active_hand_coverage": len(found) / (last - first + 1),
            "internal_missing_seconds": longest,
            "trimmed_leading_seconds": observations[first][0],
            "trimmed_trailing_seconds": max(0, duration - observations[last][0] - 1 / 15),
            "active_span_seconds": [observations[first][0], observations[last][0]]}


def hand_graph():
    """Load graph through Python and relative resources for Windows Unicode paths.

    MediaPipe 0.10.21 native graph file opening fails on this Chinese workspace
    path. This isolated process uses the same bundled graph/options as Hands;
    no package modification or assets outside the project are required.
    """
    import mediapipe as mp
    from mediapipe.framework import calculator_pb2
    from mediapipe.python import solution_base
    root = Path(mp.__file__).resolve().parent.parent
    graph = calculator_pb2.CalculatorGraphConfig()
    graph.ParseFromString((root / 'mediapipe/modules/hand_landmark/hand_landmark_tracking_cpu.binarypb').read_bytes())
    original = solution_base.resource_util.set_resource_dir
    solution_base.resource_util.set_resource_dir = lambda path: original(os.path.relpath(path, ROOT))
    try:
        return solution_base.SolutionBase(
            graph_config=graph,
            side_inputs={'model_complexity': 1, 'num_hands': 2, 'use_prev_landmarks': True},
            calculator_params={'palmdetectioncpu__TensorsToDetectionsCalculator.min_score_thresh': 0.7,
                               'handlandmarkcpu__ThresholdingCalculator.threshold': 0.5},
            outputs=['multi_hand_landmarks', 'multi_handedness'],
        )
    finally:
        solution_base.resource_util.set_resource_dir = original


def recognize(path, sequence=False):
    import cv2
    if sequence:
        from sign_segmentation import CONFIG
    started = time.perf_counter()
    cap = cv2.VideoCapture(str(path.relative_to(ROOT)))
    if not cap.isOpened():
        raise ValueError("无法解码视频，请重新录制。")
    values, timestamps, observations = [], [], []
    timeline = []
    decoded = sampled = 0
    missing_since = None
    longest_gap = 0.0
    duration = 0.0
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        width, height = cap.get(cv2.CAP_PROP_FRAME_WIDTH), cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        if not np.isfinite([width, height]).all() or max(width, height) > 4096 or width * height > 3840 * 2160:
            raise ValueError("视频尺寸不支持。")
        fallback_fps = fps if np.isfinite(fps) and 1 <= fps <= 120 else None
        previous_time = -1.0
        last_step = 1 / fallback_fps if fallback_fps else 0.0
        time_source = 'decoder_pts'
        next_sample = 0.0
        with hand_graph() as hands:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                pts = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
                if np.isfinite(pts) and pts >= 0 and (decoded == 0 or pts > previous_time):
                    timestamp = pts
                elif fallback_fps:
                    timestamp = decoded / fallback_fps
                    time_source = 'fps_fallback'
                else:
                    raise ValueError("无法确定录像时间顺序，请重新录制。")
                if previous_time >= 0:
                    last_step = timestamp - previous_time
                if last_step < 0:
                    raise ValueError("录像时间戳不连续，请重新录制。")
                previous_time = timestamp
                decoded += 1
                duration = timestamp + last_step
                if duration > (CONFIG['maximumVideoSeconds'] if sequence else 10.25) or decoded > (3690 if sequence else 1230):
                    raise ValueError('多动作实验限30秒，请缩短录像。' if sequence else '当前为单动作实验，请使用0.5–10秒短视频；多动作请选择停顿分段实验。')
                if timestamp + 0.0001 < next_sample:
                    continue
                next_sample += 1 / 15
                sampled += 1
                frame_height, frame_width = frame.shape[:2]
                if min(frame_height, frame_width) < 16 or max(frame_height, frame_width) > 4096 or frame_height * frame_width > 3840 * 2160:
                    raise ValueError("解码后的画面尺寸不支持。")
                scale = min(1, 640 / max(frame.shape[:2]))
                frame = cv2.resize(frame, (round(frame.shape[1] * scale), round(frame.shape[0] * scale)))
                # Match upstream live-camera convention; original video is never altered.
                rgb = cv2.cvtColor(cv2.flip(frame, 1), cv2.COLOR_BGR2RGB)
                detection = hands.process({'image': rgb})
                value = features(detection)
                if sequence:
                    low = bool(detection.multi_hand_landmarks) and all(hand.landmark[0].y >= CONFIG['restWristY'] for hand in detection.multi_hand_landmarks)
                    timeline.append({'t': timestamp, 'value': value, 'rest': value is None or low})
                observations.append((timestamp, value is not None))
                if value is None:
                    if missing_since is None:
                        missing_since = timestamp
                else:
                    if missing_since is not None:
                        longest_gap = max(longest_gap, timestamp - missing_since)
                    missing_since = None
                    values.append(value)
                    timestamps.append(round(timestamp, 3))
        if missing_since is not None:
            longest_gap = max(longest_gap, duration - missing_since)
    finally:
        cap.release()
    if decoded == 0 or duration < 0.5:
        raise ValueError("视频太短或无法解码，请录制至少 0.5 秒。")
    interval = hand_interval(observations, duration)
    report = {"engine": "MediaPipe Hands + Conv1D / TFLite", "experimental": True, "standard_validated": False,
              "duration_seconds": round(duration, 3), "time_source": time_source, "decoded_frames": decoded, "sampled_frames": sampled,
              "hand_frames": len(values), "sample_fps_limit": 15, "model_frames": 30,
              "hand_coverage": round(len(values) / max(sampled, 1), 3), "longest_missing_seconds": round(longest_gap, 3),
              "mirrored_for_model": True, "processing_ms": 0, **interval,
              "diagnostic_version": 2, "catalog_version": CATALOG['catalogVersion'],
              "model_id": CATALOG['recognitionModel']['id'], "feature_layout_version": FEATURES['id'],
              "limitations": ["仅开放你好、再见、对不起、谢谢四词；不是整句翻译。", "模型原动作尚未完成国家通用手语及跨使用者验证。", "仅使用双手特征，不识别面部、身体位置和语法；未知动作也可能得到高分。", "采样、拒识阈值与镜像策略为实验参数，尚未经真实视频校准。"]}
    if sequence:
        from sign_segmentation import recognize_segments
        loaded = None
        def classify(segment):
            nonlocal loaded
            if loaded is None:
                loaded = classifier()
            return predict(*loaded, segment)
        report.update(recognize_segments(timeline, duration, classify, decision, hand_interval))
        report['limitations'] = ['仅按双手放低或出画约1秒的停顿分段，遮挡也可能误分段。', '每段复用原四词模型；高分不等于准确率，需核对顺序和重复词。', '未识别片段不会跳过，也不会自动编句或播报。']
    elif len(values) < 8:
        report.update(status="no_hands" if not values else "uncertain", candidate=None, score=None,
                      reason=f"没有足够的清晰手部画面：检测到 {len(values)} 个，至少需要 8 个。请让双手完整入镜。",
                      checks=[{"code": "hand_count", "passed": False, "detail": f"有手采样 {len(values)} 个，要求至少 8 个"}])
    else:
        engine, inp, out = classifier()
        indexes = np.linspace(0, len(values) - 1, 30).astype(int)
        scores = predict(engine, inp, out, np.asarray(values)[indexes])
        report.update(decision(scores, interval['active_hand_coverage'], interval['internal_missing_seconds']))
        report["feature_span_seconds"] = [timestamps[0], timestamps[-1]]
    report["processing_ms"] = round((time.perf_counter() - started) * 1000)
    return report


if __name__ == "__main__":
    try:
        result = recognize(Path(sys.argv[1]), sequence='--sequence' in sys.argv[2:])
    except ValueError as error:
        result = {"error": str(error), "status": 422}
    except Exception:
        result = {"error": "动作实验运行失败，请检查模型与运行环境。", "status": 503}
    print(json.dumps(result, ensure_ascii=False), flush=True)
