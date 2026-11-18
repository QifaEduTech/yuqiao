"""Explicit local experiment inventory/extraction. All source details stay in data/."""
import argparse
from collections import Counter
import ctypes
import gzip
import hashlib
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from sign_training_data import inventory
from project_database import connect
from unified_runtime import CONFIG, quality
import numpy as np


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, default=lambda x: x.tolist() if isinstance(x,np.ndarray) else int(x)), encoding='utf8')


def plan(directory):
    items = inventory()
    if len(items) > CONFIG['maxSamples']:
        raise ValueError('sample_budget_exceeded')
    db = connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro', uri=True)
    rows = []
    try:
        for item in items:
            r = db.execute('SELECT s.*,r.media_file,r.byte_length FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.record_id=? AND s.user_id=?', (item['recordId'],item['ownerId'])).fetchone()
            p = json.loads(r['payload'])
            path = (ROOT/'data/media'/r['media_file']).resolve()
            if not path.is_relative_to((ROOT/'data/media').resolve()) or not path.is_file() or path.stat().st_size != r['byte_length'] or digest(path) != item['sourceHash']:
                raise ValueError('source_integrity_failed')
            rows.append({**item, 'path': str(path), 'annotation': p,
                         'performerHash': hashlib.sha256((str(item['ownerId'])+'|'+p['performer']).encode()).hexdigest(),
                         'eligible': bool(item['reviewed'] and item['complete'] and item['category'] in CONFIG['labels'][1:]+['background','other']),
                         'usage': 'previously_registered_development_no_independent_test_claim'})
    finally:
        db.close()
    # Freeze group assignments without examining predictions or quality outcomes.
    heldout = set()
    for category in CONFIG['labels'][1:]:
        candidates = [r for r in rows if r['eligible'] and r['category']==category and r['groupSource']=='declared_capture_round']
        if not candidates:
            raise ValueError('missing_declared_holdout_group_'+category)
        heldout.add(max(candidates,key=lambda r:r['createdAt'])['group'])
    for r in rows:
        r['split'] = ('development_holdout' if r['group'] in heldout else 'train') if r['eligible'] else 'unknown_challenge' if r['category']=='please' and r['reviewed'] and r['complete'] else 'excluded'
        r['label'] = CONFIG['labels'].index(r['category']) if r['category'] in CONFIG['labels'] else 0
    eligible = [r for r in rows if r['eligible']]
    if len({r['sourceHash'] for r in eligible}) != len(eligible):
        raise ValueError('duplicate_sources_require_review')
    for category in CONFIG['labels'][1:]:
        if sum(r['split']=='train' and r['category']==category for r in rows) < 2:
            raise ValueError('insufficient_training_'+category)
    summary = {split: dict(Counter(r['category'] for r in rows if r['split']==split)) for split in ('train','development_holdout','unknown_challenge','excluded')}
    value = {'protocol': CONFIG, 'rows': rows, 'summary': summary, 'independentTestSamples': 0,
             'performers': len({r['performerHash'] for r in eligible}),
             'sourceGroupPolicy': 'declared rounds kept whole; coarse dates conservative clusters, not verified rounds',
             'configSha256': digest(ROOT/'shared/unified-experiment.json')}
    write(directory/'plan.json', value)
    print(json.dumps({'inventory': summary, 'performers': value['performers'], 'planSha256': digest(directory/'plan.json')}), flush=True)


