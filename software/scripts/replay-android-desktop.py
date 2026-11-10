"""Private development replay at source frame timestamps; never copy videos or alter labels."""
from pathlib import Path
import sys,json,hashlib,time
import cv2,numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_worker import classifier,predict,features,hand_graph
from body_tracking import pose_graph
from sign_training_features import training_frame
from me_live import MeLiveRecognizer,me_observation
from need_live import NeedLiveRecognizer
from realtime_multi import MultiLiveRecognizer
plan=json.loads((ROOT/'data/maintenance/android-replay-plan.json').read_text(encoding='utf-8'));engine,inp,out=classifier();reports=[]
for index,item in enumerate(plan['items']):
 report={**item,'status':'failed','times':[],'candidates':[],'events':[],'handSides':{'Left':0,'Right':0},'wristSum':[0.,0.,0]};cap=None
 try:
  path=Path(item['file']).resolve();assert path.is_relative_to((ROOT/'data/media').resolve());assert hashlib.sha256(path.read_bytes()).hexdigest()==item['sourceSha256']
  cap=cv2.VideoCapture(str(path));assert cap.isOpened();live=MultiLiveRecognizer(lambda x:predict(engine,inp,out,x),need_detector=NeedLiveRecognizer(),me_detector=MeLiveRecognizer());previous=None;last_selected=None;words=set()
  with hand_graph() as hands,pose_graph() as pose:
   while True:
    ok,bgr=cap.read()
    if not ok:break
    t=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
    if t<item['start']-1e-6:continue
    if t>item['end']+1e-6:break
    if last_selected is not None and t-last_selected<1/30-1e-6:continue
    if previous is not None and t<=previous:raise ValueError('nonmonotonic_source_time')
    scale=min(1,640/max(bgr.shape[:2]));bgr=cv2.resize(bgr,(max(16,round(bgr.shape[1]*scale)),max(16,round(bgr.shape[0]*scale))))
    rgb=cv2.cvtColor(cv2.flip(bgr,1),cv2.COLOR_BGR2RGB);h=hands.process({'image':rgb});
    for side in h.multi_handedness or []:report['handSides'][side.classification[0].label]+=1
    for lm in h.multi_hand_landmarks or []:report['wristSum'][0]+=lm.landmark[0].x;report['wristSum'][1]+=lm.landmark[0].y;report['wristSum'][2]+=1
    p=pose.process({'image':rgb});delta=1/30 if previous is None else t-previous;aspect=bgr.shape[0]/bgr.shape[1]
    result=live.push(t,features(h),training_frame(h,delta),aspect_ratio=aspect,me_input=me_observation(h,p,delta,aspect));report['times'].append(t)
    if result['candidate']:words.add(result['candidate'])
    if result['event']:report['events'].append(result['event']['text'])
    previous=last_selected=t
  if not report['times']:raise ValueError('empty_annotated_range')
  report.update(status='ok',candidates=sorted(words),frames=len(report['times']))
 except Exception as e:report['error']=type(e).__name__
 finally:
  if cap is not None:cap.release()
 reports.append(report);print(json.dumps({'completed':index+1,'total':len(plan['items']),'category':item['category'],'status':report['status'],'candidateCount':len(report['candidates'])}),flush=True)
(ROOT/'data/maintenance/android-desktop-replay.json').write_text(json.dumps({'purpose':plan['purpose'],'appendedSyntheticFrames':False,'reports':reports},ensure_ascii=False,indent=2),encoding='utf-8')
