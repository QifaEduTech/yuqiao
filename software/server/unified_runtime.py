"""Isolated single-model experiment. No production registry or service mutation."""
import hashlib
import json
from pathlib import Path
import numpy as np
from help_tcn_inference import HelpTCN

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'shared/unified-experiment.json').read_text(encoding='utf8'))


def quality(frames):
    x = np.asarray(frames, np.float32)
    if x.ndim != 2 or x.shape[1] != 178 or not len(x) or not np.isfinite(x).all():
        return {'passed': False, 'reason': 'invalid_features'}
    present = (x[:, 74] > 0) | (x[:, 150] > 0)
    indices = np.flatnonzero(present)
    coverage = float(present[indices[0]:indices[-1]+1].mean()) if len(indices) else 0.
    body = float(x[present, 177].mean()) if present.any() else 0.
    passed = len(indices) >= CONFIG['minHandFrames'] and min(coverage, body) >= CONFIG['minCoverage']
    return {'passed': bool(passed), 'handFrames': len(indices), 'internalCoverage': coverage,
            'bodyCoverage': body, 'reason': 'ok' if passed else 'insufficient_tracking'}


def quality_feedback(result):
    if result.get('passed'):
        return '通过'
    if result.get('reason') == 'invalid_features':
        return '视频特征无效，请回看或删除后补录。'
    frames = result.get('handFrames', 0)
    if frames == 0:
        return '未检测到有效手部骨架，请回看视频，删除后重新录制。'
    if frames < CONFIG['minHandFrames']:
        return f'有效手部画面只有{frames}帧，动作跟踪时间不足，请补录。'
    if result.get('internalCoverage', 0) < CONFIG['minCoverage']:
        return '动作过程中手部跟踪多次中断，请让动作手完整入镜后补录。'
    return '肩膀参考点跟踪不足，请让双肩和动作手清楚入镜后补录。'


class UnifiedTCN(HelpTCN):
    def __init__(self, directory=None, arrays=None):
        if arrays is None:
            directory = Path(directory)
            meta = json.loads((directory / 'model.json').read_text(encoding='utf8'))
            path = directory / 'weights.npz'
            if meta['protocol'] != CONFIG['id'] or meta['sha256'] != hashlib.sha256(path.read_bytes()).hexdigest():
                raise ValueError('model_protocol_or_hash_mismatch')
            with np.load(path, allow_pickle=False) as saved:
                arrays = {k: saved[k] for k in saved.files}
        shapes = {'first.weight': (32,178,3), 'first.bias': (32,), 'second.weight': (32,32,3),
                  'second.bias': (32,), 'classifier.weight': (5,64), 'classifier.bias': (5,),
                  'mean': (178,), 'std': (178,)}
        if set(arrays) != set(shapes):
            raise ValueError('invalid_arrays')
        self.w = {k: np.asarray(v, np.float32) for k,v in arrays.items()}
        if any(v.shape != shapes[k] or not np.isfinite(v).all() for k,v in self.w.items()) or np.any(self.w['std'] < .00999):
            raise ValueError('invalid_weights')

    def probabilities(self, frames):
        x = np.asarray(frames, np.float32)
        if x.ndim != 2 or x.shape[1] != 178 or not 2 <= len(x) <= CONFIG['maxFrames'] or not np.isfinite(x).all():
            raise ValueError('invalid_sequence')
        h = self.conv((x-self.w['mean'])/self.w['std'], 'first', 1)
        h = self.conv(h, 'second', 2)
        logits = np.r_[h.mean(0), h.max(0)] @ self.w['classifier.weight'].T + self.w['classifier.bias']
        p = np.exp(logits-logits.max())
        return p/p.sum()

    def classify(self, frames):
        if not quality(frames)['passed']:
            return 0
        p = self.probabilities(frames)
        best = int(p.argmax())
        return best if best and p[best] >= CONFIG['threshold'] and np.sort(p)[-1]-np.sort(p)[-2] >= CONFIG['margin'] else 0


SETTLED_END_POLICY = 'observed-hand-hold-v1'


def hand_pose(frame):
    """Observed wrist and five fingertips in image coordinates for both hands."""
    points = []
    for offset in (0, 76):
        if frame[offset + 74] <= 0:
            continue
        local = frame[offset:offset+63].reshape(21, 3)[[0, 4, 8, 12, 16, 20], :2]
        points.append(local * frame[offset+65] + frame[offset+63:offset+65])
    return np.concatenate(points) if points else None


