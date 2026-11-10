import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const cache=resolve('models/mediapipe-vision'),out=resolve('web/public/local-vision');
const sources=[
 {file:'hand_landmarker.task',url:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'},
 {file:'pose_landmarker_full.task',url:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'}
];
const hash=b=>createHash('sha256').update(b).digest('hex');
await mkdir(cache,{recursive:true});await mkdir(resolve(out,'wasm'),{recursive:true});
let previous=null;try{previous=JSON.parse(await readFile('docs/assets/android-vision-models.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const records=[];
for(const item of sources){
 const path=resolve(cache,item.file);let bytes;
 if(existsSync(path))bytes=await readFile(path);
 else{
  const r=await fetch(item.url,{signal:AbortSignal.timeout(120000),redirect:'error'});if(!r.ok)throw Error('Official model download failed: '+r.status);
  bytes=Buffer.from(await r.arrayBuffer());if(bytes.length<1000000||bytes.length>30000000)throw Error('Unexpected model size');await writeFile(path,bytes,{flag:'wx'});
 }
 const sha256=hash(bytes),old=previous?.models.find(m=>m.file===item.file);if(old&&old.sha256!==sha256)throw Error('Cached landmark model changed; refusing silent replacement');
 await copyFile(path,resolve(out,item.file));records.push({...item,bytes:bytes.length,sha256});
}
const pkg=JSON.parse(await readFile('node_modules/@mediapipe/tasks-vision/package.json','utf8'));
if(pkg.version!=='1.1.1')throw Error('Unexpected tasks-vision runtime version');
const runtime=['vision_bundle.js',...['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm'].map(n=>'wasm/'+n)];
const assets=[];
for(const file of runtime){const bytes=await readFile(resolve('node_modules/@mediapipe/tasks-vision',file));await writeFile(resolve(out,file),bytes);assets.push({file,bytes:bytes.length,sha256:hash(bytes)});}
await copyFile('web/src/local-vision.worker.js',resolve(out,'worker.js'));
await copyFile('shared/android-features.js',resolve(out,'features.js'));
const featureConfig={meMotion:JSON.parse(await readFile('shared/me-motion.json','utf8')),needWindow:JSON.parse(await readFile('shared/need-live.json','utf8')),handChannels:JSON.parse(await readFile('shared/android-hand-channels.json','utf8')),featureLibrarySha256:hash(await readFile('shared/android-features.js'))};
await writeFile(resolve(out,'feature-config.json'),JSON.stringify(featureConfig,null,2));
for(const name of ['motion','recognizers','multi'])await copyFile('shared/android-'+name+'.js',resolve(out,name+'.js'));
for(const name of ['tcn.js','thanks-cnn.js'])await copyFile('web/android-app/'+name,resolve(out,name));
const contract=JSON.parse(await readFile('shared/android-runtime-contract.json','utf8')),recognitionConfig={};
for(const [key,file] of Object.entries(contract))recognitionConfig[key]=JSON.parse(await readFile('shared/'+file,'utf8'));
const catalog=JSON.parse(await readFile('shared/sign-catalog.json','utf8'));recognitionConfig.thanksIndex=catalog.entries.find(e=>e.text==='谢谢').recognitionIndex;
await writeFile(resolve(out,'recognition-config.json'),JSON.stringify(recognitionConfig,null,2));
const modelManifest=JSON.parse(await readFile('web/android-app/inference/manifest.json','utf8'));await mkdir(resolve(out,'recognition-models'),{recursive:true});
for(const entry of modelManifest.entries){await copyFile(resolve('web/android-app/inference',entry.file),resolve(out,'recognition-models',entry.file));if(entry.metadata)await copyFile(resolve('web/android-app/inference',entry.metadata),resolve(out,'recognition-models',entry.metadata));}
await writeFile(resolve(out,'recognition-models/manifest.json'),JSON.stringify(modelManifest,null,2));
await copyFile('models/sign-word-baseline/LICENSE',resolve(out,'Apache-2.0.txt'));
await writeFile(resolve(out,'NOTICE.txt'),'MediaPipe Tasks Vision 1.1.1 — Google / MediaPipe contributors. Runtime license: Apache-2.0.\nModels: official Google MediaPipe hand_landmarker and pose_landmarker_full, float16 version 1.\nSource URLs and hashes: manifest.json. Models remain separate from Yuqiao sign classifiers.\n');
const manifest={version:1,runtimeVersion:pkg.version,runtimeLicense:pkg.license,modelFamily:'MediaPipe Tasks Vision',models:records,runtimeAssets:assets,compatibility:'Not assumed identical to desktop MediaPipe Solutions 0.10.21; sign feature parity and motion gates remain pending.'};
await writeFile('docs/assets/android-vision-models.json',JSON.stringify(manifest,null,2));await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({landmarkModels:records.length,modelBytes:records.reduce((n,r)=>n+r.bytes,0),runtimeBytes:assets.reduce((n,r)=>n+r.bytes,0),remoteRuntimeRequests:false}));
