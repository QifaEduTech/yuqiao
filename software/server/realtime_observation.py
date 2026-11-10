"""One BGR-to-observation path for Web live frames and explicit recording review."""
import cv2
from sign_worker import features
from sign_training_features import training_frame
from me_live import me_observation

def observe_bgr(frame,hands,pose,delta):
    rgb=cv2.cvtColor(cv2.flip(frame,1),cv2.COLOR_BGR2RGB)
    observation=hands.process({'image':rgb})
    aspect=frame.shape[0]/frame.shape[1]
    value=features(observation)
    vector=training_frame(observation,delta)
    body=pose.process({'image':rgb}) if pose is not None else None
    payload=me_observation(observation,body,delta,aspect) if body is not None else None
    return observation,value,vector,payload,aspect
