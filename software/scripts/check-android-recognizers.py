"""Synthetic parity fixtures for gates, state machines and automatic arbitration."""
import sys,json,importlib.util,hashlib
from pathlib import Path
from types import SimpleNamespace as NS
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_features import training_frame
from sign_worker import features,CATALOG
from me_training_features import body_training_frame
from thumb_local_motion import local_thumb_evidence
from help_motion import inspect_help_motion
from need_required_motion import NeedRequiredMotion
from me_motion import frame_evidence
from thanks_active_hand import ActiveHandThanks
from help_tcn_live import HelpTCNLive
from need_live import NeedLiveRecognizer
from me_live import MeLiveRecognizer
from realtime_multi import MultiLiveRecognizer
def load(file):
 s=importlib.util.spec_from_file_location(file,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
hf=load('check-help-motion.py');tf=load('check-thumb-local-motion.py');nf=load('check-need-required-motion.py');mf=load('check-me-motion.py')
mapping=json.loads((ROOT/'shared/android-runtime-contract.json').read_text());cfg={k:json.loads((ROOT/'shared'/v).read_text(encoding='utf8')) for k,v in mapping.items()};cfg['thanksIndex']=next(e['recognitionIndex'] for e in CATALOG['entries'] if e['text']=='谢谢')
class High:
 def __init__(self,score=.99):self.score=score
 def probability(self,frames):return self.score
def classify(frames):
 scores=np.zeros(10);scores[cfg['thanksIndex']]=.99;return scores
def detector(word,score=.99):
 def supplied(frames):
  values=np.zeros(10);values[cfg['thanksIndex']]=score;return values
 return {'thanks':lambda:ActiveHandThanks(supplied),'help':lambda:HelpTCNLive(High(score)),'need':lambda:NeedLiveRecognizer(High(score)),'me':lambda:MeLiveRecognizer(High(score))}[word]()
def observation(hands,shoulders=None,aspect=1):
 h=NS(multi_hand_landmarks=[NS(landmark=[NS(x=float(p[0]),y=float(p[1]/aspect),z=float(p[2])) for p in raw]) for raw in hands.values()],multi_handedness=[NS(classification=[NS(label=side,score=.99)]) for side in hands]);body=None
 if shoulders is not None:
  b=[NS(x=0.,y=0.,z=0.,visibility=0.) for _ in range(33)]
  for i,p in zip([11,12],shoulders):b[i]=NS(x=float(p[0]),y=float(p[1]/aspect),z=0.,visibility=float(p[2]))
  body=NS(landmark=b)
 pose=NS(pose_landmarks=body);v=training_frame(h,1/30);return {'value':features(h),'vector':v,'aspect':aspect,'body':{'frame':body_training_frame(h,pose,1/30,aspect),'hands':list(hands.values()),'shoulders':[] if shoulders is None else shoulders}}
def compact(result):return {k:result.get(k) for k in ['candidate','event','eventState','reason']}
gates={'thumb':[],'help':[],'need':[],'me':[]};streams=[]
for mode in ['static','held','bend','span','rotation','noisy','rotating_bend','missing','side_switch']:
 rows=[]
 for i in range(65):
  active=15<=i<=18 or 40<=i<=43;v=tf.hand(bend=45 if mode=='held' or active and mode in ['bend','rotating_bend'] else 70 if mode=='noisy' and i==15 else 0,shorten=.6 if mode=='span' and active else 1,rotate=i*3 if mode=='rotation' else 50 if mode=='rotating_bend' and active else 0,side=1 if mode=='side_switch' and i>=15 else 0)
  if mode=='missing' and 15<=i<=18:v=None
  rows.append((i/30,v))
 expected=local_thumb_evidence(rows);gates['thumb'].append({'name':mode,'rows':rows,'expected':{k:expected[k] for k in ['supported','acceptedEvents','rejectedEvents','latestAcceptedBySide']}})
for mode in ['help','static','lateral','single','swap','opposed']:
 rows=hf.timeline(mode);expected=inspect_help_motion(rows);gates['help'].append({'name':mode,'rows':rows,'expected':{'supported':expected['supported'],'runs':[{k:r[k] for k in ['supported','reasons','lastEvidenceTime']} for r in expected['runs']],'ambiguousOrMissingFrames':expected['ambiguousOrMissingFrames']}})
 sequence=[observation(h) for _,h in rows]+[observation({}) for _ in range(23)];streams.append(('help-'+mode,'help',sequence,1/30))
for mode in ['inward','outward','static','jump','noise','translate','flip','missing','gap']:
 gate=NeedRequiredMotion();rows=[];sequence=[]
 for i in range(120):
  a=np.clip((i-15)/20,0,1);scale=1-.45*a if mode in ['inward','flip','missing','gap'] else .55+.45*a if mode=='outward' else 1 if mode in ['static','translate'] else (1 if i<30 else .55) if mode=='jump' else 1+.02*np.sin(i)
  v=nf.frame(scale,side=i%2 if mode=='flip' else 0,shift=i*.01 if mode=='translate' else 0).astype(np.float32)
  if i>=90 or mode=='missing' and 25<=i<30:v[:]=0
  t=i/30+(1 if mode=='gap' and i>=30 else 0);r=gate.push(t,v,1);rows.append({'t':t,'vector':v,'expected':{'supported':r['supported'],'evidence':r['evidence']}});sequence.append({'value':None if not v[74] and not v[150] else np.r_[v[:63],v[76:139]],'vector':v,'aspect':1,'body':None,'t':t})
 gates['need'].append({'name':mode,'rows':rows});streams.append(('need-'+mode,'need',sequence,1/30))
h,b=mf.fixture()
for mode in ['valid','missing_body','low_visibility','up','fist','open','double']:
 hand=h.copy();shoulders=b.copy();hands=[hand]
 if mode=='missing_body':shoulders=[]
 if mode=='low_visibility':shoulders[:,2]=.5
 if mode=='up':hand[5:9]=[[.34,.34,0],[.36,.30,0],[.38,.25,0],[.40,.20,0]]
 if mode=='fist':hand[8]=[.31,.33,0]
 if mode=='open':
  for k in [9,13,17]:hand[k:k+4,0]=[.30,.35,.40,.46]
 if mode=='double':hands=[hand,hand]
 e=frame_evidence(hands,shoulders);gates['me'].append({'name':mode,'hands':hands,'shoulders':shoulders,'expected':{k:e[k] for k in ['supported','reason','wristRelative'] if k in e}})
 v=np.zeros(178,np.float32);v[74]=1;v[-1]=1;payload={'frame':v,'hands':hands,'shoulders':shoulders};sequence=[{'value':np.ones(126),'vector':v[:153],'aspect':1,'body':payload} for _ in range(35)]+[{'value':None,'vector':np.zeros(153),'aspect':1,'body':None} for _ in range(23)];streams.append(('me-'+mode,'me',sequence,.04))
for mode in ['bend','static','peer_static','peer_moving']:
 sequence=[]
 for i in range(130):
  active=15<=i<=19 or 40<=i<=44 or 65<=i<=69;v=tf.hand(bend=45 if active and mode!='static' else 0).astype(np.float32);hands={'Left':v[:63].reshape(21,3)*.03+[.25,.5,0]}
  if mode.startswith('peer'):hands['Right']=hf.hand(.75,1 if mode=='peer_static' else 1+.3*np.sin(i/5))
  if i>=100:hands={}
  sequence.append(observation(hands))
 streams.append(('thanks-'+mode,'thanks',sequence,1/30))
streams += [(name+'-low-model',word,sequence,dt) for name,word,sequence,dt in streams if name in ['help-help','need-inward','me-valid','thanks-bend']]
outputs=[]
for name,word,sequence,dt in streams:
 score=0 if name.endswith('-low-model') else .99;d=detector(word,score);rows=[]
 for i,row in enumerate(sequence):
  t=row.get('t',i*dt);v=row['vector'];r=d.push(t,row['value'],v,aspect_ratio=row['aspect']) if word=='thanks' else d.push_payload(t,row['body']) if word=='me' else d.push_features(t,v,False,aspect_ratio=row['aspect']) if word=='help' else d.push_features(t,v,aspect_ratio=row['aspect']);rows.append({'t':t,**row,'expected':compact(r)})
 outputs.append({'name':name,'word':word,'modelScore':score,'rows':rows})
# Full auto path runs the same synthetic sequences with isolated high model stubs.
auto=[]
for name,word,sequence,dt in streams:
 if name not in ['help-help','help-static','need-inward','need-static','me-valid','me-up','thanks-bend','thanks-static','thanks-peer_static']:continue
 d=MultiLiveRecognizer(classify,help_model=High(),need_detector=NeedLiveRecognizer(High()),me_detector=MeLiveRecognizer(High()));rows=[]
 for i,row in enumerate(sequence):
  t=row.get('t',i*dt);r=d.push(t,row['value'],row['vector'],aspect_ratio=row['aspect'],me_input=row['body']);rows.append({'t':t,**row,'expected':compact(r)})
 auto.append({'name':name,'rows':rows})
scripted=[]
IDS={'谢谢':'csl.thanks','帮助':'csl.ref.bmcx.1900','需要':'csl.ref.bmcx.1874','我':'csl.me'}
plans={
 'handoff_thanks_help':[['谢谢'],['帮助'],['帮助'],['帮助'],['帮助'],[],[],[],[]],
 'sustained_overlap':[['谢谢']]+[['谢谢','帮助']]*8+[[]]*8,
 'brief_overlap':[['谢谢'],['谢谢','帮助'],['帮助'],['帮助'],['帮助']]+[[]]*8,
 'initial_conflict':[['谢谢','帮助']]*3+[[]]*8+[['需要']]*3,
 'me_blocks_withdrawal':[['我']]*4+[['需要']]*5+[[]]*8+[['需要']]*4,
 'configuration_change':[['谢谢']]*3+[['帮助']]*6+[[]]*8,
 'camera_gap':[['谢谢'],['帮助'],['帮助']],
 'candidate_only':[['谢谢','帮助'],['谢谢'],['帮助']]+[[]]*8,
}
for name,plan in plans.items():
 rows=[]
 for i,candidates in enumerate(plan):
  t=round(i*.1+(2 if name=='camera_gap' and i>=1 else 0),3);has=bool(candidates);vector=np.zeros(153);vector[74]=int(has);vector[150]=int(has and name=='configuration_change' and i>=3)
  results={w:{'candidate':w if w in candidates else None,'event':None,'eventState':'ready_to_finish' if w in candidates and name!='candidate_only' else 'collecting','reason':'target' if w in candidates else 'no_hands','samples':1,'handSamples':int(w in candidates)} for w in IDS}
  rows.append({'t':t,'value':np.ones(126) if has else None,'vector':vector,'aspect':1,'body':None,'outputs':results})
 class Stub:
  samples=[]
  def __init__(self,word):self.word=word
  def reset(self):pass
  def restart(self):pass
  def begin_segment(self,t):pass
  def push(self,t,*a,**kw):return next(r['outputs'][self.word] for r in rows if abs(r['t']-t)<1e-8)
  push_features=push;push_payload=push
 ds={w:Stub(w) for w in IDS};d=MultiLiveRecognizer(None,thanks_detector=ds['谢谢'],help_detector=ds['帮助'],need_detector=ds['需要'],me_detector=ds['我'])
 for row in rows:row['expected']=compact(d.push(row['t'],row['value'],row['vector'],aspect_ratio=1,me_input=None))
 scripted.append({'name':name,'rows':rows})
def encode(o):
 if isinstance(o,np.ndarray):return o.tolist()
 if isinstance(o,np.generic):return o.item()
 raise TypeError(type(o))
sources=['server/realtime_multi.py','server/realtime_window.py','server/realtime_events.py','server/thanks_active_hand.py','server/thumb_local_motion.py','server/help_motion.py','server/help_tcn_live.py','server/help_live_probe.py','server/need_required_motion.py','server/need_live.py','server/me_motion.py','server/me_live.py']+['shared/'+v for v in mapping.values()]
result={'syntheticOnly':True,'models':'constant-high stubs isolate rules, not accuracy','config':cfg,'gates':gates,'streams':outputs,'auto':auto,'scripted':scripted,'sourceHashes':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in sources}}
(ROOT/'.runtime-logs/android-recognizer-fixtures.json').write_text(json.dumps(result,default=encode,allow_nan=False),encoding='utf-8');print(json.dumps({'gates':{k:len(v) for k,v in gates.items()},'streams':len(outputs),'autoStreams':len(auto),'privateVideos':0}))
