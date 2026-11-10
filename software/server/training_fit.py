"""CPU training child: EOF on its parent-owned pipe cancels even if parent is killed."""
import sys,os,json,hashlib
from pathlib import Path
from process_lifetime import link_parent
link_parent(int(sys.argv[2]))
import numpy as np
import torch
from sign_binary_tcn import train_candidate
from me_tcn_inference import MeTCN
plan=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'));directory=Path(plan['output']);data=json.loads((directory/'features.json').read_text(encoding='utf-8'))
def batch(rows):
    lengths=torch.tensor([len(r['frames']) for r in rows],dtype=torch.long);x=torch.zeros(len(rows),int(lengths.max()),178)
    for i,r in enumerate(rows):x[i,:lengths[i]]=torch.tensor(r['frames'])
    return x,lengths,torch.tensor([r['label'] for r in rows],dtype=torch.float32)
tr=[r for r in data if r['split']=='train'];va=[r for r in data if r['split']=='validation']
model,mean,std,history=train_candidate(*batch(tr),*batch(va),epochs=80,patience=12)
arrays={k:v.detach().numpy() for k,v in model.state_dict().items()};arrays.update(mean=mean.numpy(),std=std.numpy());runtime=MeTCN(arrays=arrays)
for rows in [tr,va]:
    x,l,y=batch(rows)
    with torch.no_grad():expected=torch.sigmoid(model((x-mean)/std,l)).tolist()
    if max(abs(runtime.probability(r['frames'])-s) for r,s in zip(rows,expected))>1e-5:raise ValueError('Export parity failed')
np.savez_compressed(directory/'weights.npz',**arrays)
meta={'protocol':'self-service-body178-v1','sha256':hashlib.sha256((directory/'weights.npz').read_bytes()).hexdigest(),'threshold':.90,**plan['action'],'epochs':len(history),'history':history}
(directory/'model.json').write_text(json.dumps(meta,ensure_ascii=False),encoding='utf-8')
print(json.dumps({'trained':True,'epochs':len(history)}),flush=True)
os._exit(0)
