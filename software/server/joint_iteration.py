"""Paired development replay for deciding which single model serves live traffic."""
import hashlib
import json
from pathlib import Path
from joint_evaluation import evaluate_joint
from joint_model import JointTCN
from unified_runtime import UnifiedTCN


def load_reference(directory, expected_hash):
    directory = Path(directory)
    if hashlib.sha256((directory / 'weights.npz').read_bytes()).hexdigest() != expected_hash:
        raise ValueError('iteration_reference_changed')
    metadata = json.loads((directory / 'model.json').read_text(encoding='utf8'))
    if metadata['protocol'] == 'unified-body178-tcn-v1':
        return UnifiedTCN(directory)
    return JointTCN(directory)


class MappedModel:
    def __init__(self, model, source, vocabulary):
        indices = {label['signId']: i for i, label in enumerate(vocabulary, 1)}
        self.mapping = [0] + [indices[label['signId']] for label in source]
        self.model = model
        self.end_policy = getattr(model, 'end_policy', None)

    def classify(self, frames):
        return self.mapping[self.model.classify(frames)]


def compare(rows, model, labels, reference, reference_labels, policy, excluded):
    validation = [r for r in rows if r['split'] == 'validation' and r['sourceHash'] not in excluded]
    ids = {label['signId'] for label in labels}
    vocab = labels + [label for label in reference_labels if label['signId'] not in ids]
    scores = {}
    for key, network, source in [('previous', reference, reference_labels), ('current', model, labels)]:
        mapped = MappedModel(network, source, vocab)
        result = evaluate_joint(validation, mapped, vocab, policy, split='validation')
        scores[key] = [{'signId':item['signId'], **item['counts']} for item in result['perClass'][:len(labels)]]
    return {'metric':'macro-auto-f1-v1', 'clips':len(validation), **scores}
