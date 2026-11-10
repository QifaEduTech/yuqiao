"""Read-only comparison of the current shoulder-midpoint proxy with a chest-target
pointing measure. Aggregate diagnostics only: no images, keypoints, labels or
weights are exported, and production recognition is not touched.
"""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse
import hashlib
import importlib.util
import json
import os
import sqlite3
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from sign_training_data import inventory
from me_motion import RULES


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


graphs = load('local_motion_graphs', ROOT / 'scripts/extract-sign-motion.py')

SHOULDERS = (11, 12)
HIPS = (23, 24)


def unit(vector):
    norm = float(np.linalg.norm(vector))
    return None if norm < 1e-8 else vector / norm


def cosine(a, b):
    u, v = unit(a), unit(b)
    return None if u is None or v is None else float(np.clip(np.dot(u, v), -1, 1))


def angle(a, b, c):
    u, v = a - b, c - b
    value = cosine(u, v)
    return None if value is None else float(np.degrees(np.arccos(value)))


def torso_points(pose_landmarks, aspect):
    """Return shoulders (2x3 xyz) and a chest point in the same normalized units.

    Pose z is the same normalized image space as the x/y values MediaPipe emits
    for hands; it is not measured depth. The chest is a torso-relative point,
    not a touch landmark.
    """
    lm = pose_landmarks.landmark
    shoulders = np.array([[lm[i].x, lm[i].y * aspect, lm[i].z] for i in SHOULDERS])
    visibility = np.array([lm[i].visibility for i in SHOULDERS])
    span = float(np.linalg.norm(shoulders[0, :2] - shoulders[1, :2]))
    center = shoulders.mean(axis=0)
    hips = np.array([[lm[i].x, lm[i].y * aspect, lm[i].z] for i in HIPS])
    hip_visibility = np.array([lm[i].visibility for i in HIPS])
    if hip_visibility.min() >= .5 and np.isfinite(hips).all():
        chest = center + .30 * (hips.mean(axis=0) - center)
        source = 'hips'
    else:
        chest = center + np.array([0., .30 * span, 0.])
        source = 'shoulder_offset'
    return shoulders, visibility, span, center, chest, source


def hand_measures(hand, shoulders, visibility, span, center, chest):
    angles = [angle(hand[i], hand[i + 1], hand[i + 3]) for i in (5, 9, 13, 17)]
    if any(a is None for a in angles):
        return None
    # Projection keeps a straight finger straight even when it points at the
    # camera, so 2D joint angles are more robust to estimated depth than 3D ones.
    flat_hand = np.hstack([hand[:, :2], np.zeros((21, 1))])
    angles_2d = [angle(flat_hand[i], flat_hand[i + 1], flat_hand[i + 3]) for i in (5, 9, 13, 17)]
    ray = hand[8] - hand[5]
    old_2d = cosine(ray[:2], center[:2] - hand[5, :2])
    chest_2d = cosine(ray[:2], chest[:2] - hand[5, :2])
    chest_3d = cosine(ray, chest - hand[5])
    flat = float(np.linalg.norm(ray[:2]))
    ratio = float(np.linalg.norm(ray) / flat) if flat > 1e-8 else None
    direction = unit(ray)
    return {
        'indexAngle': angles[0],
        'otherMean': float(np.mean(angles[1:])),
        'indexAngle2d': angles_2d[0],
        'otherMean2d': float(np.mean(angles_2d[1:])),
        'oldCosine2d': old_2d,
        'oldTipDistance': float(np.linalg.norm(hand[8, :2] - center[:2]) / span),
        'chestCosine2d': chest_2d,
        'chestCosine3d': chest_3d,
        'chestTipDistance': float(np.linalg.norm(hand[8] - chest) / span),
        'tipDepthRatio': ratio,
        'indexRayPalmRatio':float(np.linalg.norm(ray)/max(np.linalg.norm(hand[9]-hand[0]),1e-8)),
        'downComponent': None if direction is None else float(direction[1]),
        'towardCamera': None if direction is None else float(-direction[2]),
    }


def passes(measure, rules):
    return bool(measure and measure['indexAngle'] >= rules['minIndexAngleDegrees']
                and measure['otherMean'] <= rules['maxOtherFingerMeanDegrees']
                and measure['oldCosine2d'] is not None
                and measure['oldCosine2d'] >= rules['minPointingCosine']
                and measure['oldTipDistance'] <= rules['maxTipDistanceShoulderSpans'])


