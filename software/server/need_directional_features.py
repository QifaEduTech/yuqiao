"""Causal image-plane motion channels for the need experiment; no labels."""
import numpy as np
DIMENSIONS=171

def directional_features(frames,times,aspect):
    x=np.asarray(frames,dtype=np.float32);ts=np.asarray(times,dtype=float)
    if x.ndim!=2 or x.shape[1]!=153 or len(ts)!=len(x) or not np.isfinite(x).all() or not np.isfinite(ts).all() or np.any(np.diff(ts)<=0) or not .1<=aspect<=10:raise ValueError('invalid_directional_input')
    extra=np.zeros((len(x),18),np.float32)
    for side,sign in [(0,-1),(1,1)]:
        history=[];origin=None
        for i,(f,t) in enumerate(zip(x,ts)):
            v=f[side*76:(side+1)*76]
            if v[74]<=0 or v[65]<=1e-8:history=[];origin=None;continue
            h=v[:63].reshape(21,3).astype(float)*v[65];h[:,1]*=aspect
            width=float(np.linalg.norm(h[5,:2]-h[17,:2]));wrist=v[63:65].astype(float)*[1,aspect]
            if width<1e-6:history=[];origin=None;continue
            if history and t-history[-1][0]>.2:history=[];origin=None
            n=np.cross(h[5],h[17]);n/=max(np.linalg.norm(n),1e-8)
            if origin is None:origin=width
            a=extra[i,side*9:(side+1)*9];a[0]=width;a[1]=sign*n[1];a[2]=np.clip(np.log(width/origin),-3,3)
            for lag,index in [(.2,3),(.5,4)]:
                prior=[r for r in history if t-r[0]>=lag]
                if prior:
                    old=prior[-1];a[index]=np.clip(np.log(width/old[1]),-3,3);a[index+4]=1
                    if index==3:a[5:7]=np.clip((wrist-old[2])/old[1],-5,5)
            history.append((t,width,wrist));history=[r for r in history if t-r[0]<=.75]
    return np.concatenate([x,extra],axis=1)
