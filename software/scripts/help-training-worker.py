"""CPU supervised video-feature experiment; no model deployment or raw export."""
import hashlib,json,sys,io,base64
from pathlib import Path
import torch
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from sign_binary_tcn import train_candidate
from help_training_data import CONFIG
from need_training_data import CONFIG as NEED_CONFIG
NEED_DIRECTIONAL_CONFIG=json.loads((Path(__file__).resolve().parents[1]/'shared/need-directional-training.json').read_text(encoding='utf8'))
from help_tcn_inference import HelpTCN
from need_tcn_inference import NeedTCN

def batch(rows):
    if not rows:raise ValueError('empty_partition')
    lengths=torch.tensor([len(row['frames']) for row in rows],dtype=torch.long)
    dimensions=CONFIG.get('dimensions',153)
    x=torch.zeros((len(rows),int(lengths.max()),dimensions))
    for i,row in enumerate(rows):
        v=torch.tensor(row['frames'],dtype=torch.float32)
        if v.ndim!=2 or v.shape[1]!=dimensions or not 2<=len(v)<=CONFIG['maxFrames'] or not torch.isfinite(v).all():raise ValueError('invalid_features')
        if row['label'] not in [0,1]:raise ValueError('invalid_label')
        x[i,:len(v)]=v
    return x,lengths,torch.tensor([r['label'] for r in rows],dtype=torch.float32)

def main():
    global CONFIG
    payload=json.load(sys.stdin)
    if payload.get('protocol') in (NEED_CONFIG['id'],NEED_DIRECTIONAL_CONFIG['id']):
        CONFIG=NEED_CONFIG if payload['protocol']==NEED_CONFIG['id'] else NEED_DIRECTIONAL_CONFIG
        if payload.get('exportModel'):raise ValueError('need_export_not_authorized_by_protocol')
    if payload.get('protocol')!=CONFIG['id']:raise ValueError('wrong_protocol')
    probability_field='needProbability' if CONFIG['target']=='csl.ref.bmcx.1874' else 'helpProbability'
    train_rows=payload['splits']['train'];validation_rows=payload['splits']['validation']
    if {r['group'] for r in train_rows}&{r['group'] for r in validation_rows}:raise ValueError('group_leakage')
    all_rows=train_rows+validation_rows
    if len(all_rows)>CONFIG['maxSamples'] or len({r['sourceHash'] for r in all_rows})!=len(all_rows):raise ValueError('duplicate_source_or_limit')
    train=batch(train_rows);validation=batch(validation_rows);augmentation=[]
    if payload.get('stationaryTrainingNegatives'):
        if CONFIG['id']!=NEED_DIRECTIONAL_CONFIG['id']:raise ValueError('augmentation_protocol_mismatch')
        for r in train_rows:
            if r['label']==1:
                for frames in r.get('stationaryVariants',[]):augmentation.append({**r,'label':0,'frames':frames})
        if not augmentation or len(train_rows)+len(augmentation)>CONFIG['maxSamples']:raise ValueError('invalid_augmentation_count')
    fit=batch(train_rows+augmentation) if augmentation else train
    model,mean,std,history=train_candidate(*fit,*validation,epochs=CONFIG['epochs'],patience=CONFIG['patience'],seed=CONFIG['seed'],learning_rate=CONFIG['learningRate'])
    best=float('inf');selected=None
    for h in history:
        if h['validationLoss']<best-1e-5:best=h['validationLoss'];selected=h['epoch']
    evaluations={}
    for name,rows,data in [('train',train_rows,train),('validation',validation_rows,validation)]:
        x,lengths,labels=data
        with torch.no_grad():probs=torch.sigmoid(model((x-mean)/std,lengths)).tolist()
        predictions=[p>=CONFIG['threshold'] for p in probs];truth=[bool(r['label']) for r in rows]
        evaluations[name]={'tp':sum(p and y for p,y in zip(predictions,truth)),'fn':sum(not p and y for p,y in zip(predictions,truth)),
                           'fp':sum(p and not y for p,y in zip(predictions,truth)),'tn':sum(not p and not y for p,y in zip(predictions,truth)),
                           'samples':[{'sampleNumber':r['sampleNumber'],'label':r['label'],'prediction':int(p),probability_field:score} for r,p,score in zip(rows,predictions,probs)]}
    digest=hashlib.sha256(b''.join(t.detach().numpy().tobytes() for t in model.state_dict().values())).hexdigest()
    report={'trainingStarted':True,'scope':'development_only_no_independent_test','epochsRun':len(history),'selectedEpoch':selected,'initialTrainLoss':history[0]['trainLoss'],'finalTrainLoss':history[-1]['trainLoss'],
                      'bestValidationLoss':best,'history':history,'evaluations':evaluations,'weightsSha256':digest,'threshold':CONFIG['threshold'],'modelPersisted':False,'productionChanged':False}
    if CONFIG['target']=='csl.ref.bmcx.1874':
        report['trainingComposition']={'realSources':len(train_rows),'syntheticStationaryVariants':len(augmentation),'derivation':'training_partition_only','rawEvaluationCountsExcludeSynthetic':True}
        frozen=[{**r,'frames':r['frozenFrames']} for r in all_rows if 'frozenFrames' in r]
        if frozen:
            x,lengths,_=batch(frozen)
            with torch.no_grad():scores=torch.sigmoid(model((x-mean)/std,lengths)).tolist()
            report['frozenStress']={'scope':'synthetic_stationary_features_not_training_or_independent_test','samples':[{'sampleNumber':r['sampleNumber'],'score':score,'triggered':score>=CONFIG['threshold']} for r,score in zip(frozen,scores)]}
    if payload.get('exportNeedCandidate'):
        if CONFIG['id']!=NEED_DIRECTIONAL_CONFIG['id'] or augmentation:raise ValueError('need_candidate_protocol_mismatch')
        arrays={k:v.detach().numpy() for k,v in model.state_dict().items()};arrays.update(mean=mean.detach().numpy(),std=std.detach().numpy());runtime=NeedTCN(arrays);errors=[]
        for name,rows in [('train',train_rows),('validation',validation_rows)]:
            for row,expected in zip(rows,evaluations[name]['samples']):errors.append(abs(runtime.probability(row['frames'])-expected['needProbability']))
        if max(errors)>1e-5:raise ValueError('need_numpy_parity_failed')
        buffer=io.BytesIO();np.savez_compressed(buffer,**arrays);report['needCheckpointBase64']=base64.b64encode(buffer.getvalue()).decode();report['numpyParityMaxError']=max(errors)
    if payload.get('exportModel'):
        arrays={k:v.detach().numpy() for k,v in model.state_dict().items()};arrays.update(mean=mean.detach().numpy(),std=std.detach().numpy());runtime=HelpTCN(arrays)
        errors=[]
        for name,rows in [('train',train_rows),('validation',validation_rows)]:
            for row,expected in zip(rows,evaluations[name]['samples']):errors.append(abs(runtime.probability(row['frames'])-expected['helpProbability']))
        if max(errors)>1e-5:raise ValueError('numpy_torch_parity_failed')
        buffer=io.BytesIO();np.savez_compressed(buffer,**arrays);report['checkpointBase64']=base64.b64encode(buffer.getvalue()).decode();report['numpyParityMaxError']=max(errors)
    print(json.dumps(report))

if __name__=='__main__':main()
