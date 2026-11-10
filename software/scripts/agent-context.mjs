import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {recordingBundle} from '../server/recording-catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const entries=['README.md','database/schema.sql','server/app.mjs','server/model-registry.mjs','server/training-store.mjs','web/src/App.tsx','web/src/LearningPage.tsx','web/src/RealtimePage.tsx','web/src/TrainingPage.tsx','shared/realtime-targets.json','scripts/windows-project.ps1','scripts/configure-local-mysql.ps1'];
if(process.argv.includes('--check')){
 const errors=entries.filter(f=>!existsSync(resolve(root,f))).map(f=>'Missing '+f);
 try{recordingBundle(root);}catch{errors.push('Inference source/weight manifest check failed.');}
 console.log(JSON.stringify({errors,scope:'public runtime entry and inference manifest checks; not accuracy or live health'},null,2));process.exitCode=errors.length?1:0;
}else{
 const words=Object.values(JSON.parse(readFileSync(resolve(root,'shared/realtime-targets.json'),'utf8'))).map(x=>x.text);
 console.log('语桥公开软件包：React/TypeScript + Node + Python + MySQL + Three.js');
 console.log('先读本目录README和仓库AGENTS；终端在software。内置词：'+words.join('、'));
 console.log(entries.join('\n'));
 console.log('不含私人资料/大模型/环境。新机先建空库，填写自己的凭据，再Deploy-Web。安卓搁置；完整新机与真实设备验收待执行。');
}
