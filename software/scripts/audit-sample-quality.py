"""Read-only pilot checks. No training, label changes, frame or feature exports."""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
import numpy as np
from sign_worker import features, hand_graph, hand_interval, FEATURES
from realtime_window import CONFIG
from please_observation import spatial_hands


def evaluate(category, start, end, duration, observations, values, observed_both_hands=None):
    reasons = []
    warnings = []
    if not 0 <= start < end <= duration + .05:
        reasons.append('annotation_outside_decoded_duration')
    if not observations:
        reasons.append('empty_annotated_interval')
    interval = hand_interval(observations, duration)
    visible = sum(present for _, present in observations)
    movement = float(np.mean(np.abs(np.diff(values, axis=0)))) if len(values) > 1 else 0.0
    if category in ('thanks','help','need','please'):
        if visible < CONFIG['minHandSamples']:
            reasons.append('insufficient_hand_samples')
        span = interval['active_span_seconds']
        if span and span[1]-span[0] > CONFIG['maxWindowSeconds']:
            warnings.append('hand_span_exceeds_current_live_window')
        if not span or span[1]-span[0] < CONFIG['minSpanSeconds']:
            reasons.append('insufficient_hand_span')
        if interval['active_hand_coverage'] < .6:
            reasons.append('low_internal_hand_visibility')
        if interval['internal_missing_seconds'] > .6:
            reasons.append('long_internal_tracking_gap')
        if category=='thanks' and movement < CONFIG['minFeatureMotion']:
            reasons.append('little_feature_motion')
    if category=='need':warnings.append('need_inward_trajectory_requires_review')
    if category=='me':
        if visible<CONFIG['minHandSamples']:reasons.append('insufficient_hand_samples')
        if interval['active_hand_coverage']<.6:reasons.append('low_internal_hand_visibility')
        if interval['internal_missing_seconds']>.6:reasons.append('long_internal_tracking_gap')
        warnings.append('me_self_direction_requires_body_reference_review')
    feature_both=sum(bool(np.any(v[:63])) and bool(np.any(v[63:])) for v in values)
    both_hands=observed_both_hands if category=='please' and observed_both_hands is not None else feature_both
    if category in ('help','please'):
        if both_hands<CONFIG['minHandSamples'] or both_hands/max(1,len(values))<.6:
            reasons.append('insufficient_both_hands_visibility')
        warnings.append('help_motion_requires_absolute_wrist_analysis' if category=='help' else 'please_lateral_trajectory_and_palm_orientation_require_review')
    if category == 'uncertain':
        reasons.append('uncertain_label_excluded')
    return {
        'technicalStatus': 'needs_review' if reasons else 'pilot_checks_passed',
        'reasons': reasons, 'warnings': warnings, 'sampledFrames': len(observations), 'handFrames': visible,
        'handCoverage': round(visible/max(1, len(observations)), 4),
        'internalHandCoverage': round(interval['active_hand_coverage'], 4),
        'internalMissingSeconds': round(interval['internal_missing_seconds'], 3),
        'handSpanSeconds': interval['active_span_seconds'],
        'meanFeatureMotion': round(movement, 6),
        'backgroundWithNoHands': category == 'background' and visible == 0,
        'bothHandFrames':both_hands,
        'featureBothHandFrames':feature_both,
        'bothHandBasis':'distinct_spatial_observations' if category=='please' and observed_both_hands is not None else 'anatomical_feature_slots',
        'semanticVerified': False, 'trainingReady': False,
    }


