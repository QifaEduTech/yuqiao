"""Real decoder/MediaPipe check with a synthetic no-hand video, not accuracy validation."""
import json
import sys
import tempfile
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'server'))
from sign_worker import recognize

directory = ROOT / '.runtime-logs' / 'sequence-fixtures'
directory.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(dir=directory) as temp:
    path = Path(temp) / 'no-hands-12s.mp4'
    writer = cv2.VideoWriter(str(path.relative_to(ROOT)), cv2.VideoWriter_fourcc(*'mp4v'), 30, (320, 240))
    if not writer.isOpened():
        raise RuntimeError('Cannot create test video')
    for _ in range(360):
        writer.write(np.zeros((240, 320, 3), dtype=np.uint8))
    writer.release()
    result = recognize(path, sequence=True)
    assert result['status'] == 'no_hands' and result['segments'] == [] and result['text'] == ''
    assert result['duration_seconds'] > 10 and result['decoded_frames'] == 360
    try:
        recognize(path, sequence=False)
    except ValueError as error:
        assert '单动作' in str(error)
    else:
        raise AssertionError('Single-action limit changed unexpectedly')
    print(json.dumps({'sequence_status': result['status'], 'duration_seconds': result['duration_seconds'],
                      'decoded_frames': result['decoded_frames'], 'single_limit_preserved': True}))
