import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveExpression} from '../../shared/sign-expression.mjs';
import {planMotionText} from '../../shared/motion-planner.mjs';
import {composeFixedMotion} from '../../shared/compose-fixed-motion.mjs';

test('原话与动作表达分开，保留感谢对象并披露程度变化',()=>{
 const raw='你好呀，真的很感谢你。',r=resolveExpression(raw);
 assert.equal(r.expression.originalText,raw);assert.equal(r.expression.actionText,'你好，谢谢你');
 assert.deepEqual(r.expression.steps.map(s=>s.id),['csl.hello','csl.thanks','csl.you']);
 assert.equal(r.expression.requiresConfirmation,true);assert.equal(r.expression.changes.length,2);
 assert.match(r.expression.changes[1].note,/程度暂未单独表现/);
 assert.deepEqual(r.preview,planMotionText(r.expression.actionText).preview);
});

test('原有精确表达仍能匹配，不默改原话，也不去重重复动作',()=>{
 for(const raw of ['谢谢','你好，我爱你','我爱你','是','不是','好','谢谢，谢谢']){
  const r=resolveExpression(raw);assert.ok(r.preview);assert.equal(r.expression.originalText,raw);assert.equal(r.expression.changes.length,0);
 }
 assert.equal(resolveExpression('谢谢，谢谢').expression.steps.length,2);
 assert.deepEqual(resolveExpression('我爱你').expression.steps.map(s=>s.label),['我','爱','你']);
});

test('整句无法覆盖时没有可播部分；不删否定、姓名、数字或未知任务',()=>{
 for(const raw of ['不感谢你','我不爱你','不是很感谢你','你好呀，我叫小明','感谢你帮我办证','我非常感谢你们','你好呀，交20元','你好呀，🙂','感谢你了吗','不好意思','你好呀，真不感谢你']){
  const r=resolveExpression(raw);assert.equal(r.status,'unsupported',raw);assert.equal(r.preview,null,raw);assert.equal(r.expression,null,raw);
 }
});

test('表达规则只匹配完整分句，控制数量时长，纯空输入无结果',()=>{
 assert.equal(resolveExpression('你好呀感谢你').preview,null);
 assert.equal(resolveExpression(Array(11).fill('拜拜').join('，')).reason,'too_many_actions');
 assert.equal(resolveExpression(Array(8).fill('抱歉').join('，')).reason,'too_long');
 for(const raw of ['',null,'，。','你'.repeat(2001)])assert.equal(resolveExpression(raw).preview,null);
});

test('新登记的好、是、不是可按各自版本完整连播，保留否定动作',()=>{
 const r=resolveExpression('不是，是，好'),p=r.preview;
 assert.deepEqual(p.steps.map(s=>s.id),['csl.not','csl.yes','csl.good']);
 assert.equal(p.steps[1].version,'user-description-2');
 const sources=new Map(p.steps.map(s=>[s.id,JSON.parse(readFileSync(`shared/sign-motions/anny/${s.id}.json`,'utf8'))]));
 const clip=composeFixedMotion({...p,basis:'表达整理测试'},sources);
 assert.equal(clip.sequence.length,3);assert.equal(clip.frames.at(-1).t,p.duration);
});
