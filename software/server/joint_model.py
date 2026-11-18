"""Variable-class unified model. One shared network, no per-word weights."""
import json,hashlib
from pathlib import Path
import numpy as np
from unified_runtime import UnifiedTCN

class JointTCN(UnifiedTCN):
    def __init__(self,directory=None,arrays=None,classes=None):
        if arrays is None:
            directory=Path(directory);meta=json.loads((directory/'model.json').read_text(encoding='utf8'))
            if meta['protocol']!='joint-body178-tcn-v2' or hashlib.sha256((directory/'weights.npz').read_bytes()).hexdigest()!=meta['sha256']:raise ValueError('joint_model_hash')
            classes=len(meta['labels'])+1
            with np.load(directory/'weights.npz',allow_pickle=False) as archive:arrays={k:archive[k] for k in archive.files}
        if not isinstance(classes,int) or not 2<=classes<=65:raise ValueError('joint_class_count')
        shapes={'first.weight':(32,178,3),'first.bias':(32,),'second.weight':(32,32,3),'second.bias':(32,),'classifier.weight':(classes,64),'classifier.bias':(classes,),'mean':(178,),'std':(178,)}
        if set(arrays)!=set(shapes):raise ValueError('joint_arrays')
        self.w={k:np.asarray(v,np.float32) for k,v in arrays.items()}
        if any(v.shape!=shapes[k] or not np.isfinite(v).all() for k,v in self.w.items()) or np.any(self.w['std']<.00999):raise ValueError('joint_weights')
