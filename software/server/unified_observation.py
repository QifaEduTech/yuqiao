"""Single 178-channel observation shared by unified live/video recognition."""
import cv2
from me_training_features import body_training_frame

def observe_unified_bgr(frame,hands,pose,delta):
    rgb=cv2.cvtColor(cv2.flip(frame,1),cv2.COLOR_BGR2RGB)
    observation=hands.process({'image':rgb});body=pose.process({'image':rgb})
    vector=body_training_frame(observation,body,delta,frame.shape[0]/frame.shape[1])
    return observation,{'frame':vector}
