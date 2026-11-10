"""Small trainable candidate. Imported only by an isolated PyTorch runtime."""
import copy
import numpy as np
import torch
from torch import nn

class BinaryTCN(nn.Module):
    def __init__(self,dimensions=153):
        super().__init__()
        self.first=nn.Conv1d(dimensions,32,3,padding=1)
        self.second=nn.Conv1d(32,32,3,padding=2,dilation=2)
        self.classifier=nn.Linear(64,1)
    def forward(self,x,lengths):
        if x.ndim!=3 or lengths.ndim!=1 or len(lengths)!=len(x) or bool((lengths<1).any()) or bool((lengths>x.shape[1]).any()):raise ValueError('invalid_sequence_shape')
        mask=(torch.arange(x.shape[1],device=x.device)[None,:]<lengths[:,None])[:,None,:]
        h=x.transpose(1,2).masked_fill(~mask,0)
        h=torch.nn.functional.gelu(self.first(h)).masked_fill(~mask,0)
        h=torch.nn.functional.gelu(self.second(h)).masked_fill(~mask,0)
        mean=h.sum(2)/lengths[:,None]
        maximum=h.masked_fill(~mask,torch.finfo(h.dtype).min).amax(2)
        return self.classifier(torch.cat([mean,maximum],1)).squeeze(1)

def train_candidate(train_x,train_lengths,train_y,val_x,val_lengths,val_y,epochs=120,patience=15,seed=20261016,learning_rate=.001):
    """Training/selection receives no test tensors. Caller must check group split."""
    torch.manual_seed(seed);torch.set_num_threads(2)
    if set(train_y.tolist())!={0.,1.} or set(val_y.tolist())!={0.,1.}:raise ValueError('both_classes_required')
    mask=torch.arange(train_x.shape[1])[None,:]<train_lengths[:,None]
    values=train_x[mask];mean=values.mean(0);std=values.std(0,unbiased=False).clamp_min(.01)
    train_x=(train_x-mean)/std;val_x=(val_x-mean)/std
    model=BinaryTCN(train_x.shape[-1]);optimizer=torch.optim.Adam(model.parameters(),lr=learning_rate)
    criterion=nn.BCEWithLogitsLoss(pos_weight=(train_y==0).sum()/(train_y==1).sum())
    best=None;best_loss=float('inf');stale=0;history=[]
    for epoch in range(epochs):
        model.train();optimizer.zero_grad();loss=criterion(model(train_x,train_lengths),train_y);loss.backward();nn.utils.clip_grad_norm_(model.parameters(),5);optimizer.step()
        model.eval()
        with torch.no_grad():validation=float(criterion(model(val_x,val_lengths),val_y))
        history.append({'epoch':epoch+1,'trainLoss':float(loss.detach()),'validationLoss':validation})
        if not np.isfinite(validation):raise ValueError('nonfinite_training')
        if validation<best_loss-1e-5:best_loss=validation;best=copy.deepcopy(model.state_dict());stale=0
        else:stale+=1
        if stale>=patience:break
    model.load_state_dict(best)
    return model,mean,std,history
