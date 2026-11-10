"""Offline self-pointing evidence experiment, not a deployed word classifier.

Input image coordinates use x and z in image-width units and y corrected to
image-width units. The chest point is a torso-relative reference (shoulder
midpoint offset downward), not measured depth or a touch landmark. No
missing-body/hand carry-over or synthetic landmarks.
"""
import json
from pathlib import Path
import numpy as np

RULES = json.loads((Path(__file__).resolve().parents[1] / 'shared/me-motion.json').read_text(encoding='utf8'))

def angle(a, b, c):
    u, v = a - b, c - b
    denominator = np.linalg.norm(u) * np.linalg.norm(v)
    if denominator < 1e-8:
        return None
    return float(np.degrees(np.arccos(np.clip(np.dot(u, v) / denominator, -1, 1))))

def chest_point(center, span):
    """Upper-chest reference below the shoulder midpoint in image space.

    Camera roll shifts this estimate; it is not an anatomical landmark.
    """
    return np.asarray(center, dtype=float) + np.array([0., RULES['chestOffsetShoulderSpans'] * span])

def evaluate_hand(hand, center, span, chest):
    """Per-hand shape and direction values plus the rule outcomes.

    Straightness and folding are judged by the better-conditioned estimate:
    projection keeps a straight finger straight but collapses when the finger
    points at the camera, while estimated depth is noisy but survives that
    case. Taking the more permissive estimate of the two does not lower the
    numeric thresholds, it avoids rejecting a straight finger for a depth
    estimation error.
    """
    hand = np.asarray(hand, dtype=float)
    if hand.shape != (21, 3) or not np.isfinite(hand).all():
        return None
    angles = [angle(hand[i], hand[i + 1], hand[i + 3]) for i in (5, 9, 13, 17)]
    flat = np.hstack([hand[:, :2], np.zeros((21, 1))])
    angles_2d = [angle(flat[i], flat[i + 1], flat[i + 3]) for i in (5, 9, 13, 17)]
    if any(a is None for a in angles + angles_2d):
        return None
    index_angle = max(angles[0], angles_2d[0])
    other_mean = min(float(np.mean(angles[1:])), float(np.mean(angles_2d[1:])))
    direction, target = hand[8, :2] - hand[5, :2], np.asarray(chest)[:2] - hand[5, :2]
    denominator = float(np.linalg.norm(direction) * np.linalg.norm(target))
    cosine = None if denominator < 1e-8 else float(np.clip(np.dot(direction, target) / denominator, -1, 1))
    shoulder = np.asarray(center, dtype=float)[:2] - hand[5, :2]
    shoulder_denominator = float(np.linalg.norm(direction) * np.linalg.norm(shoulder))
    shoulder_cosine = None if shoulder_denominator < 1e-8 else float(np.clip(np.dot(direction, shoulder) / shoulder_denominator, -1, 1))
    distance = float(np.linalg.norm(hand[8, :2] - np.asarray(center, dtype=float)[:2]) / span)
    # A finger pointing back toward the body can be foreshortened/occluded.
    # Treat receding estimated depth as an alternative cue, never as measured
    # contact or a word label; chest, other fingers, time and model still gate it.
    ray = hand[8] - hand[5]
    ray_length = float(np.linalg.norm(ray))
    palm_length = float(np.linalg.norm(hand[9] - hand[0]))
    depth_fraction = float(ray[2] / ray_length) if ray_length > 1e-8 else 0.
    ray_ratio = ray_length / palm_length if palm_length > 1e-8 else 0.
    extended = index_angle >= RULES['minIndexAngleDegrees']
    receding = depth_fraction >= RULES['minRecedingIndexFraction'] and ray_ratio >= RULES['minIndexRayPalmRatio']
    return {
        'indexAngle': index_angle,
        'otherMean': other_mean,
        'indexAngle3d': angles[0],
        'indexAngle2d': angles_2d[0],
        'otherMean3d': float(np.mean(angles[1:])),
        'otherMean2d': float(np.mean(angles_2d[1:])),
        'pointingCosine': cosine,
        'shoulderCosine': shoulder_cosine,
        'tipDistance': distance,
        'indexExtended': extended,
        'indexPointing': extended or receding,
        'recedingIndex': receding,
        'indexDepthFraction': depth_fraction,
        'indexRayPalmRatio': ray_ratio,
        'otherFingersFolded': other_mean <= RULES['maxOtherFingerMeanDegrees'],
        'towardChest': cosine is not None and cosine >= RULES['minPointingCosine'],
        'nearBody': distance <= RULES['maxTipDistanceShoulderSpans'],
    }

def frame_evidence(hands, shoulders):
    body = np.asarray(shoulders, dtype=float)
    if body.shape != (2, 3) or not np.isfinite(body).all() or min(body[:, 2]) < RULES['minShoulderVisibility']:
        return {'supported': False, 'reason': 'missing_body_reference'}
    center = body[:, :2].mean(axis=0)
    span = float(np.linalg.norm(body[0, :2] - body[1, :2]))
    if span < RULES['minShoulderSpan']:
        return {'supported': False, 'reason': 'invalid_body_scale'}
    chest = chest_point(center, span)
    candidates = []
    for raw in hands:
        values = evaluate_hand(raw, center, span, chest)
        if values is None:
            continue
        if values['indexPointing'] and values['otherFingersFolded'] and values['towardChest'] and values['nearBody']:
            wrist = (np.asarray(raw, dtype=float)[0, :2] - center) / span
            candidates.append({'wristRelative': wrist.tolist(), **values})
    if len(candidates) != 1:
        return {'supported': False, 'reason': 'ambiguous_hands' if candidates else 'insufficient_shape_direction_evidence'}
    return {'supported': True, **candidates[0]}

def inspect_me_motion(timeline):
    runs, run, previous, last = [], [], None, None
    reasons = {}
    def finish():
        if run:
            span = run[-1][0] - run[0][0]
            runs.append({'start': run[0][0], 'end': run[-1][0], 'frames': len(run), 'supported': len(run) >= RULES['minFrames'] and span >= RULES['minSupportSeconds']})
    for timestamp, hands, shoulders in timeline:
        if not np.isfinite(timestamp) or timestamp < 0 or previous is not None and timestamp <= previous:
            raise ValueError('invalid_timestamp_order')
        evidence = frame_evidence(hands, shoulders)
        broken = previous is not None and timestamp - previous > RULES['maxGapSeconds']
        if evidence['supported'] and last is not None:
            broken = broken or np.linalg.norm(np.array(evidence['wristRelative']) - last) > RULES['maxWristStepShoulderSpans']
        if broken or not evidence['supported']:
            finish()
            run, last = [], None
        if evidence['supported']:
            run.append((float(timestamp), evidence))
            last = np.array(evidence['wristRelative'])
        else:
            reason = evidence['reason']
            reasons[reason] = reasons.get(reason, 0) + 1
        previous = timestamp
    finish()
    return {'protocol': RULES['id'], 'scope': 'development_geometry_not_semantic_recognition', 'supported': any(r['supported'] for r in runs), 'runs': runs, 'rejectedFrames': reasons, 'productionEligible': False}
