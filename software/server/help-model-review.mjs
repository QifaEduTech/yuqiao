import {readFile,stat,realpath,unlink} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {validHandTracking} from '../shared/realtime-result.mjs';
const error=(status,message)=>Object.assign(Error(message),{status});
export async function loadHelpModelReview({db,dataDir,projectRoot,userId}){
  const file=resolve(dataDir,'model-diagnostics/static-palms-v1.json');
  let report;
  try{if((await stat(file)).size>1000000)throw Error('oversized');report=JSON.parse(await readFile(file,'utf8'));}
  catch{throw error(404,'当前账号暂没有可查看的误判复盘。');}
  if(report.ownerId!==userId)throw error(404,'当前账号暂没有可查看的误判复盘。');
  const row=db.prepare('SELECT r.media_file,s.active,s.revision,s.source_sha256 FROM records r JOIN sign_samples s ON s.record_id=r.id AND s.user_id=r.user_id WHERE r.id=? AND r.user_id=?').get(report.recordId,userId);
  if(!row||!row.active)throw error(404,'原录像或登记已删除，复盘不可用。');
  if(row.revision!==report.revision||row.source_sha256!==report.sourceSha256)throw error(409,'录像登记已变化，需要重新生成复盘。');
  const mediaRoot=await realpath(resolve(dataDir,'media')),media=await realpath(resolve(mediaRoot,row.media_file));
  if(!media.startsWith(mediaRoot+sep))throw error(409,'原录像路径异常。');
  if(createHash('sha256').update(await readFile(media)).digest('hex')!==report.sourceSha256)throw error(409,'原录像已变化，复盘不可用。');
  const manifest=JSON.parse(await readFile(resolve(projectRoot,'models/help-video-tcn/v1/manifest.json'),'utf8'));
  if(report.modelArtifactSha256!==manifest.artifactSha256)throw error(409,'模型版本已变化，需要重新生成复盘。');
  if(createHash('sha256').update(await readFile(resolve(projectRoot,'models/help-video-tcn/v1/weights.npz'))).digest('hex')!==manifest.artifactSha256)throw error(409,'模型文件校验失败，复盘暂不可用。');
  if(report.motionGuardSourceHash&&createHash('sha256').update(await readFile(resolve(projectRoot,'server/help_tcn_live.py'))).digest('hex')!==report.motionGuardSourceHash)throw error(409,'运动检查已更新，请重新生成复盘。');
  if(!Array.isArray(report.frames)||report.frames.length>400||report.frames.some((f,i)=>!Number.isFinite(f.t)||(i&&f.t<=report.frames[i-1].t)||!validHandTracking(f.tracking)||(f.score!==null&&(!Number.isFinite(f.score)||f.score<0||f.score>1))))throw error(409,'复盘数据异常。');
  // Return no owner identity, disk path or source hashes to the page.
  const {ownerId,sourceSha256,modelArtifactSha256,...view}=report;
  return {...view,mediaUrl:`/api/records/${report.recordId}/media`};
}
export async function removeHelpModelReview(dataDir,recordId){
  const path=resolve(dataDir,'model-diagnostics/static-palms-v1.json');
  let report;try{if((await stat(path)).size>1000000)return;report=JSON.parse(await readFile(path,'utf8'));}catch{return;}
  if(report.recordId===recordId)await unlink(path).catch(e=>{if(e.code!=='ENOENT')throw e;});
}
