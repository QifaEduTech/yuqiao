"""Explicit registered-video development training, no independent accuracy claim."""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse,hashlib,importlib.util,json,sqlite3,subprocess,sys,base64
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory
from help_training_data import split_help_development,CONFIG
from sign_training_features import training_frame
spec=importlib.util.spec_from_file_location('quality',ROOT/'scripts/audit-sample-quality.py');quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--latest-owner',action='store_true',required=True);parser.add_argument('--train-registered-development',action='store_true');parser.add_argument('--export-matching-previous',action='store_true');args=parser.parse_args()
    items=inventory();readiness=split_help_development(items)
    if not args.train_registered_development or not readiness['readyForDevelopmentTraining']:
        print(json.dumps({'readiness':readiness,'trainingStarted':False}));return
    partitions={name:set(p['samples']) for name,p in readiness['splits'].items()};data={'protocol':CONFIG['id'],'splits':{k:[] for k in partitions},'exportModel':args.export_matching_previous};selected=[]
    db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    def current(item):
        row=db.execute('SELECT s.*,r.media_file,r.byte_length FROM sign_samples s JOIN records r ON s.record_id=r.id AND s.user_id=r.user_id WHERE s.record_id=? AND s.user_id=?',(item['recordId'],item['ownerId'])).fetchone()
        if not row or not row['active'] or row['revision']!=item['revision'] or row['source_sha256']!=item['sourceHash']:raise ValueError('registration_changed')
        path=(ROOT/'data/media'/row['media_file']).resolve()
        if not path.is_relative_to((ROOT/'data/media').resolve()) or not path.is_file() or path.stat().st_size!=row['byte_length'] or path.stat().st_size>32*1024*1024 or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_changed')
        return row,path
    try:
        for item in items:
            split=next((name for name,numbers in partitions.items() if item['sampleNumber'] in numbers),None)
            if split is None:continue
            row,path=current(item);payload=json.loads(row['payload']);frames=[];times=[]
            if payload['endSeconds']-payload['startSeconds']>CONFIG['maxDurationSeconds']:raise ValueError('duration_exceeds_protocol')
            def observe(t,result):
                frames.append(training_frame(result,t-times[-1] if times else 1/30));times.append(t)
                if len(frames)>CONFIG['maxFrames']:raise ValueError('frame_capacity_exceeded')
            quality_report=quality.inspect_video(path,payload,sample_interval_ms=0,on_observation=observe)
            if len(times)<2 or (len(times)-1)/(times[-1]-times[0])<CONFIG['minEffectiveFps']:raise ValueError('frame_rate_insufficient')
            if payload['category']=='help' and (quality_report['technicalStatus']!='pilot_checks_passed' or sum(f[74]>0 and f[150]>0 for f in frames)<12):raise ValueError('help_quality_needs_review')
            current(item);selected.append(item)
            data['splits'][split].append({'sampleNumber':item['sampleNumber'],'sourceHash':item['sourceHash'],'group':item['group'],'label':int(item['category']=='help'),'frames':np.asarray(frames).tolist()})
        worker=subprocess.run([str(ROOT/'.venv-anny/Scripts/python.exe'),'-B',str(ROOT/'scripts/help-training-worker.py')],input=json.dumps(data).encode(),capture_output=True,timeout=180,cwd=ROOT)
        if worker.returncode:raise ValueError('help_training_worker_failed')
        experiment=json.loads(worker.stdout)
        for item in selected:current(item)
        if args.export_matching_previous:
            expected=json.loads((ROOT/'docs/assets/help-video-training-2026-10-20.json').read_text(encoding='utf8'))['experiment']
            if experiment['weightsSha256']!=expected['weightsSha256'] or experiment['evaluations']!=expected['evaluations']:raise ValueError('model_does_not_match_previous_experiment')
            content=base64.b64decode(experiment.pop('checkpointBase64'),validate=True);directory=ROOT/'models/help-video-tcn/v1';directory.mkdir(parents=True,exist_ok=True)
            if (directory/'weights.npz').exists():raise ValueError('checkpoint_already_exists')
            (directory/'weights.npz').write_bytes(content)
            manifest={'id':CONFIG['id'],'version':'v1','architecture':'BinaryTCN-153-32-32-meanmax','featureProtocol':CONFIG['featureProtocol'],'artifactSha256':hashlib.sha256(content).hexdigest(),'weightsSha256':experiment['weightsSha256'],'threshold':CONFIG['threshold'],'knownError':'28.9_static_open_palms','review':'user_requested_trial_replacement','numpyParityMaxError':experiment['numpyParityMaxError']}
            (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8');experiment['modelPersisted']=True
        print(json.dumps({'readiness':readiness,'experiment':experiment,'sourceVersionsVerified':True,'datasetPersisted':False,'independentAccuracy':None}))
    finally:db.close()

if __name__=='__main__':main()
