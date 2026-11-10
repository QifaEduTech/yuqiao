import catalog from '../../shared/sign-motion-catalog.json';
import type {FixedMotionAsset} from './fixedAnnyMotion';
import {planMotionText,type SequencePreview} from '../../shared/motion-planner.mjs';
import {composeFixedMotion} from '../../shared/compose-fixed-motion.mjs';

export type MotionPreview={id:string;label:string;version:string;status:'authored_unverified';kind?:'fixed'}|SequencePreview;
// Only URL strings are bundled; frame data is fetched after a match and can
// be cancelled/retried without a failed dynamic-module cache entry.
const assets=import.meta.glob<string>('../../shared/sign-motions/anny/*.json',{query:'?url',import:'default',eager:true});

export async function fetchFixedPreview(preview:MotionPreview,signal:AbortSignal):Promise<FixedMotionAsset>{
  if(preview.kind==='sequence'){
    const planned=planMotionText(preview.label);
    if(planned.status!=='sequence'||planned.preview.id!==preview.id||planned.preview.version!==preview.version||planned.preview.duration!==preview.duration||JSON.stringify(planned.preview.steps)!==JSON.stringify(preview.steps)||preview.status!=='authored_unverified')throw Error('整段动作计划已更新，请重新匹配。');
    const sources=new Map<string,FixedMotionAsset>();
    await Promise.all([...new Set(preview.steps.map(s=>s.id))].map(async id=>{
      const entry=catalog.entries.find(e=>e.id===id);if(!entry)throw Error('缺少整段所需动作。');
      sources.set(id,await fetchFixedPreview({id,label:entry.label,version:entry.version,status:'authored_unverified'},signal));
    }));
    if(signal.aborted)throw new DOMException('已取消','AbortError');
    const asset=composeFixedMotion({...planned.preview,basis:'按用户要求，将整句中完整匹配的词库动作按输入顺序串联试播。'},sources);
    asset.authoring.source+=' 此整段仅在浏览器内存生成，不写入固定词典或保存输入文本；词库串联不等于通用手语语法翻译。';
    return asset;
  }
  const entry=catalog.entries.find(item=>item.id===preview.id);
  if(preview.status!=='authored_unverified'||!entry||entry.label!==preview.label||entry.version!==preview.version)throw Error('动作版本已更新或不可用，请重新提交文字匹配。');
  const url=assets[`../../shared/sign-motions/${entry.asset}`];if(!url)throw Error('动作资源暂不可用，请重新匹配。');
  const response=await fetch(url,{signal,headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('动作加载失败，请重试。');
  const asset:FixedMotionAsset=await response.json();
  if(asset.id!==entry.id||asset.label!==entry.label||asset.version!==entry.version)throw Error('动作资源版本不一致，请刷新后重试。');
  return asset;
}
