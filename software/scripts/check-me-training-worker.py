"""Synthetic export smoke check; never reads or updates project training data."""
import json,subprocess,sys,base64,io
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
config=json.loads((ROOT/'shared/me-video-training.json').read_text(encoding='utf8'))
splits={}
for part in ['train','validation']:
    splits[part]=[{'sampleNumber':part+str(i),'sourceHash':part+str(i),'group':part,'label':i%2,'bodyEvidence':bool(i%2),'frames':np.full((8,178),float(i%2)).tolist()} for i in range(4)]
result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/me-training-worker.py')],input=json.dumps({'protocol':config['id'],'splits':splits,'exportBodyCandidate':True}).encode(),capture_output=True,timeout=60)
if result.returncode:raise RuntimeError(result.stderr.decode(errors='replace'))
data=json.loads(result.stdout);e=data['experiments']['handsBody178']
assert not data['modelPersisted'] and e['numpyParityMaxError']<=1e-5
with np.load(io.BytesIO(base64.b64decode(e['checkpointBase64'])),allow_pickle=False) as arrays:
    assert arrays['first.weight'].shape==(32,178,3)
print('Synthetic worker export and NumPy parity passed; no project data or model written.')
