import {ActionCollectionGuide} from './ActionCollectionGuide';
import {useEffect,useState} from 'react';
import {api} from './api';
import prefixes from '../../shared/sample-numbering.json';
import './samples.css';
import {currentCaptureBatch,newCaptureBatch} from './sampleCaptureBatch';
import development from '../../shared/sign-development-actions.json';

export type LearningSampleDraft={category:string;detail:string;batch:string;performer:string;startSeconds:string;endSeconds:string;complete:boolean;reviewed:boolean};
export const emptyLearningSample=():LearningSampleDraft=>{const category=new URLSearchParams(location.search).get('collect');const action=development.actions.find(a=>a.category===category);return {category:action?.category??'',detail:action?.text??'',batch:'',performer:'本人',startSeconds:'0',endSeconds:'',complete:false,reviewed:false};};
export function LearningSampleFields({draft,onChange,userId,review,duration,disabled}:{draft:LearningSampleDraft;onChange:(draft:LearningSampleDraft)=>void;userId?:string;review:boolean;duration:number;disabled:boolean}){
  const [numbers,setNumbers]=useState<Record<string,string>>({});
  useEffect(()=>{if(userId&&!draft.batch&&!review){const batch=currentCaptureBatch(userId);if(batch)onChange({...draft,batch,reviewed:false});}},[userId]);
  useEffect(()=>{setNumbers({});if(!userId)return;const controller=new AbortController();void api<{nextNumbers:Record<string,string>}>('/api/samples/numbering',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setNumbers(value.nextNumbers);}).catch(()=>{});return()=>controller.abort();},[userId]);
  function change<K extends keyof LearningSampleDraft>(key:K,value:LearningSampleDraft[K]){onChange({...draft,[key]:value,reviewed:key==='reviewed'?Boolean(value):false});}
  const prefix=prefixes[draft.category as keyof typeof prefixes];
  return <section className="sample-registration learning-sample-fields" aria-label="本次练习登记"><h3>本次练习登记 <small>可选</small></h3><p>现在填好，回看后和录像一起保存。忘填也可在“我的记录”补登记。</p>
    <fieldset disabled={disabled}><legend className="sr-only">本次录像的样本信息</legend>
      <label>样本类别<select value={draft.category} onChange={e=>onChange({...draft,category:e.target.value,detail:!draft.detail.trim()||development.actions.some(a=>a.text===draft.detail)?(development.actions.find(a=>a.category===e.target.value)?.text??''):draft.detail,reviewed:false,complete:false})}><option value="">暂不登记（可在记录中补填）</option>{development.actions.filter(a=>a.collectByDefault||a.category===draft.category).map(a=><option key={a.category} value={a.category} disabled={!a.collectByDefault}>完整目标动作（{a.text}{a.collectByDefault?' · 采集中':' · 已归档'}）</option>)}<option value="background">背景／普通活动</option><option value="other">其他／不完整动作</option><option value="uncertain">不确定（排除训练）</option></select></label>
      {draft.category&&<><label>动作名称／实际内容说明<input maxLength={100} value={draft.detail} onChange={e=>change('detail',e.target.value)} placeholder="例如：谢谢、纯空手背景、保持点赞"/></label>
        {draft.category==='help'&&<p>帮助采集：双手掌心向外，向前拍动两下，保留完整过程和前后自然停顿。帮助已接入录像复核与实时试用，保存不自动识别。识别时自动比较已支持的四个动作，无需选择模型。<a href="/anny-review.html?motion=csl.ref.bmcx.1900&amp;version=source-reference-1" target="_blank" rel="noreferrer">查看帮助动作参考</a></p>}
        {['need','me','please'].includes(draft.category)&&<ActionCollectionGuide category={draft.category}/>}
        {draft.category==='thanks'&&<p>本轮按你的动作定义采集：谢谢不固定拇指弯曲次数，保留完整表达过程。次数不同仍登记为谢谢；只保持点赞、不做弯曲的样本选其他动作。</p>}
        <p data-testid="practice-number-preview">{numbers[draft.category]?`预计编号 ${numbers[draft.category]}，保存后确定`:`保存后自动分配 ${prefix} 类编号`}</p>
        <details><summary>采集信息（通常不用改）</summary><label>使用者代号<input maxLength={40} value={draft.performer} onChange={e=>change('performer',e.target.value)}/></label><label>采集批次<input maxLength={40} value={draft.batch} onChange={e=>change('batch',e.target.value)} placeholder="按录像保存日期自动归组"/></label><button type="button" className="secondary-button" disabled={!userId||review} onClick={()=>{if(userId)change('batch',newCaptureBatch(userId));}}>开始新一轮采集</button><p>同一轮只点一次，后续用重新录制继续。真正更换拍摄时段或环境后，再开启新一轮。</p></details>
        {review?<><div className="sample-times"><label>起始秒<input type="number" min="0" step="0.1" value={draft.startSeconds} onChange={e=>change('startSeconds',e.target.value)}/></label><label>结束秒<input type="number" min="0" max={duration} step="0.1" value={draft.endSeconds||String(duration)} onChange={e=>change('endSeconds',e.target.value)}/></label></div>
          <label className="sample-check"><input type="checkbox" checked={draft.complete} onChange={e=>change('complete',e.target.checked)}/>这段内容完整，没有截断（完整目标动作必须勾选）</label>
          <label className="sample-check"><input type="checkbox" checked={draft.reviewed} onChange={e=>change('reviewed',e.target.checked)}/>我已回看原片并核对标签，同意随录像保存试采登记</label></>:<p>录完后再确认动作范围和完整性。填写本身不会保存或用于训练。</p>}
      </>}
    </fieldset>
  </section>;
}
