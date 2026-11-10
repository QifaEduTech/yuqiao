import {LocalLanguageService} from '../server/local-language.mjs';
import scene from '../shared/service-window-scene.json' with {type:'json'};
import {mkdir,writeFile} from 'node:fs/promises';
const service=new LocalLanguageService(),results=[];
for(const line of scene.dialogue){
 const start=Date.now();let result;
 try{const r=await service.resolve(line.text);const ids=r.expression?.steps.map(s=>s.id);result={text:line.text,actions:ids,ms:Date.now()-start,pass:JSON.stringify(ids)===JSON.stringify(line.motionIds)};}
 catch(e){result={text:line.text,pass:false,error:e.message};}
 results.push(result);console.log(JSON.stringify(result));
}
for(const text of ['请稍等','需要帮助吗','我不需要帮助']){
 const r=await service.resolve(text);const result={text,shouldReject:true,pass:!r.preview};results.push(result);console.log(JSON.stringify(result));
}
await mkdir('.runtime-logs/window-motions',{recursive:true});await writeFile('.runtime-logs/window-motions/language-check.json',JSON.stringify({note:'剧本开发句检查，不是独立语义准确率。',results},null,2));
if(results.some(r=>!r.pass))process.exitCode=1;
