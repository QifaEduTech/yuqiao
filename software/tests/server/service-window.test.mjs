import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import scene from '../../shared/service-window-scene.json' with {type:'json'};
import catalog from '../../shared/sign-motion-catalog.json' with {type:'json'};
import dictionary from '../../shared/sign-dictionary.json' with {type:'json'};
import {resolveInputPreview} from '../../shared/sign-preview.mjs';
import {planMotionText} from '../../shared/motion-planner.mjs';
import {composeFixedMotion} from '../../shared/compose-fixed-motion.mjs';
import {vocabulary,validateLanguagePlan} from '../../server/local-language.mjs';

test('四个新动作提升原词典条目，版本完整，自动进入模型目录但不进入识别',()=>{
 const recognition=JSON.parse(readFileSync('shared/sign-catalog.json','utf8'));
 assert.equal(recognition.entries.length,4);
 for(const entry of scene.motions){
  const rows=dictionary.entries.filter(e=>e.id===entry.id);assert.equal(rows.length,1);assert.equal(rows[0].text,entry.label);assert.equal(rows[0].referenceMaterial,false);
  const fixed=catalog.entries.find(e=>e.id===entry.id),asset=JSON.parse(readFileSync('shared/sign-motions/'+fixed.asset,'utf8'));
  assert.equal(asset.version,fixed.version);assert.equal(asset.status,'authored_unverified');assert.equal(asset.review,'not_reviewed');assert.equal(asset.verifiedBy,null);assert.equal(asset.frames.at(-1).t,entry.duration);
  assert.ok(vocabulary.some(e=>e.id===entry.id));assert.ok(!recognition.entries.some(e=>e.id===entry.id));
 }
});
test('场景剧本整段按既定动作顺序完整合成，首尾自然状态',()=>{
 for(const line of scene.dialogue){
  const plan=planMotionText(line.text);const ids=plan.status==='single'?[plan.entry.id]:plan.preview.steps.map(s=>s.id);assert.deepEqual(ids,line.motionIds);
  assert.ok(resolveInputPreview(line.text).preview);
  if(plan.status==='sequence'){
   const sources=new Map(plan.preview.steps.map(s=>[s.id,JSON.parse(readFileSync(`shared/sign-motions/anny/${s.id}.json`,'utf8'))]));
   const asset=composeFixedMotion({...plan.preview,basis:'服务窗口剧本'},sources);
   assert.deepEqual(asset.sequence.map(s=>s.id),line.motionIds);assert.equal(asset.frames.at(-1).t,plan.preview.duration);
  }
 }
});
test('稍等不能偷偷省成等候，问题句和否定句保持拒绝',()=>{
 for(const text of ['请稍等','等一下','需要帮助吗','我不需要帮助']){
  const result=validateLanguagePlan(text,{units:[{source:text,actions:['csl.ref.bmcx.1932','csl.ref.bmcx.1938'],missing:[],note:''}]});assert.equal(result.preview,null,text);
 }
 assert.equal(resolveInputPreview('好，请等候').status,'asset_unverified');
});
