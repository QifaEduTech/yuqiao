import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {planMotionText} from '../../shared/motion-planner.mjs';
import {resolveInputPreview} from '../../shared/sign-preview.mjs';
import {composeFixedMotion} from '../../shared/compose-fixed-motion.mjs';

test('整句完整分词，优先你好而不是你，保留顺序、重复与标点原文',()=>{
 for(const input of ['你好我爱你','你好，我爱你。','你好，谢谢，再见','谢谢 谢谢']){
  const result=resolveInputPreview(input);assert.equal(result.preview.kind,'sequence');assert.equal(result.preview.label,input);
 }
 const plan=planMotionText('你好，我爱你');assert.equal(plan.status,'sequence');assert.deepEqual(plan.preview.steps.map(s=>s.id),['csl.hello','csl.me','csl.love','csl.you']);
 assert.equal(plan.preview.steps[0].from,0);assert.equal(plan.preview.steps.at(-1).to,3);assert.equal(plan.preview.duration,11.6);
 assert.equal(planMotionText('谢谢 谢谢').preview.steps.length,2);
});

test('未知内容和否定词不跳过，不只播放认识的你好；限制整体长度',()=>{
 for(const input of ['你好，我叫小明','你好，没关系','我不爱你','你好🙂']){const result=resolveInputPreview(input);assert.equal(result.preview,null);assert.equal(result.status,'unsupported');assert.ok(result.missing.length);}
 assert.equal(planMotionText('你'.repeat(11)).reason,'too_many_actions');assert.equal(planMotionText('对不起'.repeat(8)).reason,'too_long');assert.equal(planMotionText('，。').status,'unsupported');
});

test('运行时计划可完整合成并保留表情，无需新增整句文件，来源版本范围可追溯',()=>{
 const before=readdirSync('shared/sign-motions/anny'),plan=planMotionText('你好，我爱你').preview;
 const sources=new Map(plan.steps.map(s=>[s.id,JSON.parse(readFileSync(`shared/sign-motions/anny/${s.id}.json`,'utf8'))]));
 const asset=composeFixedMotion({...plan,basis:'词库整段试播'},sources);
 assert.equal(asset.duration,11.6);assert.equal(asset.sequence.length,4);assert.deepEqual(asset.sequence.map(s=>s.id),plan.steps.map(s=>s.id));
 assert.equal(asset.frames[0].t,0);assert.equal(asset.frames.at(-1).t,11.6);assert.ok(asset.frames.some(f=>f.expressions?.mouthSmileLeft>0));assert.equal(asset.frames.at(-1).expressions.mouthSmileLeft,0);
 assert.deepEqual(readdirSync('shared/sign-motions/anny'),before);
});
