"""Read-only registered need diagnostics. No classifier or training labels inferred."""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse,hashlib,importlib.util,json,sqlite3,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory
from help_motion import hand_features
from need_motion import inspect_need_motion
spec=importlib.util.spec_from_file_location('quality',ROOT/'scripts/audit-sample-quality.py');quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--latest-owner',action='store_true',required=True);group=p.add_mutually_exclusive_group(required=True);group.add_argument('--sample',action='append');group.add_argument('--all-registered',action='store_true');args=p.parse_args()
    items=[x for x in inventory() if args.all_registered or x['sampleNumber'] in args.sample]
    if args.sample and len(items)!=len(set(args.sample)):raise ValueError('requested_samples_missing')
    db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row;reports=[]
    try:
        for item in items:
            row=db.execute('SELECT s.payload,r.media_file,r.byte_length FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.record_id=? AND s.user_id=?',(item['recordId'],item['ownerId'])).fetchone()
            path=(ROOT/'data/media'/row['media_file']).resolve()
            if not path.is_relative_to(ROOT/'data/media') or path.stat().st_size!=row['byte_length'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_changed')
            timeline=[]
            def observe(t,obs):
                chosen={}
                for lm,label in zip(obs.multi_hand_landmarks or [],obs.multi_handedness or []):
                    tag=label.classification[0];raw=np.array([[v.x,v.y,v.z] for v in lm.landmark])
                    if tag.label not in ('Left','Right') or raw.shape!=(21,3) or not np.isfinite(raw).all():continue
                    if tag.label not in chosen or tag.score>chosen[tag.label][0]:chosen[tag.label]=(tag.score,raw)
                timeline.append((t,{s:v[1] for s,v in chosen.items()}))
            quality_result=quality.inspect_video(path,json.loads(row['payload']),sample_interval_ms=30,on_observation=observe)
            aspect=quality_result['dimensions'][1]/quality_result['dimensions'][0];sides={}
            for side in ['Left','Right']:
                selected=[]
                for t,hands in timeline:
                    if side not in hands:continue
                    h=hands[side].copy();h[:,1]*=aspect;features=hand_features(h)
                    if features is None:continue
                    wrist,scale,opened=features
                    normal=np.cross(h[5]-h[0],h[17]-h[0]);normal/=max(np.linalg.norm(normal),1e-8)
                    selected.append({'t':round(t,3),'wristXY':wrist.tolist(),'palmScale':float(scale),'openFingers':opened,'normal':normal.tolist(),
                        'palmWidth2d':float(np.linalg.norm(h[5,:2]-h[17,:2])),
                        'palmLength2d':float(np.linalg.norm(h[9,:2]-h[0,:2])),
                        'knuckleSpan2d':float(np.mean([np.linalg.norm(h[a,:2]-h[b,:2]) for a,b in [(5,9),(9,13),(13,17)]])),
                        'extent2d':float(np.linalg.norm(np.ptp(h[:,:2],axis=0)))})
                if not selected:continue
                snapshots=[selected[i] for i in sorted(set(np.linspace(0,len(selected)-1,9).astype(int)))]
                # Descriptive only; entry/exit and orientation can change apparent
                # palm size too. A shrinking projection is not metric depth.
                sides[side]={'frames':len(selected),'snapshots':snapshots,'openThreeOrMoreFraction':sum(x['openFingers']>=3 for x in selected)/len(selected)}
            current=db.execute('SELECT active,revision,source_sha256 FROM sign_samples WHERE record_id=? AND user_id=?',(item['recordId'],item['ownerId'])).fetchone()
            if not current['active'] or current['revision']!=item['revision'] or current['source_sha256']!=item['sourceHash'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('registration_changed')
            corrected=[]
            for t,hands in timeline:
                hs={s:h.copy() for s,h in hands.items()}
                for h in hs.values():h[:,1]*=aspect
                corrected.append((t,hs))
            reports.append({'sampleNumber':item['sampleNumber'],'category':item['category'],'revision':item['revision'],'sourceHash':item['sourceHash'],'quality':quality_result,'sides':sides,'projectionHypothesis':inspect_need_motion(corrected)})
        print(json.dumps({'scope':'descriptive_development_only_not_recognition_accuracy','reports':reports,'databaseChanged':False,'rawFramesPersisted':False,'trained':False,'productionChanged':False}))
    finally:db.close()

if __name__=='__main__':main()
