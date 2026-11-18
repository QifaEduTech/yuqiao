"""Bounded CPU fit, export and paired development evaluation. Never activates models."""
import argparse
from collections import Counter
import copy
import ctypes
import gzip
import hashlib
import json
import os
from pathlib import Path
import sys
import time

PROCESS_STARTED=time.perf_counter()

os.environ.setdefault('OMP_NUM_THREADS','2')
os.environ.setdefault('MKL_NUM_THREADS','2')
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
import numpy as np
import torch
from torch import nn
from sign_binary_tcn import BinaryTCN
from unified_runtime import CONFIG, UnifiedTCN
from unified_evaluation import evaluate


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path,value):
    Path(path).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')


def peak_memory():
    class Counters(ctypes.Structure):
        _fields_=[('cb',ctypes.c_ulong),('PageFaultCount',ctypes.c_ulong)]+[(k,ctypes.c_size_t) for k in ('PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage','QuotaPagedPoolUsage','QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage','PeakPagefileUsage')]
    c=Counters(); c.cb=ctypes.sizeof(c)
    kernel=ctypes.WinDLL('kernel32'); kernel.GetCurrentProcess.restype=ctypes.c_void_p
    api=ctypes.WinDLL('psapi').GetProcessMemoryInfo
    api.argtypes=[ctypes.c_void_p,ctypes.POINTER(Counters),ctypes.c_ulong]
    return c.PeakWorkingSetSize if api(kernel.GetCurrentProcess(),ctypes.byref(c),c.cb) else None


class MultiTCN(BinaryTCN):
    def __init__(self):
        super().__init__(178)
        self.classifier=nn.Linear(64,5)


def batch(rows):
    lengths=torch.tensor([len(r['frames']) for r in rows])
    x=torch.zeros(len(rows),int(lengths.max()),178)
    for i,r in enumerate(rows):
        x[i,:lengths[i]]=torch.tensor(r['frames'])
    return x,lengths,torch.tensor([r['label'] for r in rows])


def fit(rows,seed,epochs,binary=None):
    fit_started=time.perf_counter()
    torch.manual_seed(seed)
    torch.set_num_threads(CONFIG['threads'])
    torch.use_deterministic_algorithms(True)
    x,lengths,y=batch(rows)
    values=x[torch.arange(x.shape[1])[None,:]<lengths[:,None]]
    mean=values.mean(0); std=values.std(0,unbiased=False).clamp_min(.01)
    x=(x-mean)/std
    model=MultiTCN() if binary is None else BinaryTCN(178)
    optimizer=torch.optim.Adam(model.parameters(),lr=CONFIG['learningRate'])
    if binary is None:
        counts=torch.bincount(y,minlength=5)
        if bool((counts==0).any()):
            raise ValueError('missing_training_class')
        criterion=nn.CrossEntropyLoss(weight=len(rows)/(5*counts.float()))
    else:
        y=(y==binary).float()
        criterion=nn.BCEWithLogitsLoss(pos_weight=(y==0).sum()/(y==1).sum())
    started=time.perf_counter(); history=[]
    for epoch in range(epochs):
        if time.perf_counter()-PROCESS_STARTED>CONFIG['maxWallSeconds']:
            raise TimeoutError('training_budget_exceeded')
        model.train();optimizer.zero_grad()
        loss=criterion(model(x,lengths),y)
        if not torch.isfinite(loss):
            raise ValueError('nonfinite_loss')
        loss.backward();nn.utils.clip_grad_norm_(model.parameters(),5);optimizer.step()
        history.append(float(loss.detach()))
    elapsed=time.perf_counter()-started
    model.eval()
    arrays={k:v.detach().numpy() for k,v in model.state_dict().items()}
    arrays.update(mean=mean.numpy(),std=std.numpy())
    return model,arrays,{'seconds':elapsed,'epochs':epochs,'samples':len(rows),'samplePresentations':len(rows)*epochs,
                        'samplePresentationsPerSecond':len(rows)*epochs/elapsed,'loss':history,
                        'fitIncludingSetupSeconds':time.perf_counter()-fit_started,
                        'processPeakRssBytes':peak_memory(),'gpuPeakBytes':None,'device':'cpu','threads':CONFIG['threads']}




