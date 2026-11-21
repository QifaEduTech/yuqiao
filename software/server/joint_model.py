"""Variable-class unified model. One shared network, no per-word weights.

Supports the original two-layer v2 model and the longer-receptive-field v3
model. Threshold/margin are part of the model metadata and are selected on the
validation split only.
"""
import json,hashlib
from pathlib import Path
import numpy as np
from unified_runtime import UnifiedTCN,CONFIG,quality

def cadence_features(x):
    """Align a sparse sequence for the convolution, within observed tracking runs only."""
    gaps=x[1:,152]/30
    if not len(gaps) or np.median(gaps)<.075:return x
    same=np.all(x[1:,[74,150,164,176,177]]==x[:-1,[74,150,164,176,177]],axis=1)
    valid=same & ((x[1:,74]>0)|(x[1:,150]>0)) & (gaps>=.075) & (gaps<=.18)
    steps=np.where(valid,np.clip(np.rint(gaps*30),1,5),1).astype(int)
    if 1+steps.sum()>CONFIG['maxFrames']:return x
    right=np.repeat(np.arange(1,len(x)),steps)
    ends=np.cumsum(steps)
    fraction=(np.arange(steps.sum())-np.repeat(ends-steps,steps)+1)/steps[right-1]
    values=x[right-1]+fraction[:,None].astype(np.float32)*(x[right]-x[right-1])
    values[ends-1]=x[1:]
    values[:,152]=x[right,152]/steps[right-1]
    return np.vstack((x[:1],values))

class JointTCN(UnifiedTCN):
    def __init__(self,directory=None,arrays=None,classes=None,threshold=None,margin=None,protocol=None):
        self.end_policy = None
        self.cadence_alignment = False
        self.confirmed_evidence = False
        if arrays is None:
            directory=Path(directory);meta=json.loads((directory/'model.json').read_text(encoding='utf8'))
            protocol=meta.get('protocol')
            self.end_policy = meta.get('endPolicy')
            self.cadence_alignment = meta.get('cadenceAlignment')=='within-tracked-run-v1'
            self.confirmed_evidence = meta.get('streamConfirmation')=='confirmed-evidence-v1'
            if protocol not in ('joint-body178-tcn-v2','joint-body178-tcn-v3') or hashlib.sha256((directory/'weights.npz').read_bytes()).hexdigest()!=meta['sha256']:raise ValueError('joint_model_hash')
            classes=len(meta['labels'])+1
            threshold=meta.get('threshold',CONFIG['threshold']);margin=meta.get('margin',CONFIG['margin'])
            with np.load(directory/'weights.npz',allow_pickle=False) as archive:arrays={k:archive[k] for k in archive.files}
        elif protocol is None:
            protocol = 'joint-body178-tcn-v3' if 'third.weight' in arrays else 'joint-body178-tcn-v2'
        if not isinstance(classes,int) or not 2<=classes<=65:raise ValueError('joint_class_count')
        self.threshold=float(threshold if threshold is not None else CONFIG['threshold'])
        self.margin=float(margin if margin is not None else CONFIG['margin'])
        self.layers=[('first',1),('second',2)] if protocol.endswith('v2') else [('first',1),('second',2),('third',4),('fourth',8)]
        shapes={'classifier.weight':(classes,64),'classifier.bias':(classes,),'mean':(178,),'std':(178,)}
        # Retired outputs remain anonymous rejection evidence. Dropping their
        # probability from the denominator would inflate the remaining words.
        self.class_count=classes
        if 'reject.weight' in arrays:
            reject_shape=np.shape(arrays['reject.weight'])
            if len(reject_shape)!=2 or not 1<=reject_shape[0]<=65-classes:
                raise ValueError('joint_reject_count')
            shapes.update({'reject.weight':(reject_shape[0],64),'reject.bias':(reject_shape[0],)})
        for index,(name,_) in enumerate(self.layers):
            shapes[name+'.weight']=(32,178 if index==0 else 32,3);shapes[name+'.bias']=(32,)
        if set(arrays)!=set(shapes):raise ValueError('joint_arrays')
        self.w={k:np.asarray(v,np.float32) for k,v in arrays.items()}
        if any(v.shape!=shapes[k] or not np.isfinite(v).all() for k,v in self.w.items()) or np.any(self.w['std']<.00999):raise ValueError('joint_weights')

    def embedding(self,frames):
        x=np.asarray(frames,np.float32)
        if x.ndim!=2 or x.shape[1]!=178 or not 2<=len(x)<=CONFIG['maxFrames'] or not np.isfinite(x).all():raise ValueError('invalid_sequence')
        if self.cadence_alignment:x=cadence_features(x)
        h=(x-self.w['mean'])/self.w['std']
        for name,dilation in self.layers:h=self.conv(h,name,dilation)
        return np.r_[h.mean(0),h.max(0)]

    def _distribution(self,frames):
        pooled=self.embedding(frames)
        logits=pooled@self.w['classifier.weight'].T+self.w['classifier.bias']
        if 'reject.weight' in self.w:
            logits=np.r_[logits,pooled@self.w['reject.weight'].T+self.w['reject.bias']]
        p=np.exp(logits-logits.max())
        return p/p.sum()

    def probabilities(self,frames):
        scores=self._distribution(frames)
        if len(scores)==self.class_count:return scores
        visible=scores[:self.class_count].copy()
        visible[0]+=scores[self.class_count:].sum()
        return visible

    def classify(self,frames):
        if not quality(frames)['passed']:
            return 0
        p=self._distribution(frames);best=int(p.argmax());ordered=np.sort(p)
        return best if 0<best<self.class_count and ordered[-1]>=self.threshold and ordered[-1]-ordered[-2]>=self.margin else 0
