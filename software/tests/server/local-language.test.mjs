import test from 'node:test';
import assert from 'node:assert/strict';
import settings from '../../shared/local-language.json' with {type:'json'};
import {LocalLanguageService,validateLanguagePlan} from '../../server/local-language.mjs';
const unit=(source,actions,missing=[],note='按含义整理。')=>({source,actions,missing,note});
const body=units=>({units});
const reply=output=>new Response(JSON.stringify({model:settings.model,done:true,done_reason:'stop',message:{content:JSON.stringify(output)}}));

test('模型输出转为现有版本动作，原话与拟表达分离且必须确认',()=>{
 const text='哈喽，多谢你了',r=validateLanguagePlan(text,body([unit('哈喽',['csl.hello']),unit('多谢你了',['csl.thanks','csl.you'])]));
 assert.equal(r.expression.originalText,text);assert.equal(r.expression.provider,'ollama');assert.equal(r.expression.requiresConfirmation,true);
 assert.deepEqual(r.preview.steps.map(s=>s.id),['csl.hello','csl.thanks','csl.you']);
 assert.equal(r.preview.status,'authored_unverified');
});
test('幻造ID、遗漏原话、重排原话、无动作无缺词和无效格式均不播放',()=>{
 for(const output of [body([unit('你好',['csl.unknown'])]),body([unit('你好',['csl.hello'])]),body([unit('谢谢',['csl.thanks']),unit('你好',['csl.hello'])]),body([unit('你好谢谢',[])]),{},body([unit('你好谢谢',['csl.hello'],[],null)])]){
  assert.throws(()=>validateLanguagePlan('你好谢谢',output),/不完整/);
 }
});
test('模型漏报否定、数字、姓名、疑问等重要信息时独立检查拒绝',()=>{
 for(const text of ['我不爱你','交20元','我叫小明','感谢你了吗','明天再见','我爱她','请帮我办证']){
  const r=validateLanguagePlan(text,body([unit(text,['csl.me','csl.love','csl.you'])]));assert.equal(r.preview,null,text);
 }
 assert.equal(validateLanguagePlan('不是',body([unit('不是',['csl.not'])])).preview.id,'csl.not');
 assert.equal(validateLanguagePlan('对不起',body([unit('对不起',['csl.sorry'])])).preview.id,'csl.sorry');
});
test('精确原动作不得被模型替换、重复不删除、缺词整段拒绝',()=>{
 assert.throws(()=>validateLanguagePlan('你好',body([unit('你好',['csl.you'])])),/不完整/);
 assert.throws(()=>validateLanguagePlan('谢谢谢谢',body([unit('谢谢谢谢',['csl.thanks'])])),/不完整/);
 const r=validateLanguagePlan('你好，买票',body([unit('你好',['csl.hello']),unit('买票',[],['买票'])]));assert.equal(r.preview,null);
});
test('只调用回环端口的真实模型接口，JSON约束、无思考输出、不发送录像与历史',async()=>{
 let request;
 const svc=new LocalLanguageService({fetchImpl:async(url,options)=>{request={url,...options};return reply(body([unit('谢谢',['csl.thanks'])]));}});
 const r=await svc.resolve('谢谢');assert.equal(r.expression.model,settings.model);
 const sent=JSON.parse(request.body);assert.equal(request.url,settings.baseUrl+'/api/chat');assert.equal(sent.think,false);assert.equal(sent.stream,false);assert.ok(sent.format.properties.units);assert.deepEqual(sent.format.properties.units.items.properties.source.enum,['谢谢']);assert.deepEqual(sent.format.properties.units.items.properties.actions.const,['csl.thanks']);assert.equal(sent.messages.length,2);assert.equal(JSON.parse(sent.messages[1].content).originalText,'谢谢');
 assert.throws(()=>new LocalLanguageService({config:{...settings,baseUrl:'https://remote.example'}}),/local loopback/);
});
test('模型离线/缺失/输出截断时不回退到规则冒充模型',async()=>{
 for(const fetchImpl of [async()=>{throw Error('offline')},async()=>new Response('',{status:404}),async()=>new Response(JSON.stringify({done:true,done_reason:'length',model:settings.model,message:{content:'{}'}}))]){
  const svc=new LocalLanguageService({fetchImpl});await assert.rejects(svc.resolve('谢谢'),e=>[422,503].includes(e.status));assert.equal(svc.busy,false);
 }
});
test('超时和取消释放单请求锁，长输入不发送',async()=>{
 let calls=0;
 const fetchImpl=async(_url,{signal})=>{calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));};
 const svc=new LocalLanguageService({fetchImpl,config:{...settings,timeoutMs:30}});
 const controller=new AbortController(),first=svc.resolve('谢谢',controller.signal);
 await assert.rejects(svc.resolve('你好'),e=>e.status===429);controller.abort();await assert.rejects(first);assert.equal(svc.busy,false);
 await assert.rejects(svc.resolve('谢谢'),/超时/);assert.equal(svc.busy,false);
 await assert.rejects(svc.resolve('你'.repeat(501)),e=>e.status===400);assert.equal(calls,2);
});
