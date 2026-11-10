"""Read registered private videos, compare two grouped CPU training candidates.

Originals, annotations and online models remain unchanged. Features and weights
stay in memory; only aggregate quality, versions and training metrics persist.
"""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse,hashlib,importlib.util,json,os,sqlite3,subprocess,sys,base64
from pathlib import Path
import cv2
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory
from me_training_data import CONFIG,split_me_development
from me_training_features import body_training_frame
from sign_worker import features
from me_motion import inspect_me_motion

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
graphs=load('graphs',ROOT/'scripts/extract-sign-motion.py')
quality=load('quality',ROOT/'scripts/audit-sample-quality.py')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--latest-owner',required=True,action='store_true')
    parser.add_argument('--train-registered-development',action='store_true')
    parser.add_argument('--export-matching-report')
    args=parser.parse_args();os.chdir(ROOT)
    items=inventory();ready=split_me_development(items)
    if not args.train_registered_development or not ready['readyForDevelopmentTraining']:
        print(json.dumps({'readiness':ready,'trainingStarted':False}));return
    partitions={name:set(v['samples']) for name,v in ready['splits'].items()}
    selected=[i for i in items if any(i['sampleNumber'] in p for p in partitions.values())]
    db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    review=json.loads((ROOT/'docs/assets/me-32.5-source-review-2026-10-21.json').read_text(encoding='utf8'))
    payload={'protocol':CONFIG['id'],'splits':{'train':[],'validation':[]},'exportBodyCandidate':bool(args.export_matching_report)};checks=[]
    def current(item):
        row=db.execute('SELECT s.*,r.media_file,r.byte_length FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.record_id=? AND s.user_id=?',(item['recordId'],item['ownerId'])).fetchone()
        if not row or not row['active'] or row['revision']!=item['revision'] or row['source_sha256']!=item['sourceHash']:raise ValueError('registration_changed')
        path=(ROOT/'data/media'/row['media_file']).resolve()
        if not path.is_relative_to(ROOT/'data/media') or not path.is_file() or path.stat().st_size!=row['byte_length'] or path.stat().st_size>32*1024*1024 or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_changed')
        return row,path
    try:
        for item in selected:
            row,path=current(item);annotation=json.loads(row['payload'])
            start,end=annotation['startSeconds'],annotation['endSeconds']
            if not 0<=start<end or end-start>CONFIG['maxDurationSeconds']:raise ValueError('invalid_annotation_range')
            cap=cv2.VideoCapture(str(path.relative_to(ROOT)))
            if not cap.isOpened():raise ValueError('video_decode_failed')
            frames=[];times=[];observations=[];hand_values=[];timeline=[]
            previous=-1.;origin=None;count=0;steps=[]
            try:
                fps=cap.get(cv2.CAP_PROP_FPS);usable=np.isfinite(fps) and 1<=fps<=120
                with graphs.graph('hands') as hands,graphs.graph('pose') as pose:
                    while True:
                        ok,frame=cap.read()
                        if not ok:break
                        pts=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
                        if origin is None:origin=pts if np.isfinite(pts) and pts>=0 else 0
                        t=pts-origin
                        if not np.isfinite(t) or t<0 or t<=previous:
                            if not usable:raise ValueError('invalid_video_timestamps')
                            t=max(count/fps,previous+1/fps)
                        if previous>=0:steps.append(t-previous)
                        previous=t;count+=1
                        if count>4000 or t>32:raise ValueError('source_duration_limit')
                        if t<start or t>=end:continue
                        height,width=frame.shape[:2]
                        if min(height,width)<16 or max(height,width)>4096 or height*width>3840*2160:raise ValueError('invalid_dimensions')
                        scale=min(1,640/max(height,width));image=cv2.resize(cv2.flip(frame,1),(round(width*scale),round(height*scale)))
                        rgb=cv2.cvtColor(image,cv2.COLOR_BGR2RGB);h=hands.process({'image':rgb});p=pose.process({'image':rgb})
                        delta=t-times[-1] if times else 1/30
                        frames.append(body_training_frame(h,p,delta,height/width));times.append(float(t))
                        value=features(h);observations.append((t,value is not None))
                        if value is not None:hand_values.append(value)
                        raw=[np.array([[v.x,v.y*height/width,v.z] for v in lm.landmark]) for lm in h.multi_hand_landmarks or []]
                        body=[[p.pose_landmarks.landmark[i].x,p.pose_landmarks.landmark[i].y*height/width,p.pose_landmarks.landmark[i].visibility] for i in (11,12)] if p.pose_landmarks else []
                        timeline.append((float(t),raw,body))
                        if len(frames)>CONFIG['maxFrames']:raise ValueError('feature_capacity')
            finally:cap.release()
            if len(times)<2 or (len(times)-1)/(times[-1]-times[0])<CONFIG['minEffectiveFps']:raise ValueError('insufficient_fps')
            duration=previous+(float(np.median(steps[-30:])) if steps else 0)
            report=quality.evaluate(item['category'],start,end,duration,observations,hand_values)
            reviewed_gap=False
            if item['category']=='me' and report['reasons']:
                reviewed_gap=(item['sampleNumber']==review['sampleNumber'] and item['sourceHash']==review['sourceHash'] and report['reasons']==[review['permittedQualityReason']] and all(present for t,present in observations if t>=.784))
                if not reviewed_gap:raise ValueError('me_quality_requires_review:'+item['sampleNumber'])
            current(item);evidence=inspect_me_motion(timeline)
            partition=next(name for name,numbers in partitions.items() if item['sampleNumber'] in numbers)
            payload['splits'][partition].append({'sampleNumber':item['sampleNumber'],'sourceHash':item['sourceHash'],'group':item['group'],'label':int(item['category']=='me'),'frames':np.asarray(frames).tolist(),'bodyEvidence':evidence['supported']})
            checks.append({'sampleNumber':item['sampleNumber'],'revision':item['revision'],'sourceHash':item['sourceHash'],'partition':partition,'frames':len(frames),'quality':report,'reviewedPreparationGap':reviewed_gap,'bodyEvidence':evidence['supported']})
            print('Extracted '+item['sampleNumber'],file=sys.stderr,flush=True)
        result=subprocess.run([str(ROOT/'.venv-anny/Scripts/python.exe'),'-B',str(ROOT/'scripts/me-training-worker.py')],input=json.dumps(payload).encode('utf8'),capture_output=True,timeout=240,cwd=ROOT)
        if result.returncode:raise ValueError('me_training_worker_failed:'+result.stderr.decode('utf8',errors='replace')[-1000:])
        experiment=json.loads(result.stdout)
        for item in selected:current(item)
        if args.export_matching_report:
            report_path=(ROOT/args.export_matching_report).resolve()
            if not report_path.is_relative_to(ROOT):raise ValueError('report_outside_project')
            frozen=json.loads(report_path.read_text(encoding='utf-8-sig'));expected=frozen['experiment']['experiments']['handsBody178'];actual=experiment['experiments']['handsBody178']
            old_versions=[(r['sampleNumber'],r['revision'],r['sourceHash'],r['partition']) for r in frozen['qualityChecks']]
            versions=[(r['sampleNumber'],r['revision'],r['sourceHash'],r['partition']) for r in checks]
            if old_versions!=versions or frozen['readiness']!=ready or expected['weightsSha256']!=actual['weightsSha256'] or expected['evaluations']!=actual['evaluations']:raise ValueError('export_does_not_match_frozen_training')
            for partition in actual['evaluations'].values():
                if partition['counts']['prediction']['fp'] or partition['counts']['prediction']['fn']:raise ValueError('candidate_has_known_training_or_validation_errors')
            content=base64.b64decode(actual.pop('checkpointBase64'),validate=True)
            directory=ROOT/'models/me-video-tcn/experimental-v1'
            directory.mkdir(parents=True,exist_ok=False)
            (directory/'weights.npz').write_bytes(content)
            manifest={'id':CONFIG['id'],'version':'experimental-v1','featureProtocol':CONFIG['featureProtocol'],'artifactSha256':hashlib.sha256(content).hexdigest(),'weightsSha256':actual['weightsSha256'],'threshold':CONFIG['threshold'],'numpyParityMaxError':actual['numpyParityMaxError'],'productionEligible':False,'liveEnabled':False,'requiredEvidence':'me-body-pointing-development-v1','review':'development_candidate_pending_sliding_window_and_live_validation'}
            (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
            actual['modelPersisted']=True;experiment['modelPersisted']=True
        print(json.dumps({'readiness':ready,'experiment':experiment,'sourceVersionsVerified':True,'qualityChecks':checks,'rawFramesPersisted':False,'featuresPersisted':False,'independentAccuracy':None}))
    finally:db.close()

if __name__=='__main__':main()
