"""Live JPEGs and features stay in memory. One model/Hands graph per session."""
import base64
import json
import sys
import time
import cv2
import numpy as np
import argparse
from contextlib import ExitStack
from body_tracking import pose_graph
from me_live import MeLiveRecognizer,me_observation
from sign_worker import classifier,predict,features,hand_graph
from realtime_window import CONFIG
from realtime_events import LiveRecognizer
from hand_overlay import hand_overlay
from sign_training_features import training_frame
from realtime_observation import observe_bgr

def emit(value):
    print(json.dumps(value,ensure_ascii=False),flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--target',choices=['auto','thanks','help'],default='auto');parser.add_argument('--help-engine',choices=['video-tcn','geometry'],default='video-tcn');parser.add_argument('--trained-models',default='[]');args=parser.parse_args()
    from trained_runtime import TrainedRuntime
    trained=TrainedRuntime(json.loads(args.trained_models))
    engine,inp,out=classifier()
    window=LiveRecognizer(lambda sequence:predict(engine,inp,out,sequence))
    if args.target=='auto':
        from realtime_multi import MultiLiveRecognizer
        from need_live import NeedLiveRecognizer
        multi=MultiLiveRecognizer(lambda sequence:predict(engine,inp,out,sequence),need_detector=NeedLiveRecognizer(),me_detector=MeLiveRecognizer())
    if args.target=='help':
        if args.help_engine=='video-tcn':
            from help_tcn_live import HelpTCNLive
            help_window=HelpTCNLive()
        else:
            from help_live_probe import HelpLiveProbe
            help_window=HelpLiveProbe()
    with ExitStack() as stack:
        hands=stack.enter_context(hand_graph())
        pose=stack.enter_context(pose_graph()) if args.target=='auto' else None
        emit({'type':'ready','protocol':CONFIG['protocol'],'target':args.target,'helpEngine':args.help_engine if args.target in ('help','auto') else None})
        last_seq=0;previous_timestamp=None
        while True:
            line=sys.stdin.readline(400000)
            if not line:break
            if not line.endswith('\n'):raise ValueError('Frame too large')
            message=json.loads(line)
            seq=message['seq'];timestamp=message['timestampMs']/1000
            if not isinstance(seq,int) or seq<=last_seq or not np.isfinite(timestamp) or timestamp<0:raise ValueError('Invalid frame order')
            last_seq=seq;started=time.perf_counter()
            raw=base64.b64decode(message['jpeg'],validate=True)
            if not raw or len(raw)>CONFIG['maxJpegBytes']:raise ValueError('Frame too large')
            frame=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
            if frame is None or min(frame.shape[:2])<16 or max(frame.shape[:2])>CONFIG['maxImageEdge']:raise ValueError('Invalid live image')
            if args.target=='auto':
                observation,value,vector,me_input,aspect=observe_bgr(frame,hands,pose,timestamp-previous_timestamp if previous_timestamp is not None else 1/30)
                result=multi.push(timestamp,value,vector,aspect_ratio=aspect,me_input=me_input)
                result=trained.merge(timestamp,me_input,result)
            else:
                rgb=cv2.cvtColor(cv2.flip(frame,1),cv2.COLOR_BGR2RGB)
                observation=hands.process({'image':rgb});value=features(observation);result=window.push(timestamp,value)
            if args.target=='help' and args.help_engine=='video-tcn':
                vector=training_frame(observation,timestamp-previous_timestamp if previous_timestamp is not None else 1/30)
                trial=help_window.push_features(timestamp,vector,result['candidate'] is not None,aspect_ratio=frame.shape[0]/frame.shape[1])
                result={**trial,'status':'candidate' if trial['candidate'] else 'waiting' if value is None else 'observing',
                        'samples':len(help_window.samples),'handSamples':sum(bool(h) for _,h in help_window.samples)}
            elif args.target=='help':
                chosen={}
                for landmarks,label in zip(observation.multi_hand_landmarks or [],observation.multi_handedness or []):
                    side=label.classification[0].label;confidence=label.classification[0].score
                    raw=np.asarray([[p.x,p.y,p.z] for p in landmarks.landmark],dtype=float)
                    if side not in ('Left','Right') or raw.shape!=(21,3) or not np.isfinite(raw).all():continue
                    raw[:,1]*=frame.shape[0]/frame.shape[1]
                    if side not in chosen or confidence>chosen[side][0]:chosen[side]=(confidence,raw)
                trial=help_window.push(timestamp,{s:v[1] for s,v in chosen.items()},result['candidate'] is not None)
                result={**trial,'status':'candidate' if trial['candidate'] else 'waiting' if not chosen else 'observing',
                        'samples':len(help_window.samples),'handSamples':sum(bool(h) for _,h in help_window.samples),'helpEngine':'geometry','modelVersion':None}
            if args.target=='auto':result['meCheck']=multi.me.latest_check if multi.me.latest_check_time==timestamp else None
            previous_timestamp=timestamp
            emit({'type':'frame','seq':seq,**result,'handTracking':hand_overlay(observation,int(frame.shape[1]),int(frame.shape[0])),
                  'processingMs':round((time.perf_counter()-started)*1000,1)})

if __name__=='__main__':
    try:main()
    except Exception:emit({'type':'error','error':'实时处理失败，请停止后重新开启。'})
