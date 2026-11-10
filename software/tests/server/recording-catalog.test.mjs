import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {recordingEntries,recordingBundle,recordingSnapshot,validateRecordingResult} from '../../server/recording-catalog.mjs';
import {SignService} from '../../server/sign.mjs';
test('录像词表与实时一致，模型快照按真实候选关联',()=>{
 assert.deepEqual(recordingEntries.map(e=>e.text),['谢谢','帮助','需要','我']);
 const bundle=recordingBundle(resolve('.'));
 for(const word of ['帮助','需要','我']){const snapshot=recordingSnapshot(bundle,word);assert.notEqual(snapshot.modelId,'mediapipe-conv1d-baseline');assert.equal(snapshot.pipelineModels.length,4);assert.equal(snapshot.pipelineSha256,bundle.sha256);assert.match(snapshot.modelSha256,/^[a-f0-9]{64}$/);}
 assert.equal(recordingSnapshot(bundle,'谢谢').modelId,'mediapipe-conv1d-baseline');assert.deepEqual(new SignService(resolve('.')).status().labels,recordingEntries.map(e=>e.text));
});
test('录像结果拒绝旧词、冲突、重复动作和不一致元数据',()=>{
 const base={status:'candidate',candidate:'帮助',sign_id:'csl.ref.bmcx.1900',pipeline_id:'realtime-four-words-recording-v1',pipeline_sha256:'a'.repeat(64),duration_seconds:2,sampled_frames:60,hand_frames:50,observed_word_count:1,completed_event_count:0,conflict_frames:0,candidate_after_completion:false,end_boundary_observed:false,low_frame_rate:false};
 assert.equal(validateRecordingResult(base),base);
 for(const change of [{candidate:'再见',sign_id:'csl.goodbye'},{observed_word_count:2},{conflict_frames:1},{completed_event_count:2},{candidate_after_completion:true},{pipeline_sha256:'bad'},{hand_frames:0},{status:'uncertain',candidate:'帮助'}])assert.throws(()=>validateRecordingResult({...base,...change}));
});
