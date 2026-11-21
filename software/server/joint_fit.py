"""Bounded CPU scratch fitting; only train/validation rows enter this process.

Improvements over the original two-layer fit:
- longer temporal receptive field (dilations 1/2/4/8);
- dropout, weight decay, input noise and time masking (training only);
- class-balanced sampling across words;
- early stopping on validation macro recall instead of validation loss;
- confidence threshold/margin selected on validation only, never on test.
"""
import sys,json,hashlib,time
from pathlib import Path
from process_lifetime import link_parent
link_parent(int(sys.argv[2]))
import numpy as np,torch
from torch import nn
from joint_model import JointTCN

directory=Path(sys.argv[1]);plan=json.loads((directory/'plan.json').read_text(encoding='utf8'))
rows=json.loads((directory/'fit-features.json').read_text(encoding='utf8'));train=[r for r in rows if r['split']=='train'];val=[r for r in rows if r['split']=='validation']
if not train or not val or any(r['split'] not in ('train','validation') for r in rows):raise ValueError('invalid_fit_splits')
classes=len(plan['labels'])+1;torch.set_num_threads(2);torch.manual_seed(plan['seed']);torch.use_deterministic_algorithms(True);np.random.seed(plan['seed'])
values=np.concatenate([np.asarray(r['frames'],np.float32) for r in train]);mean=values.mean(0);std=values.std(0).clip(.01)

def normalized(frames):
    return (np.asarray(frames,np.float32)-mean)/std

def batch(items):
    lengths=torch.tensor([len(r['frames']) for r in items]);x=torch.zeros(len(items),int(lengths.max()),178)
    for i,r in enumerate(items):x[i,:lengths[i]]=torch.tensor(normalized(r['frames']))
    return x,lengths,torch.tensor([r['label'] for r in items])

class JointNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.first=nn.Conv1d(178,32,3,padding=1)
        self.second=nn.Conv1d(32,32,3,padding=2,dilation=2)
        self.third=nn.Conv1d(32,32,3,padding=4,dilation=4)
        self.fourth=nn.Conv1d(32,32,3,padding=8,dilation=8)
        self.dropout=nn.Dropout(.3)
        self.classifier=nn.Linear(64,classes)
    def forward(self,x,lengths):
        mask=(torch.arange(x.shape[1])[None,:]<lengths[:,None])[:,None,:]
        h=x.transpose(1,2).masked_fill(~mask,0)
        for layer in (self.first,self.second,self.third,self.fourth):
            h=torch.nn.functional.gelu(layer(h)).masked_fill(~mask,0)
        pooled=torch.cat([h.sum(2)/lengths[:,None],h.masked_fill(~mask,torch.finfo(h.dtype).min).amax(2)],1)
        return self.classifier(self.dropout(pooled))

def augment(x,lengths):
    # Time masking and small feature noise; no time reversal (sign direction matters).
    x=x.clone()
    for i,n in enumerate(lengths.tolist()):
        if n>8:
            span=max(1,int(n*.1));start=int(torch.randint(0,max(1,n-span+1),(1,)).item())
            x[i,start:start+span]=0
        trim=int(n*.1)
        if trim:lengths[i]=n-torch.randint(0,trim+1,(1,)).item()
    x=x+torch.randn_like(x)*.02
    return x*torch.empty(len(x),1,1).uniform_(.98,1.02),lengths

counts=np.bincount([r['label'] for r in train],minlength=classes)
if (counts==0).any():raise ValueError('missing_train_class')
# The sampler below already balances classes. Applying inverse frequency
# again in the loss would over-weight the smallest classes a second time.
lossfn=nn.CrossEntropyLoss(label_smoothing=.05)
model=JointNet();optimizer=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=1e-3)
weights=np.asarray([1/counts[r['label']] for r in train],np.float64);weights/=weights.sum()

def predict(items):
    model.eval();out=[]
    with torch.no_grad():
        for start in range(0,len(items),16):
            part=items[start:start+16];x,l,y=batch(part);out.append(torch.softmax(model(x,l),dim=1).numpy())
    return np.concatenate(out)

def macro_recall(probabilities,items):
    if not probabilities.size:return 0.
    pred=probabilities.argmax(1);truth=np.asarray([r['label'] for r in items]);recalls=[]
    for label in range(1,classes):
        support=(truth==label).sum()
        if support:recalls.append(float((pred[truth==label]==label).mean()))
    return float(np.mean(recalls)) if recalls else 0.

