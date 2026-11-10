import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {composeFixedMotion} from '../../scripts/lib/compose-fixed-motion.mjs';
import {resolveInputPreview} from '../../shared/sign-preview.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const definition=read('shared/sign-motion-sequences.json').entries[0];
const sources=new Map(definition.steps.map(s=>[s.id,read(`shared/sign-motions/anny/${s.id}.json`)]));

test('我爱你连续资源复用原动作，去掉词间回落并保持完整起止',()=>{
 const before=JSON.stringify([...sources]),clip=composeFixedMotion(definition,sources),saved=read('shared/sign-motions/anny/csl.i_love_you.json');
 assert.deepEqual(clip.frames,saved.frames);assert.equal(JSON.stringify([...sources]),before);
 assert.equal(clip.duration,7.7);assert.deepEqual(clip.sequence.map(s=>s.label),['我','爱','你']);
 assert.equal(clip.sequence[1].sourceFrom,.8);assert.equal(clip.sequence[2].sourceFrom,.6);
 assert.equal(clip.frames[0].t,0);assert.equal(clip.frames.at(-1).t,7.7);
 assert.equal(clip.status,'authored_unverified');assert.equal(clip.verifiedBy,null);
 for(const input of ['我爱你',' 我爱你！ '])assert.equal(resolveInputPreview(input).preview.id,clip.id);
 for(const input of ['我不爱你','你不爱我'])assert.equal(resolveInputPreview(input).status,'unsupported');
});

test('连续制作拒绝缺失、过期、越界来源和无过渡拼接',()=>{
 assert.throws(()=>composeFixedMotion(definition,new Map()),/source/);
 const stale=structuredClone(definition);stale.steps[1].version='old';assert.throws(()=>composeFixedMotion(stale,sources),/source/);
 const range=structuredClone(definition);range.steps[1].to=99;assert.throws(()=>composeFixedMotion(range,sources),/range/);
 const cut=structuredClone(definition);cut.steps[1].transition=0;assert.throws(()=>composeFixedMotion(cut,sources),/transition/);
});

test('组合保留爱的柔和表情并在前后中性动作间渐变，拒绝超限表情',()=>{
 const clip=composeFixedMotion(definition,sources),smile=t=>clip.frames.find(f=>Math.abs(f.t-t)<.001).expressions.mouthSmileLeft;
 assert.equal(smile(0),0);assert.equal(smile(1.6),0);assert.ok(smile(1.9)>0&&smile(1.9)<.16);assert.equal(smile(3),.16);assert.equal(smile(6),0);assert.equal(smile(7.7),0);
 const invalid=new Map([...sources].map(([k,a])=>[k,structuredClone(a)]));invalid.get('csl.love').frames[30].expressions.mouthSmileLeft=.9;assert.throws(()=>composeFixedMotion(definition,invalid),/expressions/);
});
