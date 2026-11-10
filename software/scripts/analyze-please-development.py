"""Read-only spatial wrist diagnostics; no classifier, raw frame or feature export."""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse,hashlib,importlib.util,json,sqlite3,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory
from please_observation import spatial_hands
sp=importlib.util.spec_from_file_location('quality',ROOT/'scripts/audit-sample-quality.py');quality=importlib.util.module_from_spec(sp);sp.loader.exec_module(quality)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--latest-owner',required=True,action='store_true');parser.add_argument('--sample',action='append',required=True);args=parser.parse_args()
    items=[i for i in inventory() if i['sampleNumber'] in args.sample]
    if len(items)!=len(set(args.sample)):raise ValueError('sample_missing')
    db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row;reports=[]
    try:
        for item in items:
            r=db.execute('SELECT s.payload,r.media_file,r.byte_length FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.record_id=? AND s.user_id=?',(item['recordId'],item['ownerId'])).fetchone();path=(ROOT/'data/media'/r['media_file']).resolve()
            if not path.is_relative_to(ROOT/'data/media') or path.stat().st_size!=r['byte_length'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_changed')
            import cv2
            cap=cv2.VideoCapture(str(path.relative_to(ROOT)));width,height=cap.get(cv2.CAP_PROP_FRAME_WIDTH),cap.get(cv2.CAP_PROP_FRAME_HEIGHT);cap.release()
            if min(width,height)<=0:raise ValueError('invalid_dimensions')
            frames=[];duplicate=0;raw_both=0
            def observe(t,obs):
                nonlocal duplicate,raw_both
                raw=obs.multi_hand_landmarks or [];labels=[x.classification[0].label for x in obs.multi_handedness or []]
                if len(raw)==2:raw_both+=1;duplicate+=len(set(labels))<2
                hands=spatial_hands(obs,height/width)
                if len(hands)==2:frames.append((t,np.array([h[0,:2] for h in hands])))
            checked=quality.inspect_video(path,json.loads(r['payload']),on_observation=observe)
            values=np.array([v for _,v in frames]);stats={}
            if len(values)>=2:
                ranges=np.percentile(values,90,axis=0)-np.percentile(values,10,axis=0)
                dx=np.diff(values[:,:,0],axis=0);dt=np.diff([t for t,_ in frames]);continuous=dt<=.12
                motion=continuous&(np.min(np.abs(dx),axis=1)>=.003)
                stats={'wristXRangeImageWidths':ranges[:,0].round(4).tolist(),'wristYRangeImageWidths':ranges[:,1].round(4).tolist(),'pairedMovingSteps':int(motion.sum()),'sameHorizontalDirectionFraction':round(float(np.mean(np.prod(dx[motion],axis=1)>0)),4) if motion.any() else None,'longestObservationGapSeconds':round(float(dt.max()),3)}
            current=db.execute('SELECT active,revision,source_sha256 FROM sign_samples WHERE record_id=? AND user_id=?',(item['recordId'],item['ownerId'])).fetchone()
            if not current['active'] or current['revision']!=item['revision'] or current['source_sha256']!=item['sourceHash'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('sample_changed_during_audit')
            reports.append({'sampleNumber':item['sampleNumber'],'category':item['category'],'revision':item['revision'],'sourceHash':item['sourceHash'],'quality':checked,'rawBothFrames':raw_both,'distinctBothFrames':len(frames),'duplicateAnatomicalLabelFrames':duplicate,'trajectoryMeasurements':stats})
        print(json.dumps({'scope':'development_measurement_not_semantic_recognition','reports':reports,'databaseChanged':False,'trainingStarted':False,'rawFramesPersisted':False,'keypointsPersisted':False,'limitations':['Image wrist trajectories are not body-relative movement','Side-to-side motion alone cannot distinguish invitation from ordinary waving','Palm orientation and action meaning require separate validation']}))
    finally:db.close()

if __name__=='__main__':main()