def extract(directory):
    import cv2
    from sign_worker import hand_graph, classifier, predict
    from body_tracking import pose_graph
    from realtime_observation import observe_bgr
    from realtime_multi import MultiLiveRecognizer
    from need_live import NeedLiveRecognizer
    from me_live import MeLiveRecognizer
    data = json.loads((directory/'plan.json').read_text(encoding='utf8'))
    if data['configSha256'] != digest(ROOT/'shared/unified-experiment.json'):
        raise ValueError('frozen_config_changed')
    engine, inp, out = classifier()
    started = time.perf_counter()
    reports = []
    for index, item in enumerate(data['rows']):
        if item['split']=='excluded':
            continue
        if time.perf_counter()-started > CONFIG['maxWallSeconds']:
            raise TimeoutError('extraction_budget_exceeded_resume_cache')
        cache = directory/(item['sourceHash']+'.json.gz')
        if cache.exists():
            with gzip.open(cache,'rt',encoding='utf8') as f:
                report = json.load(f)
            if report['revision'] != item['revision'] or report['configSha256'] != data['configSha256']:
                raise ValueError('stale_cache')
            reports.append({k:v for k,v in report.items() if k!='rows'})
            continue
        if digest(item['path']) != item['sourceHash']:
            raise ValueError('source_changed')
        cap = cv2.VideoCapture(item['path'])
        if not cap.isOpened():
            raise ValueError('decode_failed')
        a = item['annotation']; frames = []; previous = -1.; selected = None; decoded = 0
        extraction = 0.; latencies = []; candidates = set(); events = []; conflict = False
        base = MultiLiveRecognizer(lambda seq: predict(engine,inp,out,seq), need_detector=NeedLiveRecognizer(), me_detector=MeLiveRecognizer(), continuous=True)
        begin = time.perf_counter()
        try:
            with hand_graph() as hands, pose_graph() as pose:
                while True:
                    tic = time.perf_counter()
                    ok, bgr = cap.read()
                    if not ok:
                        break
                    t = cap.get(cv2.CAP_PROP_POS_MSEC)/1000
                    if not np.isfinite(t) or t < 0 or t <= previous:
                        raise ValueError('nonmonotonic_source_pts')
                    previous = t; decoded += 1
                    if decoded > 4000 or t > 31:
                        raise ValueError('source_budget_exceeded')
                    if t < a['startSeconds']:
                        continue
                    if t > a['endSeconds']+1e-6:
                        break
                    if selected is not None and t-selected < 1/30-1e-6:
                        continue
                    h,w = bgr.shape[:2]
                    if max(h,w)>4096 or h*w>8294400:
                        raise ValueError('dimensions_exceeded')
                    scale = min(1,640/max(h,w))
                    bgr = cv2.resize(bgr,(round(w*scale),round(h*scale)))
                    obs, value, vec, payload, aspect = observe_bgr(bgr,hands,pose,1/30 if selected is None else t-selected)
                    extraction += time.perf_counter()-tic
                    tic = time.perf_counter()
                    result = base.push(t-a['startSeconds'],value,vec,aspect_ratio=aspect,me_input=payload)
                    latencies.append(time.perf_counter()-tic)
                    if result['candidate']:
                        candidates.add(result['candidate'])
                    if result['event']:
                        events.append(result['event']['text'])
                    conflict |= result['reason']=='ambiguous_actions'
                    frames.append({'t': t-a['startSeconds'], 'frame': payload['frame'].tolist()})
                    selected = t
                    if len(frames)>CONFIG['maxFrames']:
                        raise ValueError('feature_capacity')
        finally:
            cap.release()
        if len(frames)<2 or selected is None or selected<a['endSeconds']-.15:
            raise ValueError('incomplete_decode')
        report = {'sourceHash': item['sourceHash'], 'revision': item['revision'], 'configSha256': data['configSha256'],
                  'rows': frames, 'quality': quality([r['frame'] for r in frames]),
                  'baseline': {'candidates': sorted(candidates), 'events': events, 'conflict': conflict},
                  'timing': {'extractionSeconds': extraction, 'wallSeconds': time.perf_counter()-begin,
                             'baselineSeconds': sum(latencies), 'baselineFrameMs': [v*1000 for v in latencies], 'frames': len(frames)}}
        with gzip.open(cache,'wt',encoding='utf8') as f:
            json.dump(report,f,ensure_ascii=False)
        reports.append({k:v for k,v in report.items() if k!='rows'})
        write(directory/'extraction.json', reports)
        print(json.dumps({'extracted': len(reports), 'category': item['category'], 'split': item['split'],
                          'quality': report['quality'], 'seconds': round(time.perf_counter()-started,1)}), flush=True)
    write(directory/'extraction.json', reports)


def replay(directory):
    from unified_runtime import UnifiedTCN
    from unified_evaluation import evaluate
    p=json.loads((directory/'plan.json').read_text(encoding='utf8'))
    results=json.loads((directory/'results.json').read_text(encoding='utf8'))
    rows=[]
    for item in p['rows']:
        if item['split']=='excluded':
            continue
        with gzip.open(directory/(item['sourceHash']+'.json.gz'),'rt',encoding='utf8') as f:
            cache=json.load(f)
        rows.append({**item,'frames':[r['frame'] for r in cache['rows']],'times':[r['t'] for r in cache['rows']],
                     'quality':cache['quality'],'baseline':cache['baseline']})
    for result in results:
        model=UnifiedTCN(directory=directory/('seed-'+str(result['seed'])))
        for split,key in [('development_holdout','developmentHoldout'),('train','trainingReplayDiagnostic'),('unknown_challenge','unknownChallenge')]:
            result[key]=evaluate([r for r in rows if r['split']==split],model)
        result['runtimeSha256']=digest(ROOT/'server/unified_runtime.py')
        result['evaluationNumpyVersion']=np.__version__
        write(directory/('seed-'+str(result['seed']))/'result.json',result)
        print(json.dumps({'replayedSeed':result['seed'],'numpy':np.__version__}),flush=True)
    write(directory/'results.json',results)


def verify(directory):
    p=json.loads((directory/'plan.json').read_text(encoding='utf8'))
    current={r['recordId']:r for r in inventory()}
    for r in p['rows']:
        now=current.get(r['recordId'])
        if now is None or any(now[k]!=r[k] for k in ('revision','sourceHash','category','group','reviewed','complete')) or digest(r['path'])!=r['sourceHash']:
            raise ValueError('registration_or_source_changed')
    write(directory/'source-verification.json',{'verified':True,'records':len(p['rows']),
                                               'planSha256':digest(directory/'plan.json'),'originalsAndRegistrationUnchanged':True})
    print(json.dumps({'verifiedSourceAndRegistrationCount':len(p['rows'])}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage',choices=['inventory','extract','replay','verify'])
    parser.add_argument('--output',default='data/experiments/unified-2026-11-17')
    args=parser.parse_args()
    directory=(ROOT/args.output).resolve()
    if not directory.is_relative_to((ROOT/'data/experiments').resolve()):
        raise ValueError('private_output_required')
    directory.mkdir(parents=True,exist_ok=True)
    if args.stage=='inventory':
        if (directory/'plan.json').exists():
            raise ValueError('plan_exists_use_new_experiment_directory')
        plan(directory)
    elif args.stage=='extract':
        extract(directory)
    elif args.stage=='replay':
        replay(directory)
    else:
        verify(directory)
