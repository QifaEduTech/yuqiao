"""Export the exact supported TFLite CNN graph and constants, never train a model."""
from pathlib import Path
import sys,json,hashlib
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_worker import classifier,predict,CATALOG,EXPECTED_LABELS
from ai_edge_litert import schema_py_generated as S
engine,inp,out=classifier();content=(ROOT/'models/sign-word-baseline/dynamic_gesture_classifier.tflite').read_bytes();model=S.Model.GetRootAsModel(content,0);graph=model.Subgraphs(0)
layers=[];weights=[];offset=0
def parameter(index):
 global offset
 a=engine.get_tensor(int(index));assert a.dtype==np.float32 and np.isfinite(a).all();r={'offset':offset,'shape':a.shape,'count':a.size};offset+=a.size;weights.append(a.astype('<f4').tobytes());return r
names={v:k for k,v in vars(S.BuiltinOperator).items() if isinstance(v,int)}
def options(op,cls):
 table=op.BuiltinOptions();o=cls();o.Init(table.Bytes,table.Pos);return o
for i in range(graph.OperatorsLength()):
 op=graph.Operators(i);code=model.OperatorCodes(op.OpcodeIndex()).BuiltinCode();name=names[code];inputs=op.InputsAsNumpy().tolist()
 if name in ['EXPAND_DIMS','RESHAPE']:continue
 if name=='CONV_2D':
  p=options(op,S.Conv2DOptions);assert (p.Padding(),p.StrideH(),p.StrideW(),p.DilationHFactor(),p.DilationWFactor(),p.FusedActivationFunction())==(0,1,1,1,1,1)
  w=parameter(inputs[1]);b=parameter(inputs[2]);assert w['shape'][1:3]==(1,3)
  layers.append({'kind':'conv','weights':w,'bias':b})
 elif name=='MAX_POOL_2D':
  p=options(op,S.Pool2DOptions);assert (p.Padding(),p.StrideH(),p.StrideW(),p.FilterHeight(),p.FilterWidth(),p.FusedActivationFunction())==(1,2,1,2,1,0);layers.append({'kind':'pool'})
 elif name=='MEAN':assert engine.get_tensor(inputs[1]).tolist()==1;layers.append({'kind':'mean'})
 elif name=='FULLY_CONNECTED':
  p=options(op,S.FullyConnectedOptions);assert p.FusedActivationFunction() in [0,1];layers.append({'kind':'dense','weights':parameter(inputs[1]),'bias':parameter(inputs[2]),'relu':p.FusedActivationFunction()==1})
 elif name=='SOFTMAX':assert options(op,S.SoftmaxOptions).Beta()==1;layers.append({'kind':'softmax'})
 else:raise ValueError('Unsupported operator '+name)
assert [x['kind'] for x in layers]==['conv','conv','pool','conv','conv','pool','conv','mean','dense','dense','softmax']
blob=b'YQTHX001'+b''.join(weights);dest=ROOT/'.runtime-logs/android-assets/models';dest.mkdir(parents=True,exist_ok=True);(dest/'thanks-cnn.bin').write_bytes(blob)
checks=[]
for i in range(2):
 x=np.zeros((30,126),np.float32) if i==0 else (np.sin(np.arange(30*126,dtype=np.float32)*.137)*.5).reshape(30,126)
 data=x.astype('<f4').tobytes();name=f'thanks-cnn-check-{i}.bin';(dest/name).write_bytes(data);checks.append({'file':name,'frames':30,'expected':predict(engine,inp,out,x).tolist(),'sha256':hashlib.sha256(data).hexdigest()})
meta={'id':'thanks-original-tflite-cnn-v1','sourceSha256':hashlib.sha256(content).hexdigest(),'artifactSha256':hashlib.sha256(blob).hexdigest(),'dimensions':[30,126],'labels':EXPECTED_LABELS,'layers':layers,'floatCount':offset,'checks':checks}
(dest/'thanks-cnn.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
rng=np.random.default_rng(26026);cases=[]
for i in range(18):
 x=np.zeros((30,126),np.float32) if i==0 else rng.uniform(-1,1,(30,126)).astype(np.float32)
 if i%3==0:x[:,63:]=0
 if i%3==1:x[:,:63]=0
 if i>12:x=np.repeat(x[:1],30,axis=0)
 cases.append({'features':x.tolist(),'scores':predict(engine,inp,out,x).tolist()})
(ROOT/'.runtime-logs/android-thanks-fixtures.json').write_text(json.dumps({'sourceSha256':meta['sourceSha256'],'cases':cases}),encoding='utf-8')
print(json.dumps({'exportBytes':len(blob),'syntheticCases':len(cases),'trained':False,'sourceVideosRead':0}))
