"""Bounded CPU scratch fitting; only train/validation rows enter this process."""
import sys,json,hashlib,time
from pathlib import Path
from process_lifetime import link_parent
link_parent(int(sys.argv[2]))
import numpy as np,torch
from torch import nn
from sign_binary_tcn import BinaryTCN
from joint_model import JointTCN

directory=Path(sys.argv[1]);plan=json.loads((directory/'plan.json').read_text(encoding='utf8'))
rows=json.loads((directory/'fit-features.json').read_text(encoding='utf8'));train=[r for r in rows if r['split']=='train'];val=[r for r in rows if r['split']=='validation']
if not train or not val or any(r['split'] not in ('train','validation') for r in rows):raise ValueError('invalid_fit_splits')
classes=len(plan['labels'])+1;torch.set_num_threads(2);torch.manual_seed(plan['seed']);torch.use_deterministic_algorithms(True)
values=np.concatenate([np.asarray(r['frames'],np.float32) for r in train]);mean=values.mean(0);std=values.std(0).clip(.01)
def batch(items):
    lengths=torch.tensor([len(r['frames']) for r in items]);x=torch.zeros(len(items),int(lengths.max()),178)
    for i,r in enumerate(items):x[i,:lengths[i]]=torch.tensor((np.asarray(r['frames'],np.float32)-mean)/std)
    return x,lengths,torch.tensor([r['label'] for r in items])
model=BinaryTCN(178);model.classifier=nn.Linear(64,classes)
counts=np.bincount([r['label'] for r in train],minlength=classes)
if (counts==0).any():raise ValueError('missing_train_class')
lossfn=nn.CrossEntropyLoss(weight=torch.tensor(len(train)/(classes*counts),dtype=torch.float32));optimizer=torch.optim.Adam(model.parameters(),lr=.001)
started=time.monotonic();best=None;bestloss=float('inf');stale=0;history=[]
for epoch in range(plan['maxEpochs']):
    if time.monotonic()-started>plan['fitSeconds']:raise TimeoutError('bounded_fit_timeout')
    model.train();trainloss=0
    for indices in torch.randperm(len(train)).split(16):
        x,lengths,y=batch([train[int(i)] for i in indices]);optimizer.zero_grad();loss=lossfn(model(x,lengths),y)
        if not torch.isfinite(loss):raise ValueError('nonfinite_loss')
        loss.backward();nn.utils.clip_grad_norm_(model.parameters(),5);optimizer.step();trainloss+=float(loss.detach())*len(indices)
    model.eval();vloss=0
    with torch.no_grad():
        for start in range(0,len(val),16):
            items=val[start:start+16];x,l,y=batch(items);vloss+=float(lossfn(model(x,l),y))*len(items)
    vloss/=len(val);history.append({'epoch':epoch+1,'trainLoss':trainloss/len(train),'validationLoss':vloss})
    if vloss<bestloss-1e-5:bestloss=vloss;best={k:v.detach().clone() for k,v in model.state_dict().items()};stale=0
    else:stale+=1
    if stale>=20:break
model.load_state_dict(best);arrays={k:v.detach().numpy() for k,v in model.state_dict().items()};arrays.update(mean=mean,std=std)
runtime=JointTCN(arrays=arrays,classes=classes);error=0
for r in train[:4]+val[:4]:
    x,l,_=batch([r])
    with torch.no_grad():expected=torch.softmax(model(x,l),dim=1).numpy()[0]
    error=max(error,float(np.max(np.abs(expected-runtime.probabilities(r['frames'])))))
if error>1e-5:raise ValueError('export_parity')
np.savez_compressed(directory/'weights.npz',**arrays)
meta={'protocol':'joint-body178-tcn-v2','sha256':hashlib.sha256((directory/'weights.npz').read_bytes()).hexdigest(),'labels':plan['labels'],'seed':plan['seed'],'epochs':len(history),'initialization':'random','parityMaxError':error,'history':history}
(directory/'model.json').write_text(json.dumps(meta,ensure_ascii=False),encoding='utf8')
print(json.dumps({'epochs':len(history),'seconds':time.monotonic()-started,'sha256':meta['sha256'],'initialization':'random'}),flush=True)
