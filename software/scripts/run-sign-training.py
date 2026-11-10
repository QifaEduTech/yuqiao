"""Explicit development training, guarded by source grouping and current labels.

Without separate capture groups this exits before decoding or training. All
features and candidate weights are in memory, not exported to public or disk.
"""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory,split_inventory,CONFIG
from sign_training_features import training_frame,FEATURE_ID
spec=importlib.util.spec_from_file_location('quality',ROOT/'scripts/audit-sample-quality.py')
quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--latest-owner',action='store_true',required=True)
parser.add_argument('--train-registered',action='store_true',help='Explicitly run a private development experiment on registered samples only')
args=parser.parse_args();os.chdir(ROOT)
items=inventory();readiness=split_inventory(items)
if not args.train_registered or not readiness['readyForPilotTraining']:
    print(json.dumps({**readiness,'trainingStarted':False,'featuresExtracted':False},ensure_ascii=True));sys.exit(0)

python=ROOT/'.venv-anny/Scripts/python.exe'
if not python.is_file():raise ValueError('isolated_training_runtime_missing')
db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
try:
    partitions={name:set(value['samples']) for name,value in readiness['splits'].items()}
    dataset={'featureProtocol':FEATURE_ID,'epochs':CONFIG['epochs'],'patience':CONFIG['patience'],'seed':CONFIG['seed'],'learningRate':CONFIG['learningRate'],'splits':{name:[] for name in partitions}}
    def current(row):
        stored=db.execute('SELECT s.*,r.media_file,r.byte_length FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.record_id=? AND s.user_id=?',(row['recordId'],row['ownerId'])).fetchone()
        if not stored or not stored['active'] or stored['revision']!=row['revision'] or stored['source_sha256']!=row['sourceHash']:raise ValueError('registration_changed')
        path=(ROOT/'data/media'/stored['media_file']).resolve()
        if not path.is_relative_to((ROOT/'data/media').resolve()) or not path.is_file() or path.stat().st_size!=stored['byte_length'] or path.stat().st_size>32*1024*1024 or hashlib.sha256(path.read_bytes()).hexdigest()!=row['sourceHash']:raise ValueError('source_changed')
        return stored,path
    included=[]
    for row in items:
        split=next((name for name,numbers in partitions.items() if row['sampleNumber'] in numbers),None)
        if split is None:continue
        stored,path=current(row);payload=json.loads(stored['payload'])
        if payload['endSeconds']-payload['startSeconds']>CONFIG['maxDurationSeconds']:raise ValueError('sample_duration_exceeds_protocol')
        frames=[];times=[]
        def observe(t,result):
            delta=t-times[-1] if times else 1/30
            frames.append(training_frame(result,delta));times.append(t)
            if len(frames)>CONFIG['maxFrames']:raise ValueError('frame_capacity_exceeded_no_truncation')
        quality.inspect_video(path,payload,sample_interval_ms=0,on_observation=observe)
        if len(times)<2 or (len(times)-1)/(times[-1]-times[0])<CONFIG['minEffectiveFps']:raise ValueError('insufficient_temporal_resolution')
        if payload['category']=='thanks' and sum(f[74]>0 or f[150]>0 for f in frames)<12:raise ValueError('positive_sample_needs_hand_review')
        current(row);included.append(row)
        dataset['splits'][split].append({'sampleNumber':row['sampleNumber'],'group':row['group'],'sourceHash':row['sourceHash'],'label':int(row['category']=='thanks'),'frames':np.asarray(frames).tolist()})
    worker=subprocess.run([str(python),'-B',str(ROOT/'scripts/sign-training-worker.py')],input=json.dumps(dataset).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,env=os.environ,timeout=180)
    if worker.returncode:raise ValueError('training_worker_failed')
    result=json.loads(worker.stdout)
    for row in included:current(row)
    print(json.dumps({'readiness':readiness,'experiment':result,'scope':'pilot_not_production_acceptance','datasetPersisted':False},ensure_ascii=True))
finally:db.close()
