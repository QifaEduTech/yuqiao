import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {recordingBundle} from '../server/recording-catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const entries=['README.md','AGENTS.md','database/schema.sql','server/app.mjs','server/unified_live.py','server/joint-training.mjs','server/joint_fit.py','shared/recognition-engine.json','shared/unified-training.json','web/src/TrainingPage.tsx','web/src/RealtimePage.tsx','web/src/LiveRecognitionPage.tsx','web/live-recognition.html','web/android.html','web/src/avatarDisplay.tsx','scripts/windows-project.ps1'];
if(process.argv.includes('--check')){const errors=entries.filter(p=>!existsSync(resolve(root,p))).map(p=>'Missing '+p);let model='not supplied in public source';try{recordingBundle(root);model='configured and checksum valid';}catch{}console.log(JSON.stringify({errors,model,scope:'public source entry validation only; not accuracy or new-machine acceptance'},null,2));process.exitCode=errors.length?1:0;}else{console.log('语桥公开源码。先读README，终端在software；统一训练、两数据集、同账号数字人同步。');console.log(entries.join('\n'));console.log('不含私人数据/权重/凭据。原机训练审计不在公开包，不补造。');}
