import test from 'node:test';
import assert from 'node:assert/strict';
import policy from '../../shared/unified-training.json' with {type:'json'};
import {trainingDataset} from '../../shared/training-datasets.mjs';
import {splitJointTrainingPool} from '../../server/joint-dataset-split.mjs';
const labels=[{text:'我',signId:'csl.me'}];
const sample=(label,i,split='train')=>({label,sourceHash:label+'-'+i+'-'+split,split,start:0,end:2,group:'自动第1轮',realGroupConfirmed:false});
const pool=()=>[0,1].flatMap(label=>Array.from({length:20},(_,i)=>sample(label,i,i<5?'validation':'train')));

test('只公开训练/测试两个用途，旧验证归训练视图且源登记不改',()=>{
 assert.equal(trainingDataset('validation'),'train');assert.equal(trainingDataset('test'),'test');
 const input=[...pool(),...Array.from({length:20},(_,i)=>sample(1,i,'test'))],original=structuredClone(input);
 const result=splitJointTrainingPool(input,labels,policy);assert.deepEqual(input,original);
 assert.deepEqual(result.summary,{trainingPool:40,fit:32,internalValidation:8,test:20,realCaptureGroupsVerified:false,policy:policy.id});
 assert.ok(result.samples.filter(s=>s.split==='test').every(s=>s.originalSplit==='test'));
 const byRole=xs=>Object.fromEntries(xs.map(s=>[s.sourceHash,s.split]));assert.deepEqual(byRole(result.samples),byRole(splitJointTrainingPool([...input].reverse(),labels,policy).samples));
 const validation=new Set(result.samples.filter(s=>s.split==='validation').map(s=>s.sourceHash));assert.ok(result.samples.filter(s=>s.split==='train').every(s=>!validation.has(s.sourceHash)));
});
test('测试集不能拿来凑训练数量，3条不再足以启动',()=>{
 const data=[...Array.from({length:20},(_,i)=>sample(0,i)),...Array.from({length:3},(_,i)=>sample(1,i)),...Array.from({length:30},(_,i)=>sample(1,i,'test'))];
 assert.throws(()=>splitJointTrainingPool(data,labels,policy),/训练集至少需要20条/);
 const duplicate={...pool()[0],split:'test'};assert.throws(()=>splitJointTrainingPool([...pool(),duplicate],labels,policy),/同一原视频/);
});
test('真实拍摄组不跨内部训练和验证；只有一组不能伪造独立检查',()=>{
 const data=pool().map((s,i)=>({...s,realGroupConfirmed:true,group:i%20<5?'真实A':'真实B'}));
 const result=splitJointTrainingPool(data,labels,policy).samples;
 for(const group of ['真实A','真实B'])assert.equal(new Set(result.filter(s=>s.group===group).map(s=>s.split)).size,1);
 assert.throws(()=>splitJointTrainingPool(data.map(s=>({...s,group:'只有一个真实组'})),labels,policy),/无法隔离/);
});
