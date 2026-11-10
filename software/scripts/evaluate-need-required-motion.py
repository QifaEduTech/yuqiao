"""Pair a frozen full-video model report with causal movement evidence.

No weight fitting, source relabeling, raw-frame persistence or live deployment.
Whole-video model scores are not streaming predictions or completed events.
"""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse,hashlib,importlib.util,json,sqlite3,sys,time
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory
from sign_training_features import training_frame
from need_required_motion import NeedRequiredMotion
from need_live import NeedLiveRecognizer
from need_tcn_inference import NeedTCN
spec=importlib.util.spec_from_file_location('quality',ROOT/'scripts/audit-sample-quality.py');quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--latest-owner',required=True,action='store_true');p.add_argument('--model-report',default='docs/assets/need-excluded-directional-training-2026-10-20.json');p.add_argument('--stream',action='store_true');p.add_argument('--sample',action='append');args=p.parse_args()
    path=(ROOT/args.model_report).resolve()
    if not path.is_relative_to(ROOT):raise ValueError('report_outside_project')
    saved=json.loads(path.read_text(encoding='utf8'));versions={v['number']:v for v in saved['registeredVersions']};scores={s['sampleNumber']:s for group in saved['experiment']['evaluations'].values() for s in group['samples']}
    if set(versions)!=set(scores):raise ValueError('report_inventory_mismatch')
    model=NeedTCN() if args.stream else None
    if model and model.manifest['weightsSha256']!=saved['experiment']['weightsSha256']:raise ValueError('streaming_model_mismatch')
    items=[x for x in inventory() if x['sampleNumber'] in versions]
    if len(items)!=len(versions):raise ValueError('registered_sources_missing')
    if args.sample:
        if not set(args.sample)<=set(versions):raise ValueError('unknown_requested_sample')
        items=[x for x in items if x['sampleNumber'] in args.sample]
    db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row;reports=[];latencies=[]
    try:
        for item in items:
            version=versions[item['sampleNumber']];score=scores[item['sampleNumber']]
            if item['category']=='uncertain' or version['sourceHash']!=item['sourceHash'] or version['revision']!=item['revision'] or score['label']!=int(item['category']=='need'):raise ValueError('labels_or_versions_changed')
            row=db.execute('SELECT s.payload,r.media_file,r.byte_length FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.record_id=? AND s.user_id=?',(item['recordId'],item['ownerId'])).fetchone();source=(ROOT/'data/media'/row['media_file']).resolve()
            if not source.is_relative_to(ROOT/'data/media') or source.stat().st_size!=row['byte_length'] or hashlib.sha256(source.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_changed')
            frames=[];times=[]
            def observe(t,obs):frames.append(training_frame(obs,t-times[-1] if times else 1/30));times.append(t)
            checked=quality.inspect_video(source,json.loads(row['payload']),sample_interval_ms=0,on_observation=observe);aspect=checked['dimensions'][1]/checked['dimensions'][0];gate=NeedRequiredMotion();evidence=[]
            for t,f in zip(times,frames):
                start=time.perf_counter();r=gate.push(t,f,aspect);latencies.append((time.perf_counter()-start)*1000)
                if r['supported']:evidence.extend(r['evidence'])
            frozen_gate=NeedRequiredMotion();frozen_seen=False;present=[i for i,f in enumerate(frames) if f[74]>0 or f[150]>0]
            fixed=frames[present[len(present)//2]] if present else np.zeros(153)
            for t in times:frozen_seen=frozen_gate.push(t,fixed,aspect)['supported'] or frozen_seen
            current=db.execute('SELECT active,revision,source_sha256 FROM sign_samples WHERE record_id=? AND user_id=?',(item['recordId'],item['ownerId'])).fetchone()
            if not current['active'] or current['revision']!=item['revision'] or current['source_sha256']!=item['sourceHash'] or hashlib.sha256(source.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('registration_changed')
            positive=score['needProbability']>=saved['experiment']['threshold']
            report={'number':item['sampleNumber'],'category':item['category'],'sourceHash':item['sourceHash'],'revision':item['revision'],'modelScore':score['needProbability'],'modelPositive':positive,'motionSeen':bool(evidence),'combinedCandidate':positive and bool(evidence),'frozenMotionSeen':frozen_seen,'firstEvidence':evidence[0] if evidence else None}
            if args.stream:
                live=NeedLiveRecognizer(model);outputs=[];trace=[];previous=None
                for t,f in zip(times,frames):
                    output=live.push_features(t,f,aspect);outputs.append(output);state=(output['candidate'],output['eventState'],output['needMotionSupported'])
                    if state!=previous:trace.append({'time':t,'candidate':output['candidate'],'state':output['eventState'],'motion':output['needMotionSupported'],'score':output['needScore'],'freshSupports':live.count});previous=state
                for i in range(10):outputs.append(live.push_features(times[-1]+(i+1)*.1,np.zeros(153),aspect))
                report['streaming']={'candidateSeen':any(x['candidate'] for x in outputs),'events':[x['event'] for x in outputs if x['event']],'syntheticEndingBoundary':True,'transitions':trace}
            reports.append(report)
        print(json.dumps({'scope':'development_full_video_scores_plus_causal_motion_not_live_event_accuracy','modelWeightsSha256':saved['experiment']['weightsSha256'],'reports':reports,'gateLatencyMs':{'mean':float(np.mean(latencies)),'p95':float(np.percentile(latencies,95)),'max':float(np.max(latencies))},'trainingStarted':False,'modelPersisted':False,'productionChanged':False,'independentAccuracy':None}))
    finally:db.close()

if __name__=='__main__':main()
