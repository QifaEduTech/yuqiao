import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ThanksCNN} from '../../web/android-app/thanks-cnn.js';
test('原TFLite谢谢模型等价导出，全部标签输出与原引擎一致',()=>{
 const fixture=JSON.parse(readFileSync('.runtime-logs/android-thanks-fixtures.json','utf8')),meta=JSON.parse(readFileSync('.runtime-logs/android-assets/models/thanks-cnn.json','utf8')),raw=readFileSync('.runtime-logs/android-assets/models/thanks-cnn.bin');assert.equal(meta.sourceSha256,fixture.sourceSha256);assert.equal(createHash('sha256').update(raw).digest('hex'),meta.artifactSha256);
 const model=new ThanksCNN(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),meta);let error=0;
 for(const c of fixture.cases){const scores=model.classify(c.features);assert.equal(scores.length,10);for(let i=0;i<10;i++)error=Math.max(error,Math.abs(scores[i]-c.scores[i]));assert.equal(scores.indexOf(Math.max(...scores)),c.scores.indexOf(Math.max(...c.scores)));}
 assert.ok(error<2e-5,'CNN mismatch '+error);writeFileSync('docs/assets/android-thanks-parity.json',JSON.stringify({verifiedOn:'2026-10-26',sourceSha256:fixture.sourceSha256,artifactSha256:meta.artifactSha256,syntheticCases:fixture.cases.length,outputComparisons:fixture.cases.length*10,maxError:error,trained:false,sourceVideosRead:0,recognitionAccuracy:null},null,2));
});
