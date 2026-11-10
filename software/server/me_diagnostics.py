"""Ephemeral scalar checks only; no images, coordinates or training changes."""
import numpy as np
from me_motion import RULES,chest_point,evaluate_hand

def describe_me_evidence(payload,evidence,supported,score):
    hands=payload['hands'] if payload else []
    body=np.asarray(payload['shoulders'] if payload else [],float)
    valid=body.shape==(2,3) and np.isfinite(body).all() and min(body[:,2])>=RULES['minShoulderVisibility']
    span=float(np.linalg.norm(body[0,:2]-body[1,:2])) if valid else 0.
    valid=bool(valid and span>=RULES['minShoulderSpan']);checks=[]
    center=body[:,:2].mean(0) if valid else None
    chest=chest_point(center,span) if valid else None
    for raw in hands[:2]:
        if not valid:
            h=np.asarray(raw,float)
            if h.shape!=(21,3) or not np.isfinite(h).all():continue
            checks.append({'indexAngle':None,'indexAngle2d':None,'indexExtended':False,'otherFingersFolded':False,'towardChest':False,'nearBody':False,'chestCosine':None,'shoulderCosine':None,'tipDistance':None})
            continue
        values=evaluate_hand(raw,center,span,chest)
        if values is None:continue
        checks.append({'indexAngle':round(values['indexAngle'],1),'indexAngle2d':round(values['indexAngle2d'],1),'indexExtended':values['indexExtended'],'indexPointing':values['indexPointing'],'recedingIndex':values['recedingIndex'],'indexDepthFraction':round(values['indexDepthFraction'],3),'otherFingersFolded':values['otherFingersFolded'],'towardChest':values['towardChest'],'nearBody':values['nearBody'],'chestCosine':None if values['pointingCosine'] is None else round(values['pointingCosine'],3),'shoulderCosine':None if values['shoulderCosine'] is None else round(values['shoulderCosine'],3),'tipDistance':round(values['tipDistance'],3)})
    return {'bodyVisible':valid,'chestReferenced':valid,'hands':checks,'frameSupported':bool(evidence['supported']),'stableSupported':bool(supported),'modelScore':None if score is None else round(float(score),4)}