def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',default='data/experiments/unified-2026-11-17')
    parser.add_argument('--smoke',action='store_true')
    parser.add_argument('--matched-binary',action='store_true')
    parser.add_argument('--benchmark-only',action='store_true',help='Repeat bounded fits for setup-inclusive timing; original exports remain unchanged')
    parser.add_argument('--evaluate-only',action='store_true',help='Replay frozen exported weights after a runtime correctness fix; never refit or choose a seed')
    args=parser.parse_args();directory=(ROOT/args.output).resolve()
    if not directory.is_relative_to((ROOT/'data/experiments').resolve()):
        raise ValueError('private_output_required')
    plan=json.loads((directory/'plan.json').read_text(encoding='utf8'))
    if digest(ROOT/'shared/unified-experiment.json')!=plan['configSha256']:
        raise ValueError('frozen_config_changed')
    rows=[]
    for item in plan['rows']:
        if item['split']=='excluded':
            continue
        with gzip.open(directory/(item['sourceHash']+'.json.gz'),'rt',encoding='utf8') as f:
            cache=json.load(f)
        if cache['revision']!=item['revision'] or cache['configSha256']!=plan['configSha256']:
            raise ValueError('stale_cache')
        rows.append({**item,'frames':[r['frame'] for r in cache['rows']],'times':[r['t'] for r in cache['rows']],
                     'quality':cache['quality'],'baseline':cache['baseline'],'timing':cache['timing']})
    train=[r for r in rows if r['split']=='train' and (not r['label'] or r['quality']['passed'])]
    held=[r for r in rows if r['split']=='development_holdout']
    if {r['group'] for r in train}&{r['group'] for r in held} or {r['sourceHash'] for r in train}&{r['sourceHash'] for r in held}:
        raise ValueError('split_leakage')
    print(json.dumps({'trainingCounts':dict(Counter(r['category'] for r in train)),
                      'qualityExcludedTrain':sum(r['split']=='train' and r['label']>0 and not r['quality']['passed'] for r in rows),
                      'holdoutCount':len(held),'smoke':args.smoke}),flush=True)
    results=[];seeds=CONFIG['seeds'][:1] if args.smoke else CONFIG['seeds'];epochs=2 if args.smoke else CONFIG['epochs']
    if args.benchmark_only:
        fit(train,CONFIG['seeds'][0],2)
        for i,seed in enumerate(seeds):
            timings={}
            for kind in (['multi','binary'] if i%2==0 else ['binary','multi']):
                if kind=='multi':
                    _,arrays,timing=fit(train,seed,epochs)
                    with np.load(directory/('seed-'+str(seed))/'weights.npz',allow_pickle=False) as old:
                        if not all(np.array_equal(arrays[k],old[k]) for k in arrays):
                            raise ValueError('deterministic_repeat_mismatch')
                    timings['B']=timing
                else:
                    timings['matchedBinary']=[fit(train,seed,epochs,binary=k)[2] for k in range(1,5)]
            results.append({'seed':seed,**timings})
        write(directory/'efficiency-repeat.json',{'results':results,'processWallSeconds':time.perf_counter()-PROCESS_STARTED,
                                                 'warmupEpochs':2,'alternatingOrder':True,'exportArraysExactlyReproduced':True})
        print(json.dumps({'efficiencyRepeatComplete':True,'processSeconds':time.perf_counter()-PROCESS_STARTED}),flush=True)
        return
    for seed in seeds:
        destination=directory/('smoke' if args.smoke else 'seed-'+str(seed))
        destination.mkdir(exist_ok=True)
        if args.evaluate_only:
            result=json.loads((destination/'result.json').read_text(encoding='utf8'))
            runtime=UnifiedTCN(directory=destination)
            result['developmentHoldout']=evaluate(held,runtime)
            result['trainingReplayDiagnostic']=evaluate([r for r in rows if r['split']=='train'],runtime)
            result['unknownChallenge']=evaluate([r for r in rows if r['split']=='unknown_challenge'],runtime)
            result['runtimeSha256']=digest(ROOT/'server/unified_runtime.py')
            write(destination/'result.json',result);results.append(result)
            print(json.dumps({'replayedFrozenSeed':seed}),flush=True)
            continue
        model,arrays,timing=fit(train,seed,epochs)
        runtime=UnifiedTCN(arrays=arrays);max_error=0.
        for r in train+held:
            x,l,_=batch([r])
            with torch.no_grad():
                expected=torch.softmax(model((x-torch.tensor(arrays['mean']))/torch.tensor(arrays['std']),l),dim=1).numpy()[0]
            max_error=max(max_error,float(np.max(np.abs(expected-runtime.probabilities(r['frames'])))))
        if max_error>1e-5:
            raise ValueError('numpy_export_parity_failed')
        np.savez_compressed(destination/'weights.npz',**arrays)
        meta={'protocol':CONFIG['id'],'sha256':digest(destination/'weights.npz'),'seed':seed,'epochs':epochs,
              'planSha256':digest(directory/'plan.json'),'productionEligible':False,'numpyParityMaxError':max_error}
        write(destination/'model.json',meta)
        result={'seed':seed,'model':meta,'modelBytes':(destination/'weights.npz').stat().st_size,'training':timing}
        if not args.smoke:
            result['developmentHoldout']=evaluate(held,runtime)
            result['trainingReplayDiagnostic']=evaluate([r for r in rows if r['split']=='train'],runtime)
            result['unknownChallenge']=evaluate([r for r in rows if r['split']=='unknown_challenge'],runtime)
        if args.matched_binary:
            binary=[]
            for label in range(1,5):
                _,binary_arrays,binary_time=fit(train,seed,epochs,binary=label)
                np.savez_compressed(destination/('binary-'+str(label)+'.npz'),**binary_arrays)
                binary.append({'label':label,'training':binary_time,'modelBytes':(destination/('binary-'+str(label)+'.npz')).stat().st_size})
            result['matchedBinaryTrainingControl']={'models':binary,'totalSeconds':sum(x['training']['seconds'] for x in binary),
                                                   'totalBytes':sum(x['modelBytes'] for x in binary),
                                                   'scope':'4 retrained binary TCNs on identical 178D data; not historical deployed A training time'}
        write(destination/'result.json',result);results.append(result)
        print(json.dumps({'seed':seed,'trainingSeconds':timing['seconds'],'exportParity':max_error,
                          'holdout':result.get('developmentHoldout',{}).get('B',{}).get('macroTargets')}),flush=True)
    write(directory/('smoke-result.json' if args.smoke else 'results.json'),results)


if __name__=='__main__':
    main()
