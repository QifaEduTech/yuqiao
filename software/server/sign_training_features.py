"""Versioned development input preserving wrist motion and full frame order."""
import numpy as np
from thumb_motion import frame_angles
from thumb_multijoint import thumb_span_ratio

FEATURE_ID='hands-local-absolute-motion-153-v1'
DIMENSIONS=153

def training_frame(results,delta_seconds):
    if not np.isfinite(delta_seconds) or delta_seconds<0:raise ValueError('invalid_frame_delta')
    chosen={}
    for landmarks,handedness in zip(results.multi_hand_landmarks or [],results.multi_handedness or []):
        item=handedness.classification[0];label=item.label
        if label not in ('Left','Right'):continue
        xyz=np.asarray([[p.x,p.y,p.z] for p in landmarks.landmark],np.float32)
        if xyz.shape!=(21,3) or not np.isfinite(xyz).all():continue
        score=float(item.score)
        if not np.isfinite(score):continue
        if label not in chosen or score>chosen[label][0]:chosen[label]=(score,xyz)
    slots=[]
    for side,label in enumerate(['Left','Right']):
        vector=np.zeros(76,np.float32)
        if label in chosen:
            score,raw=chosen[label];local=raw-raw[0];scale=float(np.max(np.abs(local)))
            if scale>1e-8:
                local/=scale
                vector[:63]=local.reshape(-1)
                vector[63:65]=raw[0,:2]
                vector[65]=scale
                normal=np.cross(raw[5]-raw[0],raw[17]-raw[0]);norm=float(np.linalg.norm(normal))
                if norm>1e-8:vector[66:69]=normal/norm
                adapter=np.zeros(126,np.float32);adapter[side*63:(side+1)*63]=local.reshape(-1)
                angles=frame_angles(adapter,side)
                if angles is not None:vector[69:73]=angles/180
                span=thumb_span_ratio(adapter,side)
                if span is not None:vector[73]=min(span,4)/4
                vector[74]=1
                vector[75]=np.clip(score,0,1)  # Handedness confidence, not sign accuracy.
        slots.append(vector)
    # Physical timing is explicit; no padding/interpolation is performed here.
    return np.concatenate([*slots,np.array([min(delta_seconds,1)*30],np.float32)])
