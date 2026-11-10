"""NumPy-only isolated me candidate; does not register it for live recognition."""
import hashlib,json,math
from pathlib import Path
import numpy as np
from help_tcn_inference import HelpTCN
from me_training_features import DIMENSIONS,FEATURE_ID
ROOT=Path(__file__).resolve().parents[1]
SHAPES={'first.weight':(32,DIMENSIONS,3),'first.bias':(32,),'second.weight':(32,32,3),'second.bias':(32,),'classifier.weight':(1,64),'classifier.bias':(1,),'mean':(DIMENSIONS,),'std':(DIMENSIONS,)}

class MeTCN(HelpTCN):
    def __init__(self,arrays=None,directory=ROOT/'models/me-video-tcn/experimental-v1'):
        self.manifest=None
        if arrays is None:
            directory=Path(directory);self.manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'))
            content=(directory/'weights.npz').read_bytes()
            if hashlib.sha256(content).hexdigest()!=self.manifest['artifactSha256'] or self.manifest['featureProtocol']!=FEATURE_ID:raise ValueError('me_checkpoint_mismatch')
            with np.load(directory/'weights.npz',allow_pickle=False) as saved:arrays={k:saved[k] for k in saved.files}
        if set(arrays)!=set(SHAPES):raise ValueError('unexpected_model_arrays')
        self.w={}
        for name,shape in SHAPES.items():
            value=np.asarray(arrays[name],np.float32)
            if value.shape!=shape or not np.isfinite(value).all():raise ValueError('invalid_model_array')
            self.w[name]=value
        if np.any(self.w['std']<.00999):raise ValueError('invalid_normalization')

    def probability(self,frames):
        x=np.asarray(frames,np.float32)
        if x.ndim!=2 or x.shape[1]!=DIMENSIONS or not 2<=len(x)<=384 or not np.isfinite(x).all():raise ValueError('invalid_me_sequence')
        h=self.conv((x-self.w['mean'])/self.w['std'],'first',1);h=self.conv(h,'second',2)
        logit=float((np.r_[h.mean(0),h.max(0)]@self.w['classifier.weight'].T+self.w['classifier.bias'])[0])
        return 1/(1+math.exp(-logit)) if logit>=0 else math.exp(logit)/(1+math.exp(logit))
