"""Small, ephemeral 2D overlay from the same mirrored tracker as recognition."""
import math

def hand_overlay(observation,width,height):
    hands=[]
    for landmarks,handedness in zip(observation.multi_hand_landmarks or [],observation.multi_handedness or []):
        if len(hands)>=2:break
        if not handedness.classification:continue
        side=handedness.classification[0].label
        if side not in ('Left','Right') or len(landmarks.landmark)!=21:continue
        points=[[float(p.x),float(p.y)] for p in landmarks.landmark]
        if not all(math.isfinite(v) and -1<=v<=2 for p in points for v in p):continue
        hands.append({'side':side,'points':[[round(x,6),round(y,6)] for x,y in points]})
    return {'width':width,'height':height,'mirrored':True,'hands':hands}
