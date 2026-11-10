"""Explicit, read-only development comparison on registered pilot clips.

Not a training job, independent accuracy measurement, or production upgrade.
Raw images and features stay in memory; stdout contains compact numeric results.
"""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse
from datetime import datetime,timezone,timedelta
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from sign_temporal import pack_sequence,WholeActionBuffer,PROTOCOL
from sign_worker import classifier,predict,decision,EXPECTED_LABELS
from realtime_window import LiveWindow
from thumb_motion import inspect_thumb_motion

spec=importlib.util.spec_from_file_location('quality',ROOT/'scripts/audit-sample-quality.py')
quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--latest-owner',action='store_true',required=True)
    args=parser.parse_args()
    os.chdir(ROOT)
    db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    try:
        owner=db.execute('SELECT user_id FROM sign_samples WHERE active=1 ORDER BY updated_at DESC LIMIT 1').fetchone()
        if not owner:raise ValueError('no_registered_samples')
        count=db.execute('SELECT COUNT(*) FROM sign_samples WHERE user_id=? AND active=1',(owner['user_id'],)).fetchone()[0]
        if count>100:raise ValueError('scope_exceeds_100_samples')
        rows=db.execute('SELECT s.*,r.media_file,r.byte_length,r.created_at FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.active=1 AND s.user_id=? ORDER BY r.created_at,s.record_id',(owner['user_id'],)).fetchall()
        model=classifier();classify=lambda tensor:predict(*model,tensor)
        reports=[];groups=set();hashes=set();duplicates=0
        prefixes=json.loads((ROOT/'shared/sample-numbering.json').read_text(encoding='utf8'))
        for row in rows:
            payload=json.loads(row['payload']);category=payload['category']
            seq=db.execute('SELECT sequence FROM sample_numbers WHERE record_id=? AND user_id=? AND category=?',(row['record_id'],row['user_id'],category)).fetchone()
            number=f"{prefixes[category]}.{seq['sequence']}" if seq else None
            # Prior manual batch strings may be sample numbers, not capture sessions.
            date=datetime.fromtimestamp(row['created_at']/1000,timezone(timedelta(hours=8))).date().isoformat()
            group=hashlib.sha256(f"{row['user_id']}|{payload['performer']}|{date}".encode()).hexdigest()[:12]
            groups.add(group)
            duplicates+=row['source_sha256'] in hashes;hashes.add(row['source_sha256'])
            result={'sampleNumber':number,'category':category}
            try:
                path=(ROOT/'data/media'/row['media_file']).resolve()
                if not path.is_relative_to((ROOT/'data/media').resolve()) or not path.is_file():raise ValueError('source_missing')
                if path.stat().st_size!=row['byte_length'] or path.stat().st_size>32*1024*1024 or hashlib.sha256(path.read_bytes()).hexdigest()!=row['source_sha256']:raise ValueError('source_changed')
                timeline=[]
                measurement=quality.inspect_video(path,payload,lambda t,v:timeline.append((t,v)))
                packet=pack_sequence(timeline)
                result['thumbMotion']=inspect_thumb_motion(timeline)
                streamed=WholeActionBuffer()
                for t,v in timeline:streamed.push(t,v)
                stream_packet=streamed.finish()
                if not np.array_equal(packet['tensor'],stream_packet['tensor']) or not np.array_equal(packet['handMask'],stream_packet['handMask']):raise ValueError('offline_stream_mismatch')
                if packet['eligible']:
                    scores=classify(packet['tensor']);best=int(np.argmax(scores))
                    proposed=decision(scores,packet['coverage'],packet['internalMissingSeconds'])
                    new_target=proposed['status']=='candidate' and proposed.get('sign_id')=='csl.thanks'
                    result.update({'proposedTopClass':EXPECTED_LABELS[best],'proposedThanksCandidate':new_target})
                else:
                    result.update({'proposedTopClass':None,'proposedThanksCandidate':False})
                baseline=LiveWindow(classify);last=None
                for t,v in timeline:
                    response=baseline.push(t,v)
                    if v is not None:last=response
                old_target=bool(last and last['candidate']=='谢谢')
                result.update({'legacyLastHandCandidate':old_target,'activeSeconds':round(packet['end']-packet['start'],3),
                               'wholeActionRetained':True,'offlineStreamingEqual':True,'observedSlots':int(packet['observed'].sum()),
                               'temporalEligible':packet['eligible'],'reasons':packet['reasons'],
                               'qualityStatus':measurement['technicalStatus']})
                current=db.execute('SELECT active,revision,source_sha256 FROM sign_samples WHERE record_id=? AND user_id=?',(row['record_id'],row['user_id'])).fetchone()
                if not current or not current['active'] or current['revision']!=row['revision'] or current['source_sha256']!=row['source_sha256'] or hashlib.sha256(path.read_bytes()).hexdigest()!=row['source_sha256']:raise ValueError('sample_changed_during_evaluation')
            except (ValueError,OSError) as error:
                result={'sampleNumber':number,'category':category,'error':str(error) if isinstance(error,ValueError) else 'source_read_failed'}
            reports.append(result)
        valid=[r for r in reports if 'error' not in r and r['category']!='uncertain']
        positives=[r for r in valid if r['category']=='thanks'];negatives=[r for r in valid if r['category'] in ('background','other')]
        print(json.dumps({'scope':'single_owner_pilot_development_not_holdout','protocol':PROTOCOL['id'],
                          'sampleCount':len(reports),'coarseCaptureGroupCount':len(groups),'duplicateSourceCount':duplicates,
                          'splitCreated':False,'trainingStarted':False,'productionChanged':False,
                          'positiveClips':len(positives),'negativeClips':len(negatives),
                          'legacyPositiveCandidates':sum(r['legacyLastHandCandidate'] for r in positives),
                          'proposedPositiveCandidates':sum(r['proposedThanksCandidate'] for r in positives),
                          'legacyNegativeThanksCandidates':sum(r['legacyLastHandCandidate'] for r in negatives),
                          'proposedNegativeThanksCandidates':sum(r['proposedThanksCandidate'] for r in negatives),
                          'reports':reports},ensure_ascii=True))
    finally:db.close()

if __name__=='__main__':main()
