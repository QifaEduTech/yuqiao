"""Private registered-source diagnostics. No fitted classifier or exported frames."""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse,hashlib,importlib.util,json,sqlite3,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory
from thumb_motion import bend_degrees
from help_motion import inspect_help_motion
from help_live_probe import HelpLiveProbe
from realtime_events import LiveRecognizer
from sign_worker import classifier,predict,features
spec=importlib.util.spec_from_file_location('quality',ROOT/'scripts/audit-sample-quality.py');quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)

def summarize(timeline):
    both=[(t,h) for t,h in timeline if all(s in h for s in ['Left','Right'])]
    result={'sampledFrames':len(timeline),'bothHandsFrames':len(both),'hands':{}}
    for side in ['Left','Right']:
        selected=[(t,h[side]) for t,h in timeline if side in h]
        if not selected:result['hands'][side]={'frames':0};continue
        times=np.array([t for t,_ in selected]);hands=np.array([h for _,h in selected]);wrists=hands[:,0,:2]
        scales=np.linalg.norm(hands[:,9]-hands[:,0],axis=1)
        open_counts=[]
        for h in hands:
            opened=0
            for root,joint,distal,tip in [(5,6,7,8),(9,10,11,12),(13,14,15,16),(17,18,19,20)]:
                angle=bend_degrees(h[root],h[joint],h[distal])
                if angle is not None and angle<40 and np.linalg.norm(h[tip]-h[0])>1.2*np.linalg.norm(h[root]-h[0]):opened+=1
            open_counts.append(opened)
        low,high=np.percentile(wrists,[10,90],axis=0);scale=max(float(np.median(scales)),1e-8)
        result['hands'][side]={'frames':len(selected),'openFourFraction':round(float(np.mean(np.array(open_counts)>=3)),4),
            'wristXRangeInPalmLengths':round(float((high[0]-low[0])/scale),4),'wristYRangeInPalmLengths':round(float((high[1]-low[1])/scale),4),
            'palmScaleRelativeRange':round(float((np.percentile(scales,90)-np.percentile(scales,10))/scale),4)}
    # Central descriptive snapshots only, not thresholds or a source of labels.
    if both:
        snapshots=[]
        start,end=both[0][0],both[-1][0]
        for target in np.linspace(start,end,9):
            t,h=min(both,key=lambda x:abs(x[0]-target))
            snapshots.append({'time':round(t,3),**{s:{'wristXY':[round(float(v),4) for v in h[s][0,:2]],'palmScale':round(float(np.linalg.norm(h[s][9]-h[s][0])),4)} for s in ['Left','Right']}})
        result['motionSnapshots']=snapshots
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--latest-owner',action='store_true',required=True);parser.add_argument('--sample',action='append',required=True);parser.add_argument('--live-probe',action='store_true');args=parser.parse_args()
    items=[x for x in inventory() if x['sampleNumber'] in set(args.sample)]
    if len(items)!=len(set(args.sample)):raise ValueError('requested_samples_not_found')
    db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row;reports=[];model=classifier() if args.live_probe else None
    try:
        for item in items:
            row=db.execute('SELECT s.payload,r.media_file,r.byte_length FROM sign_samples s JOIN records r ON s.record_id=r.id AND s.user_id=r.user_id WHERE s.record_id=? AND s.user_id=?',(item['recordId'],item['ownerId'])).fetchone()
            path=(ROOT/'data/media'/row['media_file']).resolve();payload=json.loads(row['payload'])
            if not path.is_relative_to((ROOT/'data/media').resolve()) or not path.is_file() or path.stat().st_size!=row['byte_length'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_changed')
            timeline=[];feature_timeline=[]
            def observe(t,observation):
                chosen={}
                for landmarks,label in zip(observation.multi_hand_landmarks or [],observation.multi_handedness or []):
                    name=label.classification[0].label;confidence=label.classification[0].score
                    if name not in ('Left','Right'):continue
                    raw=np.array([[p.x,p.y,p.z] for p in landmarks.landmark],dtype=float)
                    if raw.shape!=(21,3) or not np.isfinite(raw).all():continue
                    if name not in chosen or confidence>chosen[name][0]:chosen[name]=(confidence,raw)
                timeline.append((t,{s:v[1] for s,v in chosen.items()}))
                if args.live_probe:feature_timeline.append((t,features(observation)))
            measurement=quality.inspect_video(path,payload,sample_interval_ms=30,on_observation=observe)
            # MediaPipe z is scaled like image x; convert y to width-normalized
            # units for geometric distances. Still inferred, not metric depth.
            width,height=measurement['dimensions']
            for _,hands in timeline:
                for hand in hands.values():hand[:,1]*=height/width
            current=db.execute('SELECT active,revision,source_sha256 FROM sign_samples WHERE record_id=? AND user_id=?',(item['recordId'],item['ownerId'])).fetchone()
            if not current['active'] or current['revision']!=item['revision'] or current['source_sha256']!=item['sourceHash'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('registration_changed')
            report={'sampleNumber':item['sampleNumber'],'category':item['category'],'sourceSha256':item['sourceHash'],'revision':item['revision'],**summarize(timeline),'geometryCandidate':inspect_help_motion(timeline)}
            if args.live_probe:
                help_probe=HelpLiveProbe();thanks=LiveRecognizer(lambda sequence:predict(*model,sequence));outputs=[];old=[]
                for (t,hands),(_,value) in zip(timeline,feature_timeline):
                    result=thanks.push(t,value);old.append(result);outputs.append(help_probe.push(t,hands,result['candidate'] is not None))
                end=timeline[-1][0] if timeline else 0
                for i in range(10):outputs.append(help_probe.push(end+(i+1)*.1,{}));old.append(thanks.push(end+(i+1)*.1,None))
                report['liveProbe']={'helpCandidateSeen':any(x['candidate'] for x in outputs),'helpEvents':sum(x['event'] is not None for x in outputs),'thanksCandidateSeen':any(x['candidate'] for x in old),'thanksEvents':sum(x['event'] is not None for x in old),'conflictFrames':sum(x['reason']=='conflicting_thanks_candidate' for x in outputs),'syntheticEndBoundary':True}
            reports.append(report)
        print(json.dumps({'scope':'development_geometry_not_accuracy','coordinateSystem':'image_width_normalized_xyz','reports':reports,'trainingStarted':False,'productionChanged':False,'rawLandmarksPersisted':False}))
    finally:db.close()

if __name__=='__main__':main()
