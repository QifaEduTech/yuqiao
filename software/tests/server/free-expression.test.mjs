import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveExpression} from '../../shared/sign-expression.mjs';
import {expandedExpressionRules} from '../../shared/sign-expression-phrases.mjs';
import {validateLanguagePlan} from '../../server/local-language.mjs';

test('自由请求保留请求人、帮助的人和对象，不擅自补人或去重',()=>{
 const cases=[
  ['我想请医生帮忙',['我','请','医生','帮助']],
  ['我想请医生帮帮我',['我','请','医生','帮助','我']],
  ['请志愿者帮我挂号',['请','志愿者','帮助','我','挂号']],
  ['麻烦你帮我检查',['请','你','帮助','我','检查']],
  ['我需要医生的帮助',['我','需要','医生','帮助']],
  ['医生请帮帮我',['医生','请','帮助','我']],
  ['请帮我挂号',['请','帮助','我','挂号']],
  ['感谢志愿者帮我',['谢谢','志愿者','帮助','我']],
  ['请问门诊在哪里？',['请','门诊','哪里']],
  ['你好，我想请医生帮忙，谢谢你。',['你好','我','请','医生','帮助','谢谢','你']]
 ];
 for(const [text,labels] of cases){const r=resolveExpression(text);assert.ok(r.preview,text);assert.equal(r.expression.originalText,text);assert.deepEqual(r.expression.steps.map(s=>s.label),labels,text);assert.equal(r.expression.ruleVersion,'expression-rules-3');}
});

test('边界不模糊匹配：否定、时间、数量、姓名、他人对象和疑问语气不被吞掉',()=>{
 for(const text of ['我不想请医生帮忙','我想请医生不要帮我','我想请医生帮忙明天','明天请志愿者帮我挂号','我想请医生小王帮忙','请医生帮他检查','请你帮我两次挂号','我想请医生帮忙吗','我想请医生帮忙？','请医生帮我拿药','我想请医生帮忙但不要检查','请问门诊在哪里？我不想检查','我想请医生帮忙我想挂号','请医生帮我挂号20元']){
  const r=resolveExpression(text);assert.equal(r.preview,null,text);assert.equal(r.expression,null,text);
 }
});

test('各同义说法都可由现有动作完整表达，重复分句不合并，原有限制保留',()=>{
 let total=0;
 for(const rule of expandedExpressionRules)for(const input of rule.inputs){const r=resolveExpression(input);assert.ok(r.preview,input);assert.equal(r.expression.originalText,input);assert.equal(r.expression.actionText,rule.output,input);total++;}
 assert.ok(total>100);
 const twice=resolveExpression('请医生帮忙，请医生帮忙');assert.deepEqual(twice.expression.steps.map(s=>s.label),['请','医生','帮助','请','医生','帮助']);
 assert.equal(resolveExpression(Array(4).fill('我想请医生帮忙').join('，')).reason,'too_many_actions');
 assert.equal(resolveExpression('哪里？我想请医生帮忙？').reason,'unsupported_question');
});

test('本机模型不能换掉扩展请求的人物或省略帮助对象',()=>{
 const text='我想请医生帮帮我',r=resolveExpression(text),ids=r.expression.steps.map(s=>s.id);
 const out=actions=>({units:[{source:text,actions,missing:[],note:'表达请求。'}]});
 assert.ok(validateLanguagePlan(text,out(ids)).preview);
 assert.throws(()=>validateLanguagePlan(text,out(ids.slice(0,-1))),/不完整/);
 assert.throws(()=>validateLanguagePlan(text,out(ids.map(id=>id==='csl.me'?'csl.you':id))),/不完整/);
});
