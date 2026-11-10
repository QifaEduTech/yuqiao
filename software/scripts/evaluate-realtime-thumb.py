"""Registered development replay of live sampling, windows, gate, and events.

Uses annotation ranges unchanged; adds a synthetic hands-away boundary explicitly
for an offline event check. This is not a new holdout or real-camera throughput.
"""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import hashlib,importlib.util,json,sqlite3,sys,time
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory
from realtime_events import LiveRecognizer
from realtime_window import CONFIG
from sign_worker import classifier,predict
spec=importlib.util.spec_from_file_location('quality',ROOT/'scripts/audit-sample-quality.py');quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)

def main():
    if sys.argv[1:]!=['--latest-owner']:raise ValueError('explicit_latest_owner_required')
    items=inventory();db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    model=classifier();reports=[];timings=[]
    try:
        for item in items:
            if item['category'] not in ('thanks','background','other'):continue
            row=db.execute('SELECT s.payload,r.media_file,r.byte_length FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.record_id=? AND s.user_id=?',(item['recordId'],item['ownerId'])).fetchone()
            path=(ROOT/'data/media'/row['media_file']).resolve();payload=json.loads(row['payload'])
            if not path.is_relative_to((ROOT/'data/media').resolve()) or not path.is_file() or path.stat().st_size!=row['byte_length'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_changed')
            live=LiveRecognizer(lambda x:predict(*model,x));outputs=[];last=None
            def observe(t,v):
                nonlocal last
                began=time.perf_counter();outputs.append(live.push(t,v));timings.append((time.perf_counter()-began)*1000);last=t
            quality.inspect_video(path,payload,on_sample=observe,sample_interval_ms=CONFIG['frameIntervalMs'])
            if last is None:raise ValueError('empty_annotation')
            boundary=[live.push(last+(i+1)/10,None) for i in range(10)]
            current=db.execute('SELECT active,revision,source_sha256 FROM sign_samples WHERE record_id=? AND user_id=?',(item['recordId'],item['ownerId'])).fetchone()
            if not current['active'] or current['revision']!=item['revision'] or current['source_sha256']!=item['sourceHash'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('registration_or_source_changed')
            events=[x['event'] for x in outputs+boundary if x['event']]
            reports.append({'sampleNumber':item['sampleNumber'],'category':item['category'],'candidateSeen':any(x['candidate'] for x in outputs),'eventCount':len(events),'frames':len(outputs),'motionGateRejections':sum(x['reason']=='thumb_motion_required' for x in outputs)})
        print(json.dumps({'scope':'development_replay_not_live_accuracy','sampleIntervalMs':CONFIG['frameIntervalMs'],'syntheticEndingBoundary':True,'reports':reports,'positiveClips':sum(x['category']=='thanks' for x in reports),'negativeClips':sum(x['category']!='thanks' for x in reports),'positiveCandidates':sum(x['category']=='thanks' and x['candidateSeen'] for x in reports),'negativeCandidates':sum(x['category']!='thanks' and x['candidateSeen'] for x in reports),'positiveEvents':sum(x['category']=='thanks' and x['eventCount']>0 for x in reports),'negativeEvents':sum(x['category']!='thanks' and x['eventCount']>0 for x in reports),'windowProcessingP95Ms':float(np.percentile(timings,95)),'windowProcessingMaxMs':max(timings),'timingExcludesTrackingAndHttp':True,'labelsChanged':False,'trainingStarted':False}))
    finally:db.close()

if __name__=='__main__':main()
