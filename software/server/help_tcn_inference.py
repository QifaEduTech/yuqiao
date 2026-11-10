"""Safe NumPy inference for the exported small TCN; no pickle or torch runtime."""
import hashlib,json,math
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
SHAPES={'first.weight':(32,153,3),'first.bias':(32,),'second.weight':(32,32,3),'second.bias':(32,),'classifier.weight':(1,64),'classifier.bias':(1,),'mean':(153,),'std':(153,)}

class HelpTCN:
    def __init__(self,arrays=None,directory=ROOT/'models/help-video-tcn/v1'):
        self.manifest=None
        if arrays is None:
            directory=Path(directory);self.manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'))
            content=(directory/'weights.npz').read_bytes()
            if hashlib.sha256(content).hexdigest()!=self.manifest['artifactSha256'] or self.manifest['featureProtocol']!='hands-local-absolute-motion-153-v1':raise ValueError('help_checkpoint_mismatch')
            with np.load(directory/'weights.npz',allow_pickle=False) as saved:arrays={k:saved[k] for k in saved.files}
        if set(arrays)!=set(SHAPES):raise ValueError('unexpected_model_arrays')
        self.w={}
        for name,shape in SHAPES.items():
            v=np.asarray(arrays[name],dtype=np.float32)
            if v.shape!=shape or not np.isfinite(v).all():raise ValueError('invalid_model_array')
            self.w[name]=v
        if np.any(self.w['std']<.00999):raise ValueError('invalid_normalization')
    @staticmethod
    def gelu(x):
        erf=np.fromiter((math.erf(float(v)) for v in (x/math.sqrt(2)).flat),dtype=np.float32,count=x.size).reshape(x.shape)
        return .5*x*(1+erf)
    def conv(self,x,name,dilation):
        padded=np.pad(x,((dilation,dilation),(0,0)))
        y=np.broadcast_to(self.w[name+'.bias'],(len(x),32)).copy()
        for k in range(3):y+=padded[k*dilation:k*dilation+len(x)]@self.w[name+'.weight'][:,:,k].T
        return self.gelu(y)
    def probability(self,frames):
        x=np.asarray(frames,dtype=np.float32)
        if x.ndim!=2 or x.shape[1]!=153 or not 2<=len(x)<=384 or not np.isfinite(x).all():raise ValueError('invalid_help_sequence')
        h=self.conv((x-self.w['mean'])/self.w['std'],'first',1);h=self.conv(h,'second',2)
        pooled=np.r_[h.mean(axis=0),h.max(axis=0)]
        logit=float((pooled@self.w['classifier.weight'].T+self.w['classifier.bias'])[0])
        return 1/(1+math.exp(-logit)) if logit>=0 else math.exp(logit)/(1+math.exp(logit))
