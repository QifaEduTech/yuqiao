"""One predeclared scratch round; immutable source caches, no checkpoint loading.

Temporal views only drop existing frames and recalculate the actual time feature.
No invented joints/end frames, heldout tuning or automatic activation.
"""
import json,gzip,hashlib,sys,time,importlib.util
from pathlib import Path
from collections import Counter
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from unified_runtime import UnifiedTCN,CONFIG,quality,metrics
from unified_evaluation import evaluate

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,v):Path(p).write_text(json.dumps(v,ensure_ascii=False,indent=2),encoding='utf8')

def temporal_view(row,fps):
    times=row['times'];indices=[];last=None
    for i,t in enumerate(times):
        if last is None or t-last>=1/fps-1e-6:indices.append(i);last=t
    x=np.asarray(row['frames'],np.float32)[indices].copy();t=[times[i] for i in indices]
    if len(x)<CONFIG['minHandFrames']:return None
    for i in range(1,len(x)):x[i,152]=min(t[i]-t[i-1],1)*30
    return {**row,'times':t,'frames':x.tolist(),'quality':quality(x),'viewIndices':indices}

def main():
    started=time.perf_counter();d=ROOT/'data/experiments/unified-scratch-2026-11-17-r1';source=ROOT/'data/experiments/unified-2026-11-17'
    plan=json.loads((d/'plan.json').read_text(encoding='utf8'));old=json.loads((source/'plan.json').read_text(encoding='utf8'))
    if sha(d/'plan.json')!=sha(source/'plan.json'):raise ValueError('inventory_changed_reextract_required')
    if (d/'scratch-result.json').exists():raise ValueError('round_already_completed_do_not_overwrite')
    recipe={'id':'unified-scratch-r1','seed':2026111701,'epochs':200,'initialization':'random_only_no_load_state_dict','warmStart':None,'temporalViewsFps':[15,10,6], 'maxTrainingRows':256,'maxWallSeconds':180,'testSelection':'fixed recipe before evaluation; no seed/epoch/threshold selection on heldout','dataScope':'existing four labelled classes plus background; other actions pending data','sourcePlanSha256':sha(d/'plan.json'),'threshold':CONFIG['threshold'],'margin':CONFIG['margin']}
    rp=d/'scratch-recipe.json'
    if rp.exists() and json.loads(rp.read_text(encoding='utf8'))!=recipe:raise ValueError('recipe_changed')
    write(rp,recipe)
    rows=[];source_hashes={}
    for item in plan['rows']:
        if item['split']=='excluded':continue
        path=source/(item['sourceHash']+'.json.gz');source_hashes[path.name]=sha(path)
        with gzip.open(path,'rt',encoding='utf8') as f:c=json.load(f)
        if c['revision']!=item['revision'] or c['configSha256']!=plan['configSha256']:raise ValueError('stale_cache')
        rows.append({**item,'frames':[r['frame'] for r in c['rows']],'times':[r['t'] for r in c['rows']],'quality':c['quality'],'baseline':c['baseline']})
    train=[r for r in rows if r['split']=='train' and (not r['label'] or r['quality']['passed'])];held=[r for r in rows if r['split']=='development_holdout']
    if {r['group'] for r in train}&{r['group'] for r in held}:raise ValueError('group_leakage')
    augmented=[]
    for row in train:
        augmented.append(row);seen={tuple(range(len(row['frames'])))}
        for fps in recipe['temporalViewsFps']:
            view=temporal_view(row,fps)
            if view is None or tuple(view['viewIndices']) in seen or row['label'] and not view['quality']['passed']:continue
            seen.add(tuple(view['viewIndices']));augmented.append(view)
    if len(augmented)>recipe['maxTrainingRows']:raise ValueError('training_budget')
    print(json.dumps({'trainingSources':len(train),'trainingViews':len(augmented),'heldout':len(held),'seed':recipe['seed'],'epochs':recipe['epochs'],'warmStart':None}),flush=True)
    spec=importlib.util.spec_from_file_location('scratch_fit',ROOT/'scripts/unified-experiment-fit.py');fit=importlib.util.module_from_spec(spec);spec.loader.exec_module(fit)
    fit.CONFIG={**fit.CONFIG,'maxWallSeconds':recipe['maxWallSeconds']}
    model,arrays,timing=fit.fit(augmented,recipe['seed'],recipe['epochs'])
    runtime=UnifiedTCN(arrays=arrays);parity=0.
    for row in train+held:
        x,lengths,_=fit.batch([row])
        with fit.torch.no_grad():expected=fit.torch.softmax(model((x-fit.torch.tensor(arrays['mean']))/fit.torch.tensor(arrays['std']),lengths),dim=1).numpy()[0]
        parity=max(parity,float(np.max(np.abs(expected-runtime.probabilities(row['frames'])))))
    if parity>1e-5:raise ValueError('export_parity')
    target=d/'model';target.mkdir(exist_ok=True)
    np.savez_compressed(target/'weights.npz',**arrays)
    write(target/'model.json',{'protocol':CONFIG['id'],'sha256':sha(target/'weights.npz'),'seed':recipe['seed'],'epochs':recipe['epochs'],'planSha256':sha(d/'plan.json'),'productionEligible':False,'numpyParityMaxError':parity,'initialization':'random','recipeSha256':sha(rp)})
    # Evaluate only after fixed training; old-model comparison is read-only.
    deployed=UnifiedTCN(ROOT/'models/unified-sign/v1')
    comparisons={}
    for name,items in [('original',held),('10fps',[v for r in held if (v:=temporal_view(r,10)) is not None])]:
        if not items:continue
        before=evaluate(items,deployed);after=evaluate(items,runtime)
        comparisons[name]={'samples':len(items),'previous':before['B']['macroTargets'],'scratch':after['B']['macroTargets'],'previousEvents':before['events']['B'],'scratchEvents':after['events']['B']}
    result={'recipe':recipe,'trainingSources':len(train),'trainingCounts':dict(Counter(r['category'] for r in train)),'trainingViews':len(augmented),'heldoutCount':len(held),'independentTestSamples':0,'timing':{k:v for k,v in timing.items() if k!='loss'},'history':timing['loss'],'exportParity':parity,'comparisons':comparisons,'activation':'not_activated_pending_live_diagnosis','weightsSha256':sha(target/'weights.npz'),'sourceCacheHashes':source_hashes,'totalSeconds':time.perf_counter()-started}
    write(d/'scratch-result.json',result)
    for name,digest in source_hashes.items():
        if sha(source/name)!=digest:raise ValueError('source_cache_changed')
    print(json.dumps({k:result[k] for k in ['trainingSources','trainingViews','timing','exportParity','comparisons','activation','totalSeconds']},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
