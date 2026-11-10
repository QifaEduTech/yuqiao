"""Pause-delimited trial. Boundary rules are explicit, not learned semantics."""
import json
from pathlib import Path
import numpy as np

CONFIG = json.loads((Path(__file__).resolve().parents[1] / 'shared/sign-segmentation.json').read_text(encoding='utf8'))


def split_timeline(samples, duration):
    """Keep short dropouts inside actions; only sustained rest separates them.

    Input entries: timestamp, feature-or-None, deliberate-rest flag. A long
    occlusion can resemble a separator; caller must label results experimental.
    """
    previous = -1.0
    for sample in samples:
        t = sample['t']
        if not np.isfinite(t) or t <= previous or t < 0 or t >= duration:
            raise ValueError('录像采样时间不连续。')
        previous = t
    runs, start = [], None
    for i in range(len(samples) + 1):
        rest = i < len(samples) and samples[i]['rest']
        if rest and start is None:
            start = i
        elif not rest and start is not None:
            end_time = samples[i]['t'] if i < len(samples) else duration
            if i-start >= CONFIG['minimumPauseSamples'] and end_time-samples[start]['t'] >= CONFIG['pauseSeconds']-1e-6:
                runs.append((start, i))
            start = None
    active = [i for i,s in enumerate(samples) if not s['rest'] and s['value'] is not None]
    cuts = []
    for first, end in runs:
        if not active or first<=active[0] or end>active[-1]:
            continue
        # Rest is boundary evidence, not a range to delete. Prefer the center
        # of its longest no-hand run; otherwise split the low-hand run in half.
        missing, begin = [], None
        for i in range(first,end+1):
            absent = i<end and samples[i]['value'] is None
            if absent and begin is None:
                begin = i
            elif not absent and begin is not None:
                missing.append((begin,i));begin=None
        left,right = max(missing,key=lambda r:r[1]-r[0]) if missing else (first,end)
        cuts.append((left+right)//2)
    ranges, cursor = [], 0
    for cut in cuts+[len(samples)]:
        window = samples[cursor:cut]
        present = [i for i,s in enumerate(window) if s['value'] is not None]
        if present and any(not s['rest'] for s in window):
            # Trim only truly absent edge frames; retain low-hand gesture data.
            ranges.append(window[present[0]:present[-1]+1])
        cursor = cut
    if len(ranges) > CONFIG['maximumSegments']:
        raise ValueError('检测到的动作段超过10段，请缩短录像；未截断或只输出前半段。')
    return ranges


def recognize_segments(samples, duration, classify, decide, interval_fn):
    ranges = split_timeline(samples, duration)
    if not ranges:
        return {'kind': 'segmented-sign-sequence', 'status': 'no_hands', 'segments': [], 'text': '',
                'unresolved_count': 0, 'reason': '未找到可用动作，请让动作中的双手清楚入镜。'}
    segments = []
    for index, window in enumerate(ranges):
        start, end = window[0]['t'], min(duration, window[-1]['t']+1/15)
        values = [s['value'] for s in window if s['value'] is not None]
        result = {'status': 'uncertain', 'candidate': None, 'score': None}
        interval = None
        if len(ranges) == 1:
            result['reason_code'] = 'no_boundary'
            result['reason'] = '未找到动作间明确停顿，请将双手放低或移出画面约1秒再做下一动作。'
        elif end-start < CONFIG['minimumActionSeconds'] or len(values) < 8:
            result['reason_code'] = 'too_short' if end-start < CONFIG['minimumActionSeconds'] else 'hand_count'
            result['reason'] = '这一段太短或手部画面不足，请重新录制。'
        elif end-start > CONFIG['maximumActionSeconds']:
            result['reason_code'] = 'too_long'
            result['reason'] = '这一段超过单动作模型范围，可能没有分开，请增加动作间停顿。'
        else:
            observations = [(s['t']-start, s['value'] is not None) for s in window]
            interval = interval_fn(observations, end-start)
            indexes = np.linspace(0, len(values)-1, 30).astype(int)
            result = decide(classify(np.asarray(values)[indexes]), interval['active_hand_coverage'], interval['internal_missing_seconds'])
            failed = {item['code'] for item in result.get('checks', []) if not item['passed']}
            result['reason_code'] = ('candidate' if result['status'] == 'candidate' else
                                     next((code for code in ['coverage', 'gap', 'score', 'margin', 'scope'] if code in failed), 'uncertain'))
        segments.append({'index': index+1, 'start_seconds': round(start, 3), 'end_seconds': round(end, 3),
                         'sampled_frames': len(window), 'hand_frames': len(values),
                         'active_hand_coverage': interval['active_hand_coverage'] if interval else None,
                         'internal_missing_seconds': interval['internal_missing_seconds'] if interval else None, **result})
    unresolved = sum(s['status'] != 'candidate' or not s.get('candidate') for s in segments)
    return {'kind': 'segmented-sign-sequence', 'status': 'complete' if not unresolved else 'partial',
            'segments': segments, 'text': '，'.join(s['candidate'] for s in segments) if not unresolved else '',
            'unresolved_count': unresolved, 'requires_confirmation': True,
            'reason': '按停顿分段的实验候选，请逐段核对；不是自然连续手语翻译。',
            'segmentation_version': CONFIG['version']}
