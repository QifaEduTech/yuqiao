import {createHash} from 'node:crypto';
import {trainingDataset} from '../shared/training-datasets.mjs';
const key=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>Object.assign(Error(message),{status:400});

/** Derive an internal holdout from the TRAINING pool only, before fitting.
 * Keep declared real groups whole; automatic batches are not claimed as real.
 * Deterministic assignment never uses model predictions or test data.
 */
export function splitJointTrainingPool(samples,labels,policy){
 const pool=samples.filter(s=>trainingDataset(s.split)==='train'),test=samples.filter(s=>s.split==='test');
 const poolHashes=new Set(pool.map(s=>s.sourceHash));
 if(test.some(s=>poolHashes.has(s.sourceHash)))throw fail('同一原视频不能同时进入训练集和测试集。');
 const total=Array(labels.length+1).fill(0);
 for(const s of pool)total[s.label]++;
 for(let i=0;i<total.length;i++)if(total[i]<policy.minTrainingPoolPerClass)throw fail((i?labels[i-1].text:'共享背景/其他动作')+'的训练集至少需要'+policy.minTrainingPoolPerClass+'条视频；这是起步数量，不代表已经充分训练。');
 const groups=new Map();
 for(const s of pool){const group=s.realGroupConfirmed?'real:'+s.group:'source:'+s.sourceHash;const rows=groups.get(group)??[];rows.push(s);groups.set(group,rows);}
 const target=total.map(n=>Math.max(policy.minInternalValidation,Math.ceil(n*policy.internalValidationFraction))),held=total.map(()=>0),selected=new Set();
 const ordered=[...groups].sort((a,b)=>key(a[0]).localeCompare(key(b[0])));
 for(const [group,rows] of ordered){
  const count=total.map(()=>0);for(const s of rows)count[s.label]++;
  if(!count.some((n,i)=>n&&held[i]<target[i]))continue;
  if(count.some((n,i)=>total[i]-held[i]-n<policy.minInternalTrain))continue;
  selected.add(group);for(let i=0;i<held.length;i++)held[i]+=count[i];
 }
 if(held.some(n=>n<policy.minInternalValidation))throw fail('训练集内无法隔离出检查资料，请增加不同拍摄轮次的视频；测试集不会拿来训练。');
 const output=pool.map(s=>({...s,originalSplit:s.originalSplit??s.split,split:selected.has(s.realGroupConfirmed?'real:'+s.group:'source:'+s.sourceHash)?'validation':'train'}));
 return {samples:[...output,...test.map(s=>({...s,originalSplit:s.originalSplit??s.split}))],summary:{trainingPool:pool.length,fit:output.filter(s=>s.split==='train').length,internalValidation:output.filter(s=>s.split==='validation').length,test:test.length,realCaptureGroupsVerified:pool.every(s=>s.realGroupConfirmed===true),policy:policy.id}};
}
