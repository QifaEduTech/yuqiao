"""Synthetic features only: exercise actual CPU fitting/export and runtime boundaries."""
from pathlib import Path
import json,sys,subprocess,tempfile,shutil,os,time
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'server'))
from trained_runtime import TrainedRuntime
parent=ROOT/'.runtime-logs/self-training-tests';parent.mkdir(exist_ok=True)
directory=Path(tempfile.mkdtemp(dir=parent))
try:
 rows=[]
 for split in ['train','validation']:
  for label in [0,1]:
   for i in range(3):
    frames=np.full((24,178),float(label),np.float32);frames[:,74]=1;frames[:,150]=0
    rows.append({'split':split,'label':label,'frames':frames.tolist()})
 action={'id':'synthetic','signId':'csl.user.synthetic','text':'合成测试','hands':1,'motion':'static','revision':1}
 (directory/'features.json').write_text(json.dumps(rows),encoding='utf-8');(directory/'plan.json').write_text(json.dumps({'action':action,'output':str(directory)}),encoding='utf-8')
 with (directory/'worker.stderr').open('wb') as err:
  child=subprocess.Popen([str(ROOT/'.venv-anny/Scripts/python.exe'),'-B','-u',str(ROOT/'server/training_fit.py'),str(directory/'plan.json'),str(os.getpid())],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err)
  try:code=child.wait(timeout=90)
  finally:
   child.stdin.close()
   if child.poll() is None:child.kill();time.sleep(1)
  output=child.stdout.read()
 error=(directory/'worker.stderr').read_bytes();assert code==0,error.decode(errors='replace')
 assert json.loads(output)['trained'];meta=json.loads((directory/'model.json').read_text(encoding='utf-8'));entry={**action,'path':str(directory/'model.json'),'sha256':meta['sha256']}
 runtime=TrainedRuntime([entry]);frame=np.ones(178,dtype=np.float32);frame[150]=0
 payload={'frame':frame,'hands':[np.zeros((21,3))],'shoulders':[[0,0,1],[1,0,1]]}
 def base():return {'status':'observing','candidate':None,'reason':'no_supported_action','eventState':'collecting','event':None,'samples':0,'handSamples':0}
 observed=[]
 for i in range(60):observed.append(runtime.merge(i/30,payload,base()))
 assert any(r['candidate']=='合成测试' for r in observed),'Synthetic model did not reach candidate'
 events=[]
 for i in range(60,90):
  r=runtime.merge(i/30,None,base())
  if r['event']:events.append(r['event'])
 assert len(events)==1 and events[0]['id']==1
 runtime=TrainedRuntime([entry]);r=None
 for i in range(60):r=runtime.merge(i/30,payload,{**base(),'candidate':'谢谢','status':'candidate'})
 assert r['candidate'] is None and r['reason']=='ambiguous_actions'
 original={**base(),'candidate':'谢谢','status':'candidate'};assert TrainedRuntime([]).merge(0,payload,original)==original
 print('CPU fit/export parity, candidate, one completion, conflict rejection, and empty extension preservation passed. Synthetic data only.')
finally:
 assert directory.resolve().is_relative_to(parent.resolve());shutil.rmtree(directory)
