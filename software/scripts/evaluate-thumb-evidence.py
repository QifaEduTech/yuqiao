"""Explicit thumb evidence audit at source frame rate. No training or writes."""
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
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from thumb_motion import inspect_thumb_motion,flexion_evidence,RULES
from thumb_multijoint import multijoint_evidence
from thumb_local_motion import local_thumb_evidence
from sign_temporal import pack_sequence
from sign_worker import classifier,predict,decision,EXPECTED_LABELS
spec=importlib.util.spec_from_file_location('quality',ROOT/'scripts/audit-sample-quality.py')
quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--latest-owner',action='store_true',required=True)
    parser.add_argument('--sample',action='append',help='Explicit sample number; repeat to inspect several')
    parser.add_argument('--max-image-edge',type=int,default=640,help='Development decoding comparison only; production stays unchanged')
    parser.add_argument('--sample-interval-ms',type=int,default=0,help='Development sampling comparison, 0=all frames; does not change the live worker')
    args=parser.parse_args()
    if not 16<=args.max_image_edge<=4096:parser.error('image edge must be between 16 and 4096')
    if not 0<=args.sample_interval_ms<=200:parser.error('sampling interval must be between 0 and 200 ms')
    os.chdir(ROOT)
    db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    try:
        owner=db.execute('SELECT user_id FROM sign_samples WHERE active=1 ORDER BY updated_at DESC LIMIT 1').fetchone()
        if not owner:raise ValueError('no_registered_samples')
        rows=db.execute('SELECT s.*,r.media_file,r.byte_length,n.category,n.sequence FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id JOIN sample_numbers n ON n.record_id=s.record_id AND n.user_id=s.user_id AND n.category=json_extract(s.payload,\'$.category\') WHERE s.user_id=? AND s.active=1 ORDER BY r.created_at',(owner['user_id'],)).fetchall()
        if len(rows)>100:raise ValueError('too_many_samples')
        prefixes=json.loads((ROOT/'shared/sample-numbering.json').read_text(encoding='utf8'));reports=[];model=classifier()
        if args.sample:
            requested=set(args.sample)
            rows=[row for row in rows if f"{prefixes[row['category']]}.{row['sequence']}" in requested]
            if len(rows)!=len(requested):raise ValueError('requested_sample_not_found')
        for row in rows:
            payload=json.loads(row['payload']);path=(ROOT/'data/media'/row['media_file']).resolve()
            if not path.is_relative_to((ROOT/'data/media').resolve()) or not path.is_file() or path.stat().st_size!=row['byte_length'] or path.stat().st_size>32*1024*1024 or hashlib.sha256(path.read_bytes()).hexdigest()!=row['source_sha256']:raise ValueError('source_changed')
            timeline=[];measurement=quality.inspect_video(path,payload,lambda t,v:timeline.append((t,v)),sample_interval_ms=args.sample_interval_ms,max_image_edge=args.max_image_edge)
            evidence=inspect_thumb_motion(timeline)
            gate=flexion_evidence(timeline)
            multi_gate=multijoint_evidence(timeline)
            local_gate=local_thumb_evidence(timeline)
            projected_gate=flexion_evidence(timeline,dimensions=2)
            reduced=[];next_time=-1
            for t,v in timeline:
                if t+1e-6>=next_time:reduced.append((t,v));next_time=t+RULES['classifierSampleIntervalSeconds']
            packet=pack_sequence(reduced);candidate=False;top=None
            if packet['eligible']:
                scores=predict(*model,packet['tensor']);top=EXPECTED_LABELS[int(scores.argmax())]
                result=decision(scores,packet['coverage'],packet['internalMissingSeconds'])
                candidate=result['status']=='candidate' and result.get('sign_id')=='csl.thanks'
            current=db.execute('SELECT active,revision,source_sha256 FROM sign_samples WHERE record_id=? AND user_id=?',(row['record_id'],row['user_id'])).fetchone()
            if not current or not current['active'] or current['revision']!=row['revision'] or current['source_sha256']!=row['source_sha256'] or hashlib.sha256(path.read_bytes()).hexdigest()!=row['source_sha256']:raise ValueError('sample_changed_during_audit')
            reports.append({'sampleNumber':f"{prefixes[row['category']]}.{row['sequence']}",'category':row['category'],
                            'sampledFrames':measurement['sampledFrames'],'handFrames':measurement['handFrames'],'evidence':evidence,
                            'gate':gate,'projectedGate':projected_gate,'modelTopClass':top,'thanksBeforeGate':candidate,'thanksAfterGate':candidate and gate['supported'],
                            'thanksAfterProjectedGate':candidate and projected_gate['supported'],
                            'multiJointGate':multi_gate,'thanksAfterMultiJoint':candidate and multi_gate['supported'],
                            'localThumbGate':local_gate,'thanksAfterLocalGate':candidate and local_gate['supported']})
        positives=[r for r in reports if r['category']=='thanks'];negatives=[r for r in reports if r['category'] in ('other','background')]
        print(json.dumps({'scope':'development_only_not_holdout','sampling':'all_decoded_frames' if args.sample_interval_ms==0 else 'interval_decoded_frames','sampleIntervalMs':args.sample_interval_ms,'imageMaxEdge':args.max_image_edge,'reports':reports,'positiveClips':len(positives),'negativeClips':len(negatives),
                          'positiveBeforeGate':sum(r['thanksBeforeGate'] for r in positives),'positiveAfterGate':sum(r['thanksAfterGate'] for r in positives),
                          'negativeThanksBeforeGate':sum(r['thanksBeforeGate'] for r in negatives),'negativeThanksAfterGate':sum(r['thanksAfterGate'] for r in negatives),
                          'positiveAfterMultiJoint':sum(r['thanksAfterMultiJoint'] for r in positives),
                          'negativeThanksAfterMultiJoint':sum(r['thanksAfterMultiJoint'] for r in negatives),
                          'positiveAfterLocalGate':sum(r['thanksAfterLocalGate'] for r in positives),
                          'negativeThanksAfterLocalGate':sum(r['thanksAfterLocalGate'] for r in negatives),
                          'trainingStarted':False,'productionChanged':False},ensure_ascii=True))
    finally:db.close()

if __name__=='__main__':main()
