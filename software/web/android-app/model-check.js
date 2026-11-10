import {probability} from './tcn.js';
import {ThanksCNN} from './thanks-cnn.js';
export {probability} from './tcn.js';
async function load(name){
 if(!/^[a-z0-9.-]+$/i.test(name))throw Error('资源路径无效');
 if(location.protocol==='file:'&&window.plus)return await new Promise((resolve,reject)=>plus.io.resolveLocalFileSystemURL('_www/inference/'+name,entry=>entry.file(file=>{const reader=new plus.io.FileReader();reader.onloadend=e=>{try{const raw=atob(e.target.result.split(',')[1]);resolve(Uint8Array.from(raw,c=>c.charCodeAt(0)).buffer);}catch{reject(Error('无法读取模型'));}};reader.onerror=reject;reader.readAsDataURL(file);},reject),reject));
 const response=await fetch('inference/'+name);if(!response.ok)throw Error('缺少模型包，请先运行准备脚本');return await response.arrayBuffer();
}
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
export async function checkModels(){
 const manifest=JSON.parse(new TextDecoder().decode(await load('manifest.json')));let count=0,maxError=0;
 for(const entry of manifest.entries){const bytes=await load(entry.file);if(await sha(bytes)!==entry.sha256)throw Error('模型校验失败：'+entry.label);const cnn=entry.runtime==='portable-cnn'?new ThanksCNN(bytes,JSON.parse(new TextDecoder().decode(await load(entry.metadata)))):null;for(const c of entry.syntheticTests??[]){const features=await load(c.file);if(await sha(features)!==c.sha256)throw Error('合成校验资源不完整');const scores=cnn?cnn.classify(Array.from({length:30},(_,i)=>new Float32Array(features,i*126*4,126))):null;const error=scores?Math.max(...scores.map((v,i)=>Math.abs(v-c.expected[i]))):Math.abs(probability(bytes,features,c.frames)-c.expected);maxError=Math.max(maxError,error);if(error>manifest.numericalTolerance)throw Error('计算一致性检查失败');count++;}}
 return {models:manifest.entries.length,syntheticCases:count,maxAbsoluteError:maxError,cameraRecognitionReady:false,trainingVideos:0};
}
document.querySelector('#check')?.addEventListener('click',async e=>{e.target.disabled=true;const output=document.querySelector('#result');output.textContent='正在检查…';try{const r=await checkModels();output.textContent=`${r.models}个模型文件完整，${r.syntheticCases}项合成特征检查通过。\n最大计算差异：${r.maxAbsoluteError.toExponential(2)}。\n本地候选处于试用阶段；这不是准确率测试。`;output.dataset.result='passed';window.__modelCheck=r;}catch(error){output.textContent=error.message;output.dataset.result='failed';}finally{e.target.disabled=false;}});