started=time.monotonic();best=None;best_key=(-1.,-float('inf'));stale=0;history=[]
for epoch in range(plan['maxEpochs']):
    if time.monotonic()-started>plan['fitSeconds']:raise TimeoutError('bounded_fit_timeout')
    model.train();trainloss=0
    order=np.random.choice(len(train),size=len(train),replace=True,p=weights)
    for start in range(0,len(order),16):
        items=[train[int(i)] for i in order[start:start+16]]
        x,lengths,y=batch(items);x,lengths=augment(x,lengths)
        optimizer.zero_grad();loss=lossfn(model(x,lengths),y)
        if not torch.isfinite(loss):raise ValueError('nonfinite_loss')
        loss.backward();nn.utils.clip_grad_norm_(model.parameters(),5);optimizer.step();trainloss+=float(loss.detach())*len(items)
    probabilities=predict(val);vrecall=macro_recall(probabilities,val)
    x,l,y=batch(val)
    with torch.no_grad():vloss=float(lossfn(model(x,l),y))
    history.append({'epoch':epoch+1,'trainLoss':trainloss/len(train),'validationLoss':vloss,'validationMacroRecall':vrecall})
    key=(vrecall,-vloss)
    if key>best_key:best_key=key;best={k:v.detach().clone() for k,v in model.state_dict().items()};stale=0
    else:stale+=1
    if stale>=25:break
if best is None:raise ValueError('no_validation_improvement')
model.load_state_dict(best)

probabilities=predict(val);truth=np.asarray([r['label'] for r in val])
def sweep(threshold,margin):
    preds=[]
    for row in probabilities:
        best_index=int(row.argmax());ordered=np.sort(row)
        preds.append(best_index if best_index and ordered[-1]>=threshold and ordered[-1]-ordered[-2]>=margin else 0)
    preds=np.asarray(preds);recalls=[];fprs=[]
    for label in range(1,classes):
        support=(truth==label).sum();negative=(truth!=label).sum()
        if support:recalls.append(float((preds[truth==label]==label).mean()))
        if negative:fprs.append(float(((preds==label)&(truth!=label)).sum()/negative))
    return (float(np.mean(recalls)) if recalls else 0.,float(np.mean(fprs)) if fprs else 0.)
candidates=[]
for threshold in np.arange(.3,.96,.05):
    for margin in np.arange(0,.45,.05):
        recall,fpr=sweep(float(threshold),float(margin));candidates.append((float(threshold),float(margin),recall,fpr))
# Keep a conservative floor: a small validation set must not select a very low
# threshold/margin that looks good on validation but floods the test set.
floor=[c for c in candidates if c[0]>=.5 and c[1]>=.3]
passing=[c for c in floor if c[2]>=.9 and c[3]<=.05]
if passing:chosen=max(passing,key=lambda c:(c[1],c[0]))
else:
    safe=[c for c in floor if c[3]<=.05]
    chosen=max(safe or floor or candidates,key=lambda c:(c[2],-c[3],c[1]))
threshold,margin,validationRecall,validationFpr=chosen

arrays={k:v.detach().numpy() for k,v in model.state_dict().items() if not k.startswith('dropout')};arrays.update(mean=mean,std=std)
runtime=JointTCN(arrays=arrays,classes=classes,threshold=threshold,margin=margin)
error=0
for r in train[:4]+val[:4]:
    x,l,_=batch([r])
    with torch.no_grad():expected=torch.softmax(model(x,l),dim=1).numpy()[0]
    error=max(error,float(np.max(np.abs(expected-runtime.probabilities(r['frames'])))))
if error>1e-5:raise ValueError('export_parity')
np.savez_compressed(directory/'weights.npz',**arrays)
meta={'protocol':'joint-body178-tcn-v3','sha256':hashlib.sha256((directory/'weights.npz').read_bytes()).hexdigest(),'labels':plan['labels'],'seed':plan['seed'],'epochs':len(history),'initialization':'random','parityMaxError':error,'threshold':round(threshold,4),'margin':round(margin,4),'validation':{'macroRecall':round(validationRecall,4),'macroFalsePositiveRate':round(validationFpr,4),'chosenOn':'validation_only'},'history':history}
(directory/'model.json').write_text(json.dumps(meta,ensure_ascii=False),encoding='utf8')
print(json.dumps({'epochs':len(history),'seconds':time.monotonic()-started,'sha256':meta['sha256'],'initialization':'random','threshold':meta['threshold'],'margin':meta['margin'],'validation':meta['validation']}),flush=True)
