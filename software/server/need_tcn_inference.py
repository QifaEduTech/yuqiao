"""Isolated 171-channel candidate, sharing only the tested NumPy convolution math."""
import hashlib,json,math
from pathlib import Path
import numpy as np
from help_tcn_inference import HelpTCN,SHAPES,ROOT

class NeedTCN(HelpTCN):
    def __init__(self,arrays=None,directory=ROOT/'models/need-video-tcn/experimental-v1'):
        self.manifest=None
        if arrays is None:
            directory=Path(directory);self.manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'));content=(directory/'weights.npz').read_bytes()
            if hashlib.sha256(content).hexdigest()!=self.manifest['artifactSha256'] or self.manifest['featureProtocol']!='hands-153-plus-causal-projection-171-v1':raise ValueError('need_checkpoint_mismatch')
            with np.load(directory/'weights.npz',allow_pickle=False) as saved:arrays={k:saved[k] for k in saved.files}
        shapes={**SHAPES,'first.weight':(32,171,3),'mean':(171,),'std':(171,)}
        if set(arrays)!=set(shapes):raise ValueError('unexpected_need_arrays')
        self.w={}
        for key,shape in shapes.items():
            v=np.asarray(arrays[key],dtype=np.float32)
            if v.shape!=shape or not np.isfinite(v).all():raise ValueError('invalid_need_array')
            self.w[key]=v
        if np.any(self.w['std']<.00999):raise ValueError('invalid_need_normalization')
    def probability(self,frames):
        x=np.asarray(frames,dtype=np.float32)
        if x.ndim!=2 or x.shape[1]!=171 or not 2<=len(x)<=384 or not np.isfinite(x).all():raise ValueError('invalid_need_sequence')
        h=self.conv((x-self.w['mean'])/self.w['std'],'first',1);h=self.conv(h,'second',2);pooled=np.r_[h.mean(axis=0),h.max(axis=0)];logit=float((pooled@self.w['classifier.weight'].T+self.w['classifier.bias'])[0])
        return 1/(1+math.exp(-logit)) if logit>=0 else math.exp(logit)/(1+math.exp(logit))