def summarize(values):
    values = [v for v in values if v is not None and np.isfinite(v)]
    if not values:
        return None
    return dict(zip(('p10', 'median', 'p90'), np.round(np.percentile(values, [10, 50, 90]), 4).tolist()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--latest-owner', required=True, action='store_true')
    parser.add_argument('--interval', type=float, default=.06, help='seconds between sampled frames')
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument('--sample', action='append')
    selection.add_argument('--all-registered', action='store_true')
    args = parser.parse_args()
    items = [r for r in inventory()
             if (args.all_registered and r['category'] != 'uncertain' and r['reviewed'])
             or (args.sample and r['sampleNumber'] in args.sample)]
    if args.sample and len(items) != len(set(args.sample)):
        raise ValueError('requested_samples_missing')
    if not 0 < args.interval <= .2:
        raise ValueError('interval_out_of_range')
    os.chdir(ROOT)
    db = _project_db_connect((ROOT / 'data/app.sqlite').as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    reports = []
    try:
        for item in items:
            row = db.execute(
                'SELECT s.payload,r.media_file,r.byte_length FROM sign_samples s '
                'JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id '
                'WHERE s.record_id=? AND s.user_id=?',
                (item['recordId'], item['ownerId'])).fetchone()
            payload = json.loads(row['payload'])
            path = (ROOT / 'data/media' / row['media_file']).resolve()
            if not path.is_relative_to(ROOT / 'data/media') or path.stat().st_size != row['byte_length'] \
                    or hashlib.sha256(path.read_bytes()).hexdigest() != item['sourceHash']:
                raise ValueError('source_changed')
            cap = cv2.VideoCapture(str(path.relative_to(ROOT)))
            if not cap.isOpened():
                raise ValueError('source_decode_failed')
            measures, chest_source, previous, first, next_sample, decoded = [], {}, -1., None, payload['startSeconds'], 0
            hip_frames = body_frames = 0
            try:
                with graphs.graph('hands') as hands, graphs.graph('pose') as pose:
                    fps = cap.get(cv2.CAP_PROP_FPS)
                    usable_fps = np.isfinite(fps) and 1 <= fps <= 120
                    while True:
                        ok, frame = cap.read()
                        if not ok:
                            break
                        pts = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
                        if first is None:
                            first = pts
                        t = pts - first
                        if not np.isfinite(t) or t <= previous:
                            if not usable_fps:
                                raise ValueError('invalid_video_timestamps')
                            t = max(decoded / fps, previous + 1 / fps)
                        previous = t
                        decoded += 1
                        if decoded > 4000 or t > 32:
                            raise ValueError('source_too_long')
                        if t < payload['startSeconds'] or t >= payload['endSeconds'] or t < next_sample:
                            continue
                        next_sample = t + args.interval
                        height, width = frame.shape[:2]
                        aspect = height / width
                        rgb = cv2.cvtColor(cv2.resize(cv2.flip(frame, 1), (640, round(height * 640 / width))), cv2.COLOR_BGR2RGB)
                        h = hands.process({'image': rgb})
                        p = pose.process({'image': rgb})
                        if not p.pose_landmarks:
                            continue
                        shoulders, visibility, span, center, chest, source = torso_points(p.pose_landmarks, aspect)
                        if not np.isfinite(shoulders).all() or visibility.min() < RULES['minShoulderVisibility'] or span < RULES['minShoulderSpan']:
                            continue
                        body_frames += 1
                        hip_frames += source == 'hips'
                        chest_source[source] = chest_source.get(source, 0) + 1
                        for lm in h.multi_hand_landmarks or []:
                            xyz = np.array([[v.x, v.y * aspect, v.z] for v in lm.landmark])
                            if xyz.shape != (21, 3) or not np.isfinite(xyz).all():
                                continue
                            measure = hand_measures(xyz, shoulders, visibility, span, center, chest)
                            if measure:
                                measure['oldGate'] = passes(measure, RULES)
                                measures.append(measure)
            finally:
                cap.release()
            current = db.execute('SELECT active,revision,source_sha256 FROM sign_samples WHERE record_id=? AND user_id=?',
                                 (item['recordId'], item['ownerId'])).fetchone()
            if not current or not current['active'] or current['revision'] != item['revision'] \
                    or current['source_sha256'] != item['sourceHash'] \
                    or hashlib.sha256(path.read_bytes()).hexdigest() != item['sourceHash']:
                raise ValueError('sample_changed_during_audit')
            keys = ('indexAngle', 'otherMean', 'indexAngle2d', 'otherMean2d', 'oldCosine2d',
                    'oldTipDistance', 'chestCosine2d', 'chestCosine3d', 'chestTipDistance',
                    'tipDepthRatio', 'indexRayPalmRatio', 'downComponent', 'towardCamera')
            reports.append({
                'sampleNumber': item['sampleNumber'],
                'category': item['category'],
                'revision': item['revision'],
                'sourceHash': item['sourceHash'],
                'bodyFrames': body_frames,
                'hipReferencedChestFrames': hip_frames,
                'chestSource': chest_source,
                'frames': len(measures),
                'oldGateFrames': sum(m['oldGate'] for m in measures),
                'stats': {k: summarize([m[k] for m in measures]) for k in keys},
            })
            print('Measured ' + item['sampleNumber'], file=sys.stderr, flush=True)
        print(json.dumps({
            'scope': 'development_pointing_measure_comparison_only',
            'rules': RULES,
            'reports': reports,
            'semanticVerified': False,
            'trained': False,
            'productionChanged': False,
            'databaseChanged': False,
            'rawFramesPersisted': False,
            'limitations': [
                'Chest point is torso-relative, not a measured touch landmark',
                'Single-camera z is estimated depth and is not treated as ground truth',
                'Geometry does not establish sign meaning',
            ],
        }, ensure_ascii=False))
    finally:
        db.close()


if __name__ == '__main__':
    main()
