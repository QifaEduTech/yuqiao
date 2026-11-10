import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {probability} from '../../web/android-app/tcn.js';
const fixture=JSON.parse(readFileSync('.runtime-logs/android-feature-fixtures.json','utf8'));
const context=vm.createContext({});vm.runInContext(readFileSync('shared/android-features.js','utf8'),context);const f=context.YuqiaoFeatures;
const sha=v=>createHash('sha256').update(v).digest('hex');
function equal(actual,expected){assert.equal(actual.length,expected.length);let max=0;for(let i=0;i<expected.length;i++){assert.ok(Number.isFinite(actual[i]));max=Math.max(max,Math.abs(actual[i]-expected[i]));}assert.ok(max<2e-5,'Feature difference: '+max);return max;}
function bytes(frames){const flat=Float32Array.from(frames.flatMap(x=>Array.from(x)));return flat.buffer;}
test('Android126/153/171/178特征与电脑相同输入一致，时间窗口与模型输出一致',()=>{
 assert.equal(fixture.syntheticOnly,true);for(const [file,hash] of Object.entries(fixture.sourceHashes))assert.equal(sha(readFileSync(file)),hash,'Regenerate fixtures after desktop source changes');
 let maxFeatureError=0,maxScoreError=0;
 for(const c of fixture.cases){const a=f.training153(c.hands,c.delta),b=f.body178(c.hands,c.pose,c.delta,c.aspect,fixture.rules),legacy=f.legacy126(c.hands);maxFeatureError=Math.max(maxFeatureError,equal(a,c.expected153),equal(b,c.expected178));if(c.expected126===null)assert.equal(legacy,null);else maxFeatureError=Math.max(maxFeatureError,equal(legacy,c.expected126));}
 const manifest=JSON.parse(readFileSync('web/android-app/inference/manifest.json','utf8'));
 for(const s of fixture.series){
  const base=s.observations.map(c=>f.training153(c.hands,c.delta)),body=s.observations.map(c=>f.body178(c.hands,c.pose,c.delta,s.aspect,fixture.rules)),need=f.directional171(base,s.times,s.aspect);
  for(let i=0;i<need.length;i++)maxFeatureError=Math.max(maxFeatureError,equal(need[i],s.expected171[i]));
  for(const [name,frames] of Object.entries({help:base,need,me:body})){
   const entry=manifest.entries.find(e=>e.category===name),weights=readFileSync('web/android-app/inference/'+entry.file);assert.equal(sha(weights),entry.sha256);assert.equal(entry.sourceSha256,fixture.modelArtifactHashes[name]);
   const score=probability(weights.buffer.slice(weights.byteOffset,weights.byteOffset+weights.byteLength),bytes(frames),frames.length),error=Math.abs(score-s.scores[name]);assert.ok(error<3e-5,'TCN difference '+name+': '+error);maxScoreError=Math.max(maxScoreError,error);
  }
 }
 writeFileSync('docs/assets/android-feature-parity.json',JSON.stringify({verifiedOn:'2026-10-23',syntheticOnly:true,sourceVideosRead:0,staticCases:fixture.cases.length,temporalCases:fixture.series.length,modelScoreComparisons:fixture.series.length*3,maxFeatureError,maxScoreError,featureLibrarySha256:sha(readFileSync('shared/android-features.js')),sourceHashes:fixture.sourceHashes,recognitionAccuracy:null,nativeAndroidVerified:false,trackerEquivalenceVerified:false},null,2));
});
test('非法时间与非有限输入拒绝；肩部缺失不补造，缺手中断方向历史',()=>{
 assert.throws(()=>f.training153([],NaN));assert.throws(()=>f.training153([],-1));assert.throws(()=>f.directional171([new Float32Array(153),new Float32Array(153)],[1,1],1));assert.throws(()=>f.directional171([new Float32Array(153)],[1],NaN));
 const noBody=f.body178([],null,.1,1,fixture.rules);assert.ok(Array.from(noBody.slice(153)).every(v=>v===0));assert.equal(noBody[152],3);
 const c=fixture.cases.find(c=>c.hands.length===1&&c.hands[0].side==='Left'&&c.expected153[74]===1);const hand=f.training153(c.hands,.1),missing=f.training153([],.1),out=f.directional171([hand,missing,hand],[0,.1,.2],1);assert.equal(out[2][155],0);assert.equal(out[2][160],0);assert.equal(out[2][161],0);
});
