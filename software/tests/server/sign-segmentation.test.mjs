import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSequenceResult} from '../../server/sign.mjs';

const valid=()=>({kind:'segmented-sign-sequence',status:'complete',duration_seconds:8,unresolved_count:0,text:'你好，谢谢，你好',segments:[{index:1,start_seconds:0,end_seconds:2,status:'candidate',candidate:'你好'},{index:2,start_seconds:3,end_seconds:5,status:'candidate',candidate:'谢谢'},{index:3,start_seconds:6,end_seconds:8,status:'candidate',candidate:'你好'}]});
test('分段结果保留重复与顺序，拒绝漏段后假装完整及非法候选',()=>{
 assert.doesNotThrow(()=>validateSequenceResult(valid()));
 const partial=valid();partial.segments[1].status='uncertain';partial.segments[1].candidate=null;partial.unresolved_count=1;assert.throws(()=>validateSequenceResult(partial));partial.status='partial';partial.text='';assert.doesNotThrow(()=>validateSequenceResult(partial));
 const gap=valid();gap.segments[1].index=3;assert.throws(()=>validateSequenceResult(gap));
 const wrong=valid();wrong.segments[1].candidate='没关系';assert.throws(()=>validateSequenceResult(wrong));
 const overlap=valid();overlap.segments[1].start_seconds=1;assert.throws(()=>validateSequenceResult(overlap));
});
