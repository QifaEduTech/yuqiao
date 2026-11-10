"""Isolated CPU development comparison. No export, deployment or test data."""
import hashlib,json,sys,io,base64
from pathlib import Path
import torch
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from me_training_data import CONFIG
from sign_binary_tcn import train_candidate
from me_tcn_inference import MeTCN

def batch(rows,dimensions):
    lengths=torch.tensor([len(r['frames']) for r in rows],dtype=torch.long)
    if not rows or bool((lengths<2).any()) or bool((lengths>CONFIG['maxFrames']).any()):raise ValueError('invalid_lengths')
    x=torch.zeros(len(rows),int(lengths.max()),dimensions)
    for i,r in enumerate(rows):
        v=torch.tensor(r['frames'],dtype=torch.float32)
        if v.shape!=(len(v),178) or not torch.isfinite(v).all() or r['label'] not in (0,1):raise ValueError('invalid_features')
        x[i,:len(v)]=v[:,:dimensions]
    return x,lengths,torch.tensor([r['label'] for r in rows],dtype=torch.float32)

def main():
    p=json.load(sys.stdin)
    if p.get('protocol')!=CONFIG['id']:raise ValueError('wrong_protocol')
    train=p['splits']['train'];val=p['splits']['validation'];rows=train+val
    if len(rows)>CONFIG['maxSamples'] or len({r['sourceHash'] for r in rows})!=len(rows):raise ValueError('duplicate_or_limit')
    if {r['group'] for r in train}&{r['group'] for r in val}:raise ValueError('group_leakage')
    experiments={}
    for name,dimensions in ([('handsBody178',178)] if p.get('exportBodyCandidate') else [('hands153',153),('handsBody178',178)]):
        tr=batch(train,dimensions);va=batch(val,dimensions)
        model,mean,std,history=train_candidate(*tr,*va,epochs=CONFIG['epochs'],patience=CONFIG['patience'],seed=CONFIG['seed'],learning_rate=CONFIG['learningRate'])
        evaluations={}
        for partition,samples,values in [('train',train,tr),('validation',val,va)]:
            x,lengths,y=values
            with torch.no_grad():scores=torch.sigmoid(model((x-mean)/std,lengths)).tolist()
            results=[{'sampleNumber':r['sampleNumber'],'label':r['label'],'probability':s,'prediction':int(s>=CONFIG['threshold']),'bodyEvidence':r['bodyEvidence'],'combinedPrediction':int(s>=CONFIG['threshold'] and r['bodyEvidence'])} for r,s in zip(samples,scores)]
            counts={}
            for field in ['prediction','combinedPrediction']:
                counts[field]={'tp':sum(r[field] and r['label'] for r in results),'fn':sum(not r[field] and r['label'] for r in results),'fp':sum(r[field] and not r['label'] for r in results),'tn':sum(not r[field] and not r['label'] for r in results)}
            evaluations[partition]={'counts':counts,'samples':results}
        best=float('inf');selected=None
        for h in history:
            if h['validationLoss']<best-1e-5:best=h['validationLoss'];selected=h['epoch']
        experiments[name]={'dimensions':dimensions,'epochsRun':len(history),'selectedEpoch':selected,'history':history,'evaluations':evaluations,'weightsSha256':hashlib.sha256(b''.join(v.detach().numpy().tobytes() for v in model.state_dict().values())).hexdigest(),'modelPersisted':False}
        if p.get('exportBodyCandidate'):
            arrays={k:v.detach().numpy() for k,v in model.state_dict().items()};arrays.update(mean=mean.detach().numpy(),std=std.detach().numpy())
            runtime=MeTCN(arrays);errors=[]
            for part,rr in [('train',train),('validation',val)]:
                for row,expected in zip(rr,evaluations[part]['samples']):errors.append(abs(runtime.probability(row['frames'])-expected['probability']))
            if max(errors)>1e-5:raise ValueError('numpy_parity_failed')
            stream=io.BytesIO();np.savez_compressed(stream,**arrays)
            experiments[name]['checkpointBase64']=base64.b64encode(stream.getvalue()).decode('ascii');experiments[name]['numpyParityMaxError']=max(errors)
    print(json.dumps({'trainingStarted':True,'scope':'development_comparison_not_independent_accuracy','experiments':experiments,'productionChanged':False,'modelPersisted':False,'independentAccuracy':None}))

if __name__=='__main__':main()
