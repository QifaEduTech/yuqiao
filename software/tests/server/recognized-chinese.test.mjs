import test from 'node:test';
import assert from 'node:assert/strict';
import {organizeRecognizedWords as organize,organizeUtterance} from '../../shared/recognized-chinese.mjs';

test('整理已确认的词，保留每个来源词及重复次数，问候和需求断句',()=>{
 const cases=[
  [['我','需要','帮助','谢谢'],'我需要帮助，谢谢。'],
  [['你好','我','需要','帮助'],'你好，我需要帮助。'],
  [['谢谢','谢谢'],'谢谢，谢谢。'],
  [['挂号','我','需要'],'我需要挂号。'],
  [['我','帮助','需要'],'我需要帮助。'],
  [['请','帮助','我'],'请帮助我。'],
  [['我','没有','过敏'],'我没有过敏。'],
  [['我','不是','医生'],'我不是医生。'],
  [['我','需要','自训甲'],'我需要自训甲。'],
  [['自训甲'],'自训甲。'],
  [['我','发烧','我','需要','医生','帮助'],'我发烧了，我需要医生帮助。'],
  [['我','发烧','需要','医生','帮助'],'我发烧了，需要医生帮助。'],
  [['我','需要','帮助','我','需要','挂号'],'我需要帮助，我需要挂号。']
 ];
 for(const [words,text] of cases){const original=[...words],r=organize(words);assert.equal(r.status,'ready',words.join('/'));assert.equal(r.text,text);assert.deepEqual(words,original);assert.deepEqual(r.sourceWords,original);assert.equal(r.sourceText,words.join('')+'。');assert.deepEqual(r.clauses.flatMap(c=>c.sourceIndices).sort((a,b)=>a-b),words.map((_,i)=>i));}
});
test('明确位置疑问添加在，问题不擅自改成陈述或补吗',()=>{
 for(const words of [['医院','哪里'],['哪里','医院']]){const r=organize(words);assert.equal(r.text,'医院在哪里？');assert.deepEqual(r.clauses.flatMap(c=>c.inserted),['在']);}
 assert.equal(organize(['哪里','痛']).text,'哪里痛？');
 assert.equal(organize(['有','药']).text,'有药。');
 assert.equal(organize(['没有','药']).text,'没有药。');
});
test('不完整识别、无明确主客体、未知句法和否定范围不清时不自动播报',()=>{
 for(const words of [['我','你','帮助'],['帮助','需要','我','你'],['没有','需要','帮助'],['不','需要','帮助'],['我','需要'],['自训甲','自训乙'],['自训甲','我','需要'],['痛','我','需要'],['医生','我','你'],['我','我']]){
  const r=organize(words);assert.equal(r.status,'needs_review',words.join('/'));assert.deepEqual(r.sourceWords,words);assert.equal(r.text,words.join('，')+'。');assert.deepEqual(r.clauses,[]);
 }
 const r=organize(['我','需要','帮助'],{partial:true});assert.equal(r.status,'needs_review');assert.equal(r.reason,'incomplete_recognition');
 const ambiguous=organize(['谢谢','我','需要','帮助']);assert.equal(ambiguous.status,'needs_review');assert.equal(ambiguous.reason,'ambiguous_structure');
});
test('空值、长度、标点注入和非法标签不能变成可播中文',()=>{
 for(const words of [null,[],['我',null],[''],[' 我'],['我。请'],['A\nB'],Array(61).fill('谢谢'),Array(6).fill('长'.repeat(90))])assert.equal(organize(words).status,'needs_review');
});

test('录像中“需要”漏识时只补全明确的发烧求助句，保留实际识别词序',()=>{
 const words=['我','发烧','我','医生','帮助'];
 for(const partial of [false,true]){
  const result=organizeUtterance(words,{partial});
  assert.equal(result.text,'我发烧了，我需要医生帮助。');
  assert.equal(result.status,'ready');
  assert.deepEqual(result.sourceWords,words);
  assert.deepEqual(result.clauses.flatMap(c=>c.inserted),['了','需要']);
  assert.deepEqual(result.clauses.flatMap(c=>c.sourceIndices),[0,1,2,3,4]);
 }
 assert.equal(organizeUtterance(['我','发烧','医生','帮助']).text,'我发烧了，需要医生帮助。');
 assert.equal(organizeUtterance(['医生','帮助']).text,'医生帮助。');
 assert.equal(organizeUtterance(['我','发烧','我','不','医生','帮助']).text,'我发烧我不医生帮助。');
 assert.equal(organize(words).status,'needs_review');
});

test('求助在前、发烧在后时重排成句，医生必须来自识别结果',()=>{
 const cases=[
  [['我','帮助','我','发烧'],'我发烧了，我需要帮助。',['需要']],
  [['我','帮助','医生','我','发烧'],'我发烧了，我需要医生帮助。',['需要']],
  [['我','需要','帮助','医生','我','发烧'],'我发烧了，我需要医生帮助。',[]],
  [['我','发烧','帮助'],'我发烧了，需要帮助。',['需要']],
 ];
 for(const [words,text,inferred] of cases){
  const r=organizeUtterance(words);
  assert.equal(r.text,text);
  assert.equal(r.status,'ready');
  assert.deepEqual(r.inferredWords,inferred);
  assert.deepEqual(r.clauses.flatMap(c=>c.sourceIndices).sort((a,b)=>a-b),words.map((_,i)=>i));
 }
 for(const words of [['我'],['我','帮助','医生'],['我','不','需要','帮助','我','发烧']]){
  const r=organizeUtterance(words);
  assert.deepEqual(r.inferredWords??[],[]);
  assert.equal(r.text.includes('需要'),words.includes('需要'));
 }
});
