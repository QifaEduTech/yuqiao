import {spawn} from 'node:child_process';
import {mkdir,readdir,copyFile,readFile,writeFile,stat,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.');
await new Promise((ok,no)=>{const c=spawn(resolve('.venv-sign/Scripts/python.exe'),['-B','scripts/export-android-models.py'],{cwd:root,stdio:'inherit',windowsHide:true});c.on('error',no);c.on('exit',code=>code?no(Error('Model export failed')):ok());});
await new Promise((ok,no)=>{const c=spawn(resolve('.venv-sign/Scripts/python.exe'),['-B','scripts/export-android-thanks.py'],{cwd:root,stdio:'inherit',windowsHide:true});c.on('error',no);c.on('exit',code=>code?no(Error('Thanks export failed')):ok());});
const source=resolve('.runtime-logs/android-assets/models'),dest=resolve('web/android-app/inference');await mkdir(dest,{recursive:true});
const files=await readdir(source);for(const name of files){if(!/^[a-z0-9.-]+\.(?:json|bin|csv|txt|tflite)$/i.test(name))throw Error('Unexpected model export file');if(name!=='thanks.tflite')await copyFile(resolve(source,name),resolve(dest,name));}
await unlink(resolve(dest,'thanks.tflite')).catch(e=>{if(e.code!=='ENOENT')throw e;});
const manifest=JSON.parse(await readFile(resolve(dest,'manifest.json'),'utf8'));for(const e of manifest.entries)if(e.runtime==='java-tcn')e.runtime='portable-tcn';
const cnnBytes=await readFile(resolve(dest,'thanks-cnn.json')),cnn=JSON.parse(cnnBytes.toString('utf8')),entry=manifest.entries.find(e=>e.category==='thanks');Object.assign(entry,{file:'thanks-cnn.bin',metadata:'thanks-cnn.json',metadataSha256:createHash('sha256').update(cnnBytes).digest('hex'),metadataBytes:cnnBytes.length,sourceSha256:cnn.sourceSha256,sha256:cnn.artifactSha256,bytes:(await stat(resolve(dest,'thanks-cnn.bin'))).size,runtime:'portable-cnn',syntheticTests:cnn.checks,note:'Original TFLite weights, equivalent portable CNN. Motion gates remain required.'});
manifest.localWordTrialAvailable=true;
await writeFile(resolve(dest,'manifest.json'),JSON.stringify(manifest,null,2));
await new Promise((ok,no)=>{const c=spawn(process.execPath,['scripts/prepare-local-vision.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});c.on('error',no);c.on('exit',code=>code?no(Error('Local vision preparation failed')):ok());});
await new Promise((ok,no)=>{const c=spawn(process.execPath,['scripts/run-local.mjs','build','--mode','android'],{cwd:root,stdio:'inherit',windowsHide:true});c.on('error',no);c.on('exit',code=>code?no(Error('Offline app build failed')):ok());});
const app=resolve('web/android-app/app');
const resources=['avatar-candidates/anny-makehuman.glb','avatar-candidates/anny-data-LICENSE.md',...(await readdir('web/public/avatar-wardrobe')).map(name=>'avatar-wardrobe/'+name)];
async function publicFiles(folder){for(const item of await readdir(resolve('web/public',folder),{withFileTypes:true})){if(item.isSymbolicLink())throw Error('Linked generated resource rejected');if(item.isDirectory())await publicFiles(folder+'/'+item.name);else resources.push(folder+'/'+item.name);}}await publicFiles('local-vision');
for(const file of resources){const target=resolve(app,file);await mkdir(resolve(target,'..'),{recursive:true});await copyFile(resolve('web/public',file),target);}
await mkdir(resolve(app,'licenses'),{recursive:true});
for(const [pkg,name] of [['react','React'],['react-dom','ReactDOM'],['three','Three'],['lucide-react','Lucide']])await copyFile(resolve('node_modules',pkg,'LICENSE'),resolve(app,'licenses',name+'.txt'));
async function inventory(path,prefix=''){const rows=[];for(const item of await readdir(path,{withFileTypes:true})){if(item.isSymbolicLink())throw Error('Package must not contain symlinks');const name=prefix+item.name;if(item.isDirectory())rows.push(...await inventory(resolve(path,item.name),name+'/'));else rows.push({path:name,bytes:(await stat(resolve(path,item.name))).size});}return rows;}
const packageFiles=await inventory(resolve('web/android-app'));
if(packageFiles.some(f=>/\.(mp4|webm|wav|sqlite|db|pem|keystore)$/i.test(f.path)||/^(data|secrets|models)\//.test(f.path)))throw Error('Unexpected private or stale resource in HBuilder project');
await writeFile(resolve('docs/assets/android-package-check.json'),JSON.stringify({date:new Date().toISOString(),type:'HBuilderX HTML5+ offline UI preview',fileCount:packageFiles.length,bytes:packageFiles.reduce((n,f)=>n+f.bytes,0),includesTrainingVideos:false,includesCredentials:false,offlineCameraRecognition:false,localLandmarkTracking:true,localWordTrialAvailable:true,nativeAndroidVerified:false,files:packageFiles},null,2));
console.log('HBuilderX 5+ App project: '+resolve('web/android-app'));
console.log('AppID is intentionally empty: obtain it in HBuilderX manifest settings before packaging.');
