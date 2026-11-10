"""Paired causal replay of model-only vs model-plus-motion on registered clips."""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import hashlib,importlib.util,json,sqlite3,sys,time
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory
from sign_training_features import training_frame
from help_tcn_inference import HelpTCN
from help_tcn_live import HelpTCNLive
from realtime_events import LiveRecognizer
from sign_worker import classifier,predict,features
spec=importlib.util.spec_from_file_location('quality',ROOT/'scripts/audit-sample-quality.py');quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)

def main():
    if sys.argv[1:]!=['--latest-owner']:raise ValueError('explicit_owner_required')
    items=[x for x in inventory() if x['category']!='uncertain'];model=HelpTCN();thanks_model=classifier();reports=[];timings=[]
    db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    try:
        for item in items:
            row=db.execute('SELECT s.payload,r.media_file,r.byte_length FROM sign_samples s JOIN records r ON s.record_id=r.id AND s.user_id=r.user_id WHERE s.record_id=? AND s.user_id=?',(item['recordId'],item['ownerId'])).fetchone();path=(ROOT/'data/media'/row['media_file']).resolve();label=json.loads(row['payload'])
            if not path.is_relative_to((ROOT/'data/media').resolve()) or path.stat().st_size!=row['byte_length'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_changed')
            timeline=[];last=None
            def observe(t,result):
                nonlocal last
                timeline.append((t,training_frame(result,t-last if last is not None else 1/30),features(result)));last=t
            measurement=quality.inspect_video(path,label,sample_interval_ms=30,on_observation=observe);width,height=measurement['dimensions']
            raw=HelpTCNLive(model,motion_check=False);guard=HelpTCNLive(model);thanks=LiveRecognizer(lambda x:predict(*thanks_model,x));raw_out=[];guard_out=[]
            for t,vector,feature in timeline:
                conflict=thanks.push(t,feature)['candidate'] is not None
                raw_out.append(raw.push_features(t,vector,conflict,aspect_ratio=height/width));began=time.perf_counter();guard_out.append(guard.push_features(t,vector,conflict,aspect_ratio=height/width));timings.append((time.perf_counter()-began)*1000)
            for i in range(10):
                t=timeline[-1][0]+(i+1)*.1;raw_out.append(raw.push_features(t,np.zeros(153)));guard_out.append(guard.push_features(t,np.zeros(153)))
            current=db.execute('SELECT active,revision,source_sha256 FROM sign_samples WHERE record_id=? AND user_id=?',(item['recordId'],item['ownerId'])).fetchone()
            if not current['active'] or current['revision']!=item['revision'] or current['source_sha256']!=item['sourceHash'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_or_registration_changed')
            reports.append({'sampleNumber':item['sampleNumber'],'category':item['category'],'revision':item['revision'],'sourceSha256':item['sourceHash'],
                            'before':{'candidate':any(x['candidate'] for x in raw_out),'events':sum(x['event'] is not None for x in raw_out)},
                            'after':{'candidate':any(x['candidate'] for x in guard_out),'events':sum(x['event'] is not None for x in guard_out)},
                            'motionRejections':sum(x['reason']=='help_motion_required' for x in guard_out)})
        summaries={}
        for mode in ['before','after']:
            summaries[mode]={'helpCandidates':sum(x['category']=='help' and x[mode]['candidate'] for x in reports),'nonHelpCandidates':sum(x['category']!='help' and x[mode]['candidate'] for x in reports),
                             'helpEvents':sum(x['category']=='help' and x[mode]['events']>0 for x in reports),'nonHelpEvents':sum(x['category']!='help' and x[mode]['events']>0 for x in reports)}
        print(json.dumps({'scope':'development_replay_not_independent_accuracy','syntheticEndBoundary':True,'reports':reports,'summary':summaries,'modelArtifactSha256':model.manifest['artifactSha256'],'guardProcessingP95Ms':float(np.percentile(timings,95)),'guardProcessingMaxMs':max(timings),'timingExcludesTrackingAndHttp':True,'sourceLabelsChanged':False}))
    finally:db.close()

if __name__=='__main__':main()
