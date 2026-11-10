"""Read-only hand/body feasibility diagnostics, never a recognition classifier.

Only aggregate measurements are saved. No images, skeleton templates, labels,
training features or weights are exported or changed.
"""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse, hashlib, importlib.util, json, os, sqlite3, sys
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from sign_training_data import inventory
from me_motion import inspect_me_motion

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

# Reuse installed MediaPipe graph setup only, not the avatar export entry point.
graphs = load('local_motion_graphs', ROOT / 'scripts/extract-sign-motion.py')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--latest-owner', required=True, action='store_true')
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument('--sample', action='append')
    selection.add_argument('--all-registered', action='store_true')
    args = parser.parse_args()
    all_items = inventory()
    items = [r for r in all_items if (args.all_registered and r['category'] != 'uncertain' and r['reviewed']) or (args.sample and r['sampleNumber'] in args.sample)]
    if args.sample and len(items) != len(set(args.sample)):
        raise ValueError('requested_samples_missing')
    os.chdir(ROOT)
    db = _project_db_connect((ROOT / 'data/app.sqlite').as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    reports = []
    try:
        for item in items:
            row = db.execute('SELECT s.payload,r.media_file,r.byte_length FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.record_id=? AND s.user_id=?', (item['recordId'], item['ownerId'])).fetchone()
            payload = json.loads(row['payload'])
            path = (ROOT / 'data/media' / row['media_file']).resolve()
            if not path.is_relative_to(ROOT / 'data/media') or path.stat().st_size != row['byte_length'] or hashlib.sha256(path.read_bytes()).hexdigest() != item['sourceHash']:
                raise ValueError('source_changed')
            cap = cv2.VideoCapture(str(path.relative_to(ROOT)))
            if not cap.isOpened():
                raise ValueError('source_decode_failed')
            counts = dict(sampledFrames=0, bodyFrames=0, handFrames=0, jointFrames=0)
            measurements, timeline = [], []
            previous, first, next_sample, decoded = -1., None, payload['startSeconds'], 0
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
                        next_sample = t + .03
                        height, width = frame.shape[:2]
                        rgb = cv2.cvtColor(cv2.resize(cv2.flip(frame, 1), (640, round(height * 640 / width))), cv2.COLOR_BGR2RGB)
                        h, p = hands.process({'image': rgb}), pose.process({'image': rgb})
                        counts['sampledFrames'] += 1
                        hs = h.multi_hand_landmarks or []
                        counts['handFrames'] += bool(hs)
                        raw_hands = [np.array([[v.x, v.y * height / width, v.z] for v in lm.landmark]) for lm in hs]
                        raw_shoulders = [[p.pose_landmarks.landmark[i].x, p.pose_landmarks.landmark[i].y * height / width, p.pose_landmarks.landmark[i].visibility] for i in (11, 12)] if p.pose_landmarks else []
                        timeline.append((float(t), raw_hands, raw_shoulders))
                        if not p.pose_landmarks:
                            continue
                        left, right = [p.pose_landmarks.landmark[i] for i in (11, 12)]
                        if min(left.visibility, right.visibility) < .6:
                            continue
                        shoulders = np.array([[v.x, v.y * height / width] for v in (left, right)])
                        span = np.linalg.norm(shoulders[1] - shoulders[0])
                        if not np.isfinite(span) or span < .08:
                            continue
                        # Shoulder midpoint is only an upper-torso proxy, not an
                        # anatomical chest landmark or a 3D point of contact.
                        center = shoulders.mean(axis=0)
                        counts['bodyFrames'] += 1
                        counts['jointFrames'] += bool(hs)
                        for lm in hs:
                            xyz = np.array([[v.x, v.y * height / width, v.z] for v in lm.landmark])
                            if not np.isfinite(xyz).all():
                                continue
                            index = xyz[8, :2] - xyz[5, :2]
                            target = center - xyz[5, :2]
                            cosine = float(np.dot(index, target) / max(np.linalg.norm(index) * np.linalg.norm(target), 1e-8))
                            def straight(a, b, c):
                                u, v = xyz[a] - xyz[b], xyz[c] - xyz[b]
                                return float(np.degrees(np.arccos(np.clip(np.dot(u, v) / max(np.linalg.norm(u) * np.linalg.norm(v), 1e-8), -1, 1))))
                            measurements.append([np.linalg.norm(xyz[8, :2] - center) / span, cosine, straight(5, 6, 8), np.mean([straight(a, a+1, a+3) for a in (9, 13, 17)])])
            finally:
                cap.release()
            current = db.execute('SELECT active,revision,source_sha256 FROM sign_samples WHERE record_id=? AND user_id=?', (item['recordId'], item['ownerId'])).fetchone()
            if not current or not current['active'] or current['revision'] != item['revision'] or current['source_sha256'] != item['sourceHash'] or hashlib.sha256(path.read_bytes()).hexdigest() != item['sourceHash']:
                raise ValueError('sample_changed_during_audit')
            stats = {}
            if measurements:
                values = np.array(measurements)
                for j, name in enumerate(('tipToShoulderMidpointOverShoulderSpan', 'indexTowardShoulderMidpointCosine', 'indexPipAngleDegrees', 'otherThreePipMeanDegrees')):
                    stats[name] = dict(zip(('p10', 'median', 'p90'), np.round(np.percentile(values[:, j], [10, 50, 90]), 4).tolist()))
            reports.append({'sampleNumber': item['sampleNumber'], 'category': item['category'], 'revision': item['revision'], 'sourceHash': item['sourceHash'], **counts, 'measurements': stats, 'bodyPointingHypothesis': inspect_me_motion(timeline)})
        print(json.dumps({'scope': 'development_body_reference_feasibility_only', 'reports': reports, 'semanticVerified': False, 'trained': False, 'productionChanged': False, 'databaseChanged': False, 'rawFramesPersisted': False, 'limitations': ['2D shoulder midpoint is a torso proxy, not measured chest depth', 'aggregate geometry does not establish pointing at self or sign meaning', 'same capture group is not independent validation']}, ensure_ascii=False))
    finally:
        db.close()

if __name__ == '__main__':
    main()