class UnifiedStream:
    """Common quality/stability/end/repeat policy; no per-word physical gate.

    Models can opt into a measured still-hand boundary after validation.
    EOF never synthesizes an end.
    """
    def __init__(self, model):
        self.model = model
        self.last_time = None
        self.reset()

    def reset(self):
        self.frames = []
        self.started = None
        self.missing = None
        self.proposed = 0
        self.since = None
        self.qualified = 0
        self.conflict = False
        self.last_prediction = -1e9
        self.last_support = None
        self.emitted_label = 0
        self.held_pose = None

    def _settled_pose(self, t):
        if self.conflict or not self.proposed or self.proposed != self.qualified:
            return None
        if self.since is None or t-self.since < .40 or self.last_support != t:
            return None
        # A stable class by itself does not supply a physical word boundary.
        window = []
        for ts, f in reversed(self.frames):
            window.append((ts, f))
            if t-ts >= .20:
                break
        if len(window) < 3 or t-window[-1][0] < .20:
            return None
        slots = window[0][1][[74, 150]]
        if not slots.any() or any(not np.array_equal(f[[74, 150]], slots) for _, f in window):
            return None
        poses = np.stack([hand_pose(f) for _, f in window])
        if np.linalg.norm(np.ptp(poses, axis=0), axis=1).max() > .045:
            return None
        return slots.copy(), poses[0].copy()

    def finish_explicit(self, t, allow_missing=False):
        """An explicit user/recording boundary, never synthesized no-hand frames."""
        if not np.isfinite(t) or self.last_time is None or t < self.last_time:
            return None
        current=self.proposed==self.qualified or (allow_missing and self.proposed==0 and self.missing is not None)
        if self.conflict or not self.qualified or not current or self.last_support is None or t-self.last_support > .4:
            return None
        event = {'label': self.qualified, 'start': self.started, 'end': t}
        self.reset()
        return event

    def push(self, t, frame):
        x = np.asarray(frame, np.float32)
        if x.shape != (178,) or not np.isfinite(x).all() or not np.isfinite(t) or t < 0 or self.last_time is not None and t <= self.last_time:
            raise ValueError('invalid_stream_input')
        if self.last_time is not None and t-self.last_time > CONFIG['maxGapSeconds']:
            self.reset()
        self.last_time = t
        present = bool(x[74] > 0 or x[150] > 0)
        event = None
        if not present:
            if self.started is not None:
                # Keep observed missing masks inside a segment, including brief
                # occlusion; do not silently join the surrounding hand frames.
                self.frames.append((t, x.copy()))
                self.frames = [(a,b) for a,b in self.frames if t-a <= CONFIG['windowSeconds']][-CONFIG['maxFrames']:]
            self.proposed = 0
            self.since = None
            if self.missing is None:
                self.missing = t
            if t-self.missing >= CONFIG['endSeconds']-1e-6:
                if self.qualified and not self.conflict and self.last_support is not None and self.missing-self.last_support <= .4:
                    event = {'label': self.qualified, 'start': self.started, 'end': self.missing}
                self.reset()
            return {'candidate': 0, 'event': event, 'conflict': self.conflict}
        if self.started is None:
            self.started = t
        self.missing = None
        if self.held_pose is not None:
            slots, pose = self.held_pose
            if np.array_equal(x[[74, 150]], slots) and np.linalg.norm(hand_pose(x)-pose, axis=1).max() <= .09:
                return {'candidate': 0, 'event': None, 'conflict': False}
            self.held_pose = None
            self.started = t
        self.frames.append((t, x.copy()))
        self.frames = [(a,b) for a,b in self.frames if t-a <= CONFIG['windowSeconds']][-CONFIG['maxFrames']:]
        if t-self.started > 30:
            self.conflict = True
        if len(self.frames) >= CONFIG['minHandFrames'] and t-self.last_prediction >= CONFIG['predictIntervalSeconds']-1e-6:
            self.last_prediction = t
            label = self.model.classify([f for _,f in self.frames])
            if label == self.emitted_label:
                label = 0
            if label != self.proposed:
                self.proposed = label
                self.since = t
            if label:
                self.last_support = t
                stable = .48 if getattr(self.model,'confirmed_evidence',False) else CONFIG['stableSeconds']
                if self.since is not None and t-self.since >= stable-1e-6:
                    if self.qualified and self.qualified != label:
                        self.conflict = True
                    self.qualified = label
            if getattr(self.model, 'end_policy', None) == SETTLED_END_POLICY:
                held = self._settled_pose(t)
                # For moving signs, sustained agreement can confirm the word
                # before a static hold. Only real timed predictions count.
                if (held is None and getattr(self.model,'confirmed_evidence',False)
                        and self.proposed and self.proposed==self.qualified and not self.conflict
                        and self.since is not None and t-self.since>=.96 and self.last_support==t):
                    held = x[[74,150]].copy(), hand_pose(x)
                if held is not None:
                    event = {'label': self.qualified, 'start': self.started, 'end': t}
                    self.reset()
                    self.held_pose = held
                    self.emitted_label = event['label']
                    return {'candidate': 0, 'event': event, 'conflict': False}
        candidate = self.proposed if not self.conflict and self.last_support is not None and t-self.last_support <= .4 else 0
        if getattr(self.model,'confirmed_evidence',False) and candidate!=self.qualified:
            candidate=0
        return {'candidate': candidate, 'event': event, 'conflict': self.conflict}


def metrics(truth, predicted):
    """Rows=true, columns=predicted; undefined precision is 0 for macro averaging."""
    matrix = np.zeros((5,5), int)
    for actual, output in zip(truth, predicted):
        matrix[actual,output] += 1
    per_class = {}
    for i, name in enumerate(CONFIG['labels']):
        tp = int(matrix[i,i]); support = int(matrix[i].sum()); outputs = int(matrix[:,i].sum())
        precision = tp/outputs if outputs else 0.
        recall = tp/support if support else 0.
        per_class[name] = {'support': support, 'predictions': outputs, 'precision': precision,
                           'recall': recall, 'f1': 2*precision*recall/(precision+recall) if precision+recall else 0.}
    return {'confusionMatrix': matrix.tolist(), 'labels': CONFIG['labels'], 'perClass': per_class,
            'macroTargets': {k: float(np.mean([per_class[n][k] for n in CONFIG['labels'][1:]])) for k in ('precision','recall','f1')},
            'unknownFalsePositiveRate': float(matrix[0,1:].sum()/matrix[0].sum()) if matrix[0].sum() else None,
            'samples': len(truth)}
