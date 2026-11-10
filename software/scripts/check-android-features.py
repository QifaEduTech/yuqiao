"""Generate synthetic landmark fixtures using the unchanged desktop feature functions."""
from pathlib import Path
from types import SimpleNamespace as NS
import json,sys,hashlib
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_features import training_frame
from me_training_features import body_training_frame
from need_directional_features import directional_features
from sign_worker import features
from help_tcn_inference import HelpTCN
from need_tcn_inference import NeedTCN
from me_tcn_inference import MeTCN
rules=json.loads((ROOT/'shared/me-motion.json').read_text(encoding='utf8'))
rng=np.random.default_rng(173)
template=np.array([[0.,0.,0.],[-.035,-.02,-.01],[-.06,-.045,-.02],[-.08,-.055,-.025],[-.095,-.07,-.03],[-.025,-.07,0],[-.025,-.105,-.01],[-.02,-.135,-.015],[-.015,-.165,-.02],[.005,-.08,.003],[.01,-.12,-.007],[.012,-.15,-.01],[.015,-.175,-.015],[.03,-.07,.005],[.04,-.105,.003],[.045,-.13,0],[.05,-.15,-.005],[.055,-.05,.004],[.07,-.08,.003],[.075,-.105,0],[.08,-.125,-.006]])
def hand(side='Left',score=.95,scale=1,shift=(.4,.65,0),noise=0):return {'side':side,'score':score,'points':(template*scale+shift+rng.normal(0,noise,(21,3))).tolist()}
def pose(visible=.9,span=.3):
 p=[dict(x=.5,y=.5,z=0.,visibility=.9) for _ in range(33)];p[11].update(x=.5-span/2,y=.4,visibility=visible);p[12].update(x=.5+span/2,y=.42,visibility=visible);return p
def observations(hands,body):
 h=NS(multi_hand_landmarks=[NS(landmark=[NS(x=p[0],y=p[1],z=p[2]) for p in v['points']]) for v in hands],multi_handedness=[NS(classification=[NS(label=v['side'],score=v['score'])]) for v in hands]);p=NS(pose_landmarks=NS(landmark=[NS(**v) for v in body]) if body else None);return h,p
cases=[]
handsets=[[],[hand()],[hand('Right')],[hand(),hand('Right',shift=(.7,.6,-.02))],[hand(score=.2),hand(score=.98,scale=1.4)],[hand(score=.98),hand(score=.2,scale=1.4)],[hand(scale=0)],[hand(scale=1e-10)],[hand(noise=.003)]]
for hands in handsets:
 for aspect in [.1,.5625,1.,1.7777777778,10.]:
  for body in [None,pose(),pose(.59),pose(span=.001)]:
   delta=float(rng.choice([0,1/30,.1,1,2]));h,p=observations(hands,body);f=features(h)
   cases.append({'hands':hands,'pose':body,'delta':delta,'aspect':aspect,'expected153':training_frame(h,delta).tolist(),'expected178':body_training_frame(h,p,delta,aspect).tolist(),'expected126':None if f is None else f.tolist()})
series=[]
for name,aspect,dt in [('normal',.5625,.1),('portrait',1.7777778,.08),('gap',1.,.201),('boundary',.5625,.2)]:
 frames=[];bodies=[];times=[];raw=[];t=0.
 for i in range(18):
  t+=dt if i else 0.;hs=[] if i in [6,7] else [hand(scale=1+.025*i,shift=(.4+i*.003,.65-i*.002,0)),hand('Right',scale=1.3-i*.01,shift=(.7,.6,0))];p0=pose() if i!=10 else None;h,p=observations(hs,p0);frames.append(training_frame(h,dt));bodies.append(body_training_frame(h,p,dt,aspect));times.append(t);raw.append({'hands':hs,'pose':p0,'delta':dt})
 for start in [0,9]:
  f=np.array(frames[start:]);b=np.array(bodies[start:]);ts=times[start:];n=directional_features(f,ts,aspect)
  series.append({'name':name+f'-window-{start}','aspect':aspect,'observations':raw[start:],'times':ts,'expected171':n.tolist(),'scores':{'help':HelpTCN().probability(f),'need':NeedTCN().probability(n),'me':MeTCN().probability(b)}})
source_files=['server/sign_training_features.py','server/me_training_features.py','server/need_directional_features.py','server/thumb_motion.py','server/thumb_multijoint.py','server/sign_worker.py','shared/me-motion.json','server/me_motion.py','server/help_tcn_inference.py','server/need_tcn_inference.py','server/me_tcn_inference.py']
out={'modelArtifactHashes':{name:cls().manifest['artifactSha256'] for name,cls in [('help',HelpTCN),('need',NeedTCN),('me',MeTCN)]},'syntheticOnly':True,'rules':rules,'cases':cases,'series':series,'sourceHashes':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in source_files}}
target=ROOT/'.runtime-logs/android-feature-fixtures.json';target.write_text(json.dumps(out,ensure_ascii=False,allow_nan=False),encoding='utf8');print(json.dumps({'staticCases':len(cases),'temporalCases':len(series),'sourceVideosRead':0,'output':str(target)}))
