"""178D per-frame features; no label, future frame or imputed body coordinates."""
import numpy as np
from sign_training_features import training_frame
from me_motion import angle, RULES

DIMENSIONS=178
FEATURE_ID='hands-and-shoulder-relative-178-v1'

def body_training_frame(hands,pose,delta_seconds,aspect):
    if not np.isfinite(aspect) or aspect<=0:raise ValueError('invalid_aspect')
    base=training_frame(hands,delta_seconds)
    extra=np.zeros(25,np.float32)
    if not pose.pose_landmarks:return np.r_[base,extra]
    points=pose.pose_landmarks.landmark
    body=np.array([[points[i].x,points[i].y*aspect,points[i].visibility] for i in (11,12)],float)
    if not np.isfinite(body).all() or min(body[:,2])<RULES['minShoulderVisibility']:return np.r_[base,extra]
    center=body[:,:2].mean(0);span=float(np.linalg.norm(body[0,:2]-body[1,:2]))
    if span<RULES['minShoulderSpan']:return np.r_[base,extra]
    extra[-1]=1
    chosen={}
    for lm,side in zip(hands.multi_hand_landmarks or [],hands.multi_handedness or []):
        tag=side.classification[0]
        h=np.array([[v.x,v.y*aspect,v.z] for v in lm.landmark],float)
        if tag.label not in ('Left','Right') or h.shape!=(21,3) or not np.isfinite(h).all() or not np.isfinite(tag.score):continue
        if tag.label not in chosen or tag.score>chosen[tag.label][0]:chosen[tag.label]=(tag.score,h)
    for side,name in enumerate(('Left','Right')):
        if name not in chosen:continue
        h=chosen[name][1];angles=[angle(h[i],h[i+1],h[i+3]) for i in (5,9,13,17)]
        if any(x is None for x in angles):continue
        direction=h[8,:2]-h[5,:2];target=center-h[5,:2]
        cosine=float(np.dot(direction,target)/max(np.linalg.norm(direction)*np.linalg.norm(target),1e-8))
        extra[side*12:(side+1)*12]=np.r_[np.clip((h[0,:2]-center)/span,-4,4),np.clip((h[8,:2]-center)/span,-4,4),np.array(angles)/180,np.clip(cosine,-1,1),min(np.linalg.norm(h[8,:2]-center)/span,4)/4,min(np.linalg.norm(h[9,:2]-h[0,:2])/span,2)/2,1]
    return np.r_[base,extra].astype(np.float32)
