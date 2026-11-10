"""Verify actual TFLite inference, schema, sample-label agreement and rejection.

The bundled CSV is upstream development data, not an independent accuracy set.
"""
import json
import sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from sign_worker import classifier, predict, decision, hand_interval, EXPECTED_LABELS, recognize

engine, inp, out = classifier()
data = np.loadtxt(ROOT / '.runtime-logs/sign-source/dynamic_gesture_dataset.csv', delimiter=',', encoding='utf-8-sig')
assert data.shape[1] == 3781
counts = {}
examples = []
for label in range(10):
    rows = data[data[:, 0] == label]
    counts[EXPECTED_LABELS[label]] = len(rows)
    if not len(rows):
        continue
    row = rows[0]
    scores = predict(engine, inp, out, row[1:].reshape(30, 126))
    examples.append({'expected': EXPECTED_LABELS[label], 'predicted': EXPECTED_LABELS[int(np.argmax(scores))], 'score': float(np.max(scores))})
assert decision(np.array([.91,.01,.01,.01,.01,.01,.01,.01,.01,.01]), 0.3, 0)['status'] == 'uncertain'
assert decision(np.array([.01,.01,.01,.91,.01,.01,.01,.01,.01,.01]), 1, 0)['status'] == 'unsupported'
assert decision(np.ones(10) * .1, 1, 0)['status'] == 'uncertain'

# Regression: identical 30/89 totals can mean harmless edge waiting OR a broken
# interval. Trimming must distinguish them, not simply lower quality thresholds.
strong = np.array([.985, .002, .002, .002, .002, .002, .002, .001, .001, .001])
edge_waiting = [(i / 15, 20 <= i < 50) for i in range(89)]
interval = hand_interval(edge_waiting, 89 / 15)
assert interval['active_sampled_frames'] == 30 and interval['active_hand_coverage'] == 1
assert decision(strong, 30 / 89, 39 / 15)['status'] == 'uncertain'
assert decision(strong, interval['active_hand_coverage'], interval['internal_missing_seconds'])['status'] == 'candidate'
interior_missing = [(i / 15, i < 15 or i >= 74) for i in range(89)]
interior = hand_interval(interior_missing, 89 / 15)
assert interior['active_sampled_frames'] == 89
blocked = decision(strong, interior['active_hand_coverage'], interior['internal_missing_seconds'])
assert blocked['status'] == 'uncertain'
assert {item['code'] for item in blocked['checks'] if not item['passed']} == {'coverage', 'gap'}
assert '33.7%' in blocked['reason']
assert hand_interval([(0, False), (.1, False)], .2)['active_span_seconds'] is None

# Exercise real OpenCV decoding and real MediaPipe on a no-hand video.
import cv2
path = ROOT / '.runtime-logs/sign-source/no-hands.avi'
writer = cv2.VideoWriter(str(path.relative_to(ROOT)), cv2.VideoWriter_fourcc(*'MJPG'), 15, (320, 240))
assert writer.isOpened()
for _ in range(30):
    writer.write(np.full((240, 320, 3), 128, np.uint8))
writer.release()
no_hands = recognize(path)
assert no_hands['status'] == 'no_hands' and no_hands['candidate'] is None
report = {'engine':'MediaPipe Hands + LiteRT', 'input_shape': inp['shape'].tolist(), 'output_shape':out['shape'].tolist(), 'upstream_sample_counts': counts, 'upstream_first_sample_inference': examples, 'no_hands':no_hands, 'independent_accuracy_evaluated':False, 'standard_validated':False}
(ROOT / '.runtime-logs/sign-source/runtime-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
# Readiness marker confirms a working runtime, not recognition accuracy.
(ROOT / 'models/sign-word-baseline/verified-runtime.json').write_text(json.dumps({'engine':report['engine'],'input_shape':report['input_shape'],'output_shape':report['output_shape'],'standard_validated':False}),encoding='utf8')
print(json.dumps(report,ensure_ascii=False,indent=2))
