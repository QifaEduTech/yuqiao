"""CPU-only isolated train/evaluate worker. Data/model stay in process memory."""
import hashlib
import json
import re
from pathlib import Path
import sys
import numpy as np
import torch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from sign_binary_tcn import train_candidate

def batch(rows):
    if not rows:raise ValueError('empty_split')
    lengths=torch.tensor([len(row['frames']) for row in rows],dtype=torch.long)
    maximum=int(lengths.max());dimensions=len(rows[0]['frames'][0])
    x=torch.zeros((len(rows),maximum,dimensions),dtype=torch.float32)
    for i,row in enumerate(rows):
        values=torch.tensor(row['frames'],dtype=torch.float32)
        if values.ndim!=2 or values.shape[1]!=153 or not 1<=len(values)<=384 or not torch.isfinite(values).all():raise ValueError('invalid_features')
        x[i,:len(values)]=values
    return x,lengths,torch.tensor([row['label'] for row in rows],dtype=torch.float32)

payload=json.load(sys.stdin)
if payload.get('featureProtocol')!='hands-local-absolute-motion-153-v1':raise ValueError('wrong_feature_protocol')
if not isinstance(payload.get('epochs'),int) or not 1<=payload['epochs']<=500 or not isinstance(payload.get('patience'),int) or not 1<=payload['patience']<=500:raise ValueError('invalid_training_budget')
splits=payload['splits']
group_sets=[set(row['group'] for row in splits[name]) for name in ['train','validation','test']]
if any(group_sets[i]&group_sets[j] for i in range(3) for j in range(i+1,3)):raise ValueError('capture_group_leakage')
seen=set()
for name in ['train','validation','test']:
    for row in splits[name]:
        if row['sourceHash'] in seen:raise ValueError('duplicate_source')
        seen.add(row['sourceHash'])
train=batch(splits['train']);validation=batch(splits['validation'])
model,mean,std,history=train_candidate(*train,*validation,epochs=payload['epochs'],patience=payload['patience'],seed=payload['seed'],learning_rate=payload.get('learningRate',.001))
def evaluate(rows):
    x,lengths,labels=batch(rows)
    with torch.no_grad():probabilities=torch.sigmoid(model((x-mean)/std,lengths)).tolist()
    predicted=[int(p>=.5) for p in probabilities];truth=[int(x) for x in labels.tolist()]
    samples=[]
    for row,p,y,guess in zip(rows,probabilities,truth,predicted):
        number=row.get('sampleNumber')
        if number is not None and not re.fullmatch(r'(26|27|28|29)\.[1-9][0-9]*',number):raise ValueError('invalid_sample_number')
        values=np.asarray(row['frames'])
        samples.append({'sampleNumber':number,'label':y,'prediction':guess,'thanksProbability':p,
                        'frames':len(values),'handFrames':int(((values[:,74]>0)|(values[:,150]>0)).sum())})
    return {'samples':samples,'truePositive':sum(p==y==1 for p,y in zip(predicted,truth)),
            'falsePositive':sum(p==1 and y==0 for p,y in zip(predicted,truth)),
            'falseNegative':sum(p==0 and y==1 for p,y in zip(predicted,truth)),
            'trueNegative':sum(p==y==0 for p,y in zip(predicted,truth))}
# Reporting happens only after selection. No score feeds back into fitting.
evaluations={name:evaluate(splits[name]) for name in ['train','validation','test']}
test=evaluations['test'];selected=None;best_loss=float('inf')
for entry in history:
    if entry['validationLoss']<best_loss-1e-5:best_loss=entry['validationLoss'];selected=entry['epoch']
weights=hashlib.sha256(b''.join(t.detach().numpy().tobytes() for t in model.state_dict().values())).hexdigest()
print(json.dumps({'trainingStarted':True,'modelPersisted':False,'productionChanged':False,'featureProtocol':payload['featureProtocol'],
                  'epochsRun':len(history),'initialTrainLoss':history[0]['trainLoss'],'finalTrainLoss':history[-1]['trainLoss'],
                  'testTruePositive':test['truePositive'],'testFalsePositive':test['falsePositive'],
                  'testFalseNegative':test['falseNegative'],'testTrueNegative':test['trueNegative'],
                  'testSamples':len(test['samples']),'weightsSha256':weights,'threshold':.5,
                  'selectedEpoch':selected,'bestValidationLoss':best_loss,'history':history,'evaluations':evaluations},ensure_ascii=True))