def inspect_video(path, payload, on_sample=None, sample_interval_ms=None, max_image_edge=None, on_observation=None):
    import cv2
    cap = cv2.VideoCapture(str(path.relative_to(ROOT)))
    if not cap.isOpened():
        cap.release()
        raise ValueError('video_decode_failed')
    start, end = payload['startSeconds'], payload['endSeconds']
    interval_ms=CONFIG['frameIntervalMs'] if sample_interval_ms is None else sample_interval_ms
    image_edge=CONFIG['maxImageEdge'] if max_image_edge is None else max_image_edge
    if not isinstance(image_edge,int) or not 16<=image_edge<=4096:
        cap.release();raise ValueError('invalid_image_edge')
    if not np.isfinite(interval_ms) or interval_ms<0:
        cap.release();raise ValueError('invalid_sample_interval')
    observations, values, steps = [], [], []
    observed_both_hands=0
    decoded, previous, first_pts, next_sample = 0, -1.0, None, start
    fallback = False
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        width, height = cap.get(cv2.CAP_PROP_FRAME_WIDTH), cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        if not np.isfinite([width,height]).all() or min(width,height)<=0 or max(width,height)>4096 or width*height>3840*2160:
            raise ValueError('unsupported_dimensions')
        usable_fps = np.isfinite(fps) and 1 <= fps <= 120
        with hand_graph() as hands:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                pts = cap.get(cv2.CAP_PROP_POS_MSEC)/1000
                if first_pts is None:
                    first_pts = pts if np.isfinite(pts) and pts >= 0 else 0
                timestamp = pts-first_pts
                if not np.isfinite(timestamp) or timestamp < 0 or timestamp <= previous:
                    if not usable_fps:
                        raise ValueError('invalid_video_timestamps')
                    timestamp = max(decoded/fps, previous+1/fps)
                    fallback = True
                if previous >= 0:
                    steps.append(timestamp-previous)
                decoded += 1
                previous = timestamp
                if decoded > 4000 or timestamp > 32:
                    raise ValueError('video_exceeds_pilot_limits')
                if timestamp < start or timestamp >= end or timestamp+1e-6 < next_sample:
                    continue
                next_sample = timestamp+interval_ms/1000
                scale = min(1, image_edge/max(frame.shape[:2]))
                if scale < 1:
                    frame = cv2.resize(frame, (round(frame.shape[1]*scale), round(frame.shape[0]*scale)))
                # Same single mirror and feature convention as the realtime worker.
                rgb = cv2.cvtColor(cv2.flip(frame, 1), cv2.COLOR_BGR2RGB)
                observation=hands.process({'image': rgb})
                if payload['category']=='please':
                    observed_both_hands+=len(spatial_hands(observation,height/width))==2
                value = features(observation)
                if on_observation is not None:
                    on_observation(timestamp,observation)
                if on_sample is not None:
                    on_sample(timestamp,value)
                observations.append((timestamp, value is not None))
                if value is not None:
                    values.append(value)
        if decoded == 0:
            raise ValueError('empty_video')
        step = float(np.median(steps[-30:])) if steps else 1/fps if usable_fps else 0
        duration = previous+step
        return {'decodedFrames': decoded, 'decodedDurationSeconds': round(duration, 3),
                'dimensions': [int(width),int(height)],
                'timestampSource': 'fps_fallback' if fallback else 'decoder_pts',
                **evaluate(payload['category'], start, end, duration, observations, values,observed_both_hands if payload['category']=='please' else None)}
    finally:
        cap.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--latest-owner', action='store_true', required=True,
                        help='Inspect active pilot entries of the most recently edited owner')
    parser.add_argument('--limit',type=int,default=10,help='Maximum entries to inspect (1 to 100; default 10)')
    args=parser.parse_args()
    if not 1 <= args.limit <= 100:
        parser.error('--limit must be between 1 and 100')
    os.chdir(ROOT)
    db = _project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        owner = db.execute('SELECT user_id FROM sign_samples WHERE active=1 ORDER BY updated_at DESC LIMIT 1').fetchone()
        if owner is None:
            raise ValueError('no_registered_samples')
        total=db.execute('SELECT COUNT(*) FROM sign_samples WHERE user_id=? AND active=1',(owner['user_id'],)).fetchone()[0]
        rows = db.execute('SELECT s.*, r.media_file, r.byte_length, r.duration FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.user_id=? AND s.active=1 ORDER BY s.updated_at DESC LIMIT ?', (owner['user_id'],args.limit)).fetchall()
        has_numbers=bool(db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sample_numbers'").fetchone())
        prefixes=json.loads((ROOT/'shared/sample-numbering.json').read_text(encoding='utf8'))
        reports = []
        batches, performers = set(), set()
        for row in rows:
            payload = json.loads(row['payload'])
            batches.add(payload['batch']); performers.add(payload['performer'])
            report = {'category': payload['category'], 'revision': row['revision'],
                      'annotatedSeconds': [payload['startSeconds'],payload['endSeconds']],
                      'declaredDurationSeconds': row['duration']}
            if has_numbers:
                number=db.execute('SELECT sequence FROM sample_numbers WHERE user_id=? AND record_id=? AND category=?',(row['user_id'],row['record_id'],payload['category'])).fetchone()
                report['sampleNumber']=f"{prefixes[payload['category']]}.{number['sequence']}" if number else None
            try:
                path = (ROOT/'data/media'/row['media_file']).resolve()
                if not path.is_relative_to((ROOT/'data/media').resolve()) or not path.is_file():
                    raise ValueError('source_missing_or_invalid')
                if path.stat().st_size != row['byte_length'] or path.stat().st_size > 32*1024*1024:
                    raise ValueError('source_size_changed')
                if hashlib.sha256(path.read_bytes()).hexdigest() != row['source_sha256']:
                    raise ValueError('source_hash_changed')
                report.update(inspect_video(path, payload))
                current = db.execute('SELECT active,revision,source_sha256 FROM sign_samples WHERE record_id=? AND user_id=?', (row['record_id'], row['user_id'])).fetchone()
                if not current or not current['active'] or current['revision'] != row['revision'] or current['source_sha256'] != row['source_sha256'] or not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != row['source_sha256']:
                    raise ValueError('sample_changed_during_audit')
            except (OSError, ValueError) as error:
                # Avoid leaking paths or sample payload in errors.
                report = {**report, 'technicalStatus': 'needs_review', 'error': str(error) if isinstance(error,ValueError) else 'source_read_failed', 'trainingReady': False}
            reports.append(report)
        print(json.dumps({'featureProtocol': FEATURES['id'], 'sampleCount': len(reports),'totalSampleCount':total,'truncated':len(reports)<total,
                          'sameBatch': len(batches)==1, 'samePerformer':len(performers)==1,
                          'reports': reports, 'databaseChanged':False, 'trainingStarted':False}, ensure_ascii=True))
    finally:
        db.close()


if __name__ == '__main__':
    main()
