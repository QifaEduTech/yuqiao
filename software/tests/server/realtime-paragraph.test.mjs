import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {formatParagraphWords,validParagraph} from '../../shared/realtime-paragraph.mjs';
import {RealtimeSignService} from '../../server/realtime.mjs';

const result=(words)=>({state:words.length?'collecting':'empty',words,text:formatParagraphWords(words),wordCount:words.length,final:null});
test('任意已接入词按实际次序成段，重复和否定均保留',()=>{
  for(const words of [['我','需要','帮助'],['没有','过敏','医生'],['自训甲','自训甲','自训乙']]){
    assert.equal(formatParagraphWords(words),words.join('')+'。');assert.ok(validParagraph(result(words),[...new Set(words)]));
  }
  assert.equal(formatParagraphWords([]),'');
});
test('段落协议拒绝额外补词、未知词、丢词、错误计数与非法完成字段',()=>{
  const base=result(['甲','乙']);
  for(const patch of [{text:'甲还有乙。'},{words:['甲']},{wordCount:3},{words:['甲','未知']},{state:'finished'}])assert.equal(Boolean(validParagraph({...base,...patch},['甲','乙'])),false);
  const final={id:1,text:base.text,words:base.words,wordCount:2,startMs:0,endMs:100,partial:false};
  assert.ok(validParagraph({...result([]),final},['甲','乙']));
  for(const patch of [{partial:'false'},{id:0},{endMs:0},{text:'自动补出的句子。'}])assert.equal(Boolean(validParagraph({...result([]),final:{...final,...patch}},['甲','乙'])),false);
  assert.ok(validParagraph({...base,autoEnd:{remainingMs:1200}},['甲','乙']));
  for(const ms of [-1,2001,1.5,NaN,'1000'])assert.equal(validParagraph({...base,autoEnd:{remainingMs:ms}},['甲','乙']),false);
  assert.equal(validParagraph({...result([]),autoEnd:{remainingMs:1000}},['甲','乙']),false);
  assert.ok(validParagraph({...result([]),final:{...final,endReason:'quiet'}},['甲','乙']));
  assert.equal(validParagraph({...result([]),final:{...final,endReason:'guessed'}},['甲','乙']),false);
});
test('服务拒绝错误表达方式，实际段落工作进程可以结束空段',async t=>{
  const service=new RealtimeSignService(resolve('.'));t.after(()=>service.close());
  await assert.rejects(service.start(undefined,'auto',undefined,{flow:'sentence-template'}),e=>e.status===400);
  await assert.rejects(service.start(undefined,'help',undefined,{flow:'paragraph'}),e=>e.status===400);
  const ready=await service.start(undefined,'auto',undefined,{flow:'paragraph'});assert.equal(ready.flow,'paragraph');
  const jpeg=Buffer.from(JSON.parse(await readFile(new URL('../fixtures/realtime-blank.json',import.meta.url),'utf8')).base64,'base64');
  const r=await service.frame(ready.session,jpeg,1,0,undefined,{finishParagraph:true});assert.equal(r.paragraph.final,null);assert.equal(r.paragraph.text,'');assert.ok(validParagraph(r.paragraph,ready.supportedActions.map(x=>x.text)));
});
