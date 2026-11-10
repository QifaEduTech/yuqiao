import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import vm from 'node:vm';
const c=vm.createContext({});for(const file of ['android-features.js','android-motion.js','android-recognizers.js','android-multi.js'])vm.runInContext(readFileSync('shared/'+file,'utf8'),c);
const fx=JSON.parse(readFileSync('.runtime-logs/android-recognizer-fixtures.json','utf8')),M=c.YuqiaoMotion,R=c.YuqiaoRecognizers,cfg=fx.config;
const plain=v=>JSON.parse(JSON.stringify(v));
const close=(a,b,path='')=>{if(typeof a==='number'&&typeof b==='number'){assert.ok(Math.abs(a-b)<1e-6,`${path}: ${a} != ${b}`);return;}if(Array.isArray(b)){assert.equal(a.length,b.length,path);b.forEach((v,i)=>close(a[i],v,path+'.'+i));}else if(b&&typeof b==='object'){for(const k of Object.keys(b))close(a[k],b[k],path+'.'+k);}else assert.equal(a,b,path);};
function detectors(score=.99){return {'谢谢':new R.Thanks(()=>Array.from({length:10},(_,i)=>i===cfg.thanksIndex?score:0),cfg),'帮助':new R.Help(()=>score,cfg),'需要':new R.Need(()=>score,cfg),'我':new R.Me(()=>score,cfg)};}
test('四个运动检查与桌面正反例一致',()=>{
 for(const [file,hash] of Object.entries(fx.sourceHashes))assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash);
 for(const x of fx.gates.thumb)close(plain(M.thumbEvidence(x.rows,cfg.thumb,cfg.thumbLocal)),x.expected,'thumb '+x.name);
 for(const x of fx.gates.help)close(plain(M.helpMotion(x.rows,cfg.helpMotion)),x.expected,'help '+x.name);
 for(const x of fx.gates.need){const gate=new M.NeedMotion(cfg.needMotion);for(const row of x.rows)close(plain(gate.push(row.t,row.vector,1)),row.expected,'need '+x.name+' '+row.t);}
 for(const x of fx.gates.me)close(plain(M.meFrame(x.hands,x.shoulders,cfg.meMotion)),x.expected,'me '+x.name);
});
test('每个动作的候选、稳定状态及结束事件与桌面逐帧一致',()=>{
 const names={thanks:'谢谢',help:'帮助',need:'需要',me:'我'};for(const stream of fx.streams){const d=detectors(stream.modelScore)[names[stream.word]];for(const row of stream.rows){const result=stream.word==='thanks'?d.push(row.t,row.value,row.vector,row.aspect):stream.word==='me'?d.push(row.t,row.body):d.push(row.t,row.vector,row.aspect);close(plain(result),row.expected,stream.name+' '+row.t);}}
});
test('自动多动作仲裁与桌面逐帧一致，不用分数强选冲突词',()=>{
 let frames=0;for(const stream of fx.auto){const d=new c.YuqiaoMulti(detectors(),cfg);for(const row of stream.rows){close(plain(d.push(row.t,row.value,row.vector,row.aspect,row.body)),row.expected,stream.name+' '+row.t);frames++;}}
 for(const stream of fx.scripted){const fake=Object.fromEntries(['谢谢','帮助','需要','我'].map(word=>[word,{samples:[],reset(){},restart(){},beginSegment(){},push(t){return stream.rows.find(r=>Math.abs(r.t-t)<1e-8).outputs[word];}}]));const d=new c.YuqiaoMulti(fake,cfg);for(const row of stream.rows)close(plain(d.push(row.t,row.value,row.vector,row.aspect,row.body)),row.expected,'transition '+stream.name+' '+row.t);}
 writeFileSync('docs/assets/android-recognizer-parity.json',JSON.stringify({verifiedOn:'2026-10-26',syntheticOnly:true,modelStubs:true,gateScenarios:Object.fromEntries(Object.entries(fx.gates).map(([k,v])=>[k,v.length])),actionStreams:fx.streams.length,automaticStreams:fx.auto.length,automaticFrames:frames,scriptedTransitions:fx.scripted.length,sourceHashes:fx.sourceHashes,portHashes:Object.fromEntries(['shared/android-features.js','shared/android-motion.js','shared/android-recognizers.js','shared/android-multi.js'].map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')])),recognitionAccuracy:null,realTrackerEquivalence:false},null,2));
});
