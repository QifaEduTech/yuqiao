import {ActionCollectionGuide} from './ActionCollectionGuide';
import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import './samples.css';
import numberPrefixes from '../../shared/sample-numbering.json';
import development from '../../shared/sign-development-actions.json';

type Draft={category:string;detail:string;batch:string;performer:string;complete:boolean;startSeconds:string;endSeconds:string};
type Sample=Omit<Draft,'startSeconds'|'endSeconds'> & {sampleNumber:string;startSeconds:number;endSeconds:number;sourceSha256:string;excluded:boolean;trainingReady:false;featureStatus:'pending'};
type Snapshot={revision:number;duration:number|null;sample:Sample|null;defaultBatch:string;assignedNumbers:Record<string,string>;nextNumbers:Record<string,string>};
const empty=():Draft=>({category:'',detail:'',batch:'',performer:'本人',complete:false,startSeconds:'0',endSeconds:''});
export function SampleRegistration({recordId}:{recordId:string}){
  const [draft,setDraft]=useState<Draft>(empty),[snapshot,setSnapshot]=useState<Snapshot|null>(null),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reloadRequired,setReloadRequired]=useState(false);
  const epoch=useRef(0),request=useRef<AbortController|null>(null),mounted=useRef(false),source=useRef(Symbol('sample-editor'));
  function adopt(value:Snapshot){
    setSnapshot(value);setDraft(value.sample?{category:value.sample.category,detail:value.sample.detail,batch:value.sample.batch,performer:value.sample.performer,complete:value.sample.complete,startSeconds:String(value.sample.startSeconds),endSeconds:String(value.sample.endSeconds)}:{...empty(),endSeconds:value.duration?String(value.duration):''});setReviewed(false);setReloadRequired(false);
  }
  async function run(method:'GET'|'PUT'|'DELETE'){
    request.current?.abort();const controller=new AbortController(),version=++epoch.current;request.current=controller;setBusy(true);setError('');setNotice('');
    let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},30000);
    try{
      const body=method==='GET'?undefined:JSON.stringify(method==='DELETE'?{revision:snapshot?.revision}:{...draft,startSeconds:Number(draft.startSeconds),endSeconds:Number(draft.endSeconds),reviewed,revision:snapshot?.revision});
      const value=await api<Snapshot>(`/api/records/${recordId}/sample`,{method,body,signal:controller.signal});
      if(!mounted.current||version!==epoch.current)return;
      adopt(value);if(method!=='GET'){setNotice(method==='DELETE'?'已撤回试采登记，原录像仍保留。':`已保存人工登记，样本编号 ${value.sample?.sampleNumber??''}；特征质量待检查，尚未用于训练。`);window.dispatchEvent(new CustomEvent('yuqiao-sample-changed',{detail:{recordId,source:source.current}}));}
    }catch(caught){
      if(!mounted.current||version!==epoch.current)return;
      setError(timedOut?'请求超时，状态尚未确认，请重新载入登记。':caught instanceof Error?caught.message:'登记请求失败，请重试。');
      if(method==='GET'||timedOut||!(caught instanceof ApiError)||caught.status>=500||[0,401,404,409].includes(caught.status))setReloadRequired(true);
    }finally{clearTimeout(timeout);if(mounted.current&&version===epoch.current){request.current=null;setBusy(false);}}
  }
  useEffect(()=>{mounted.current=true;void run('GET');return()=>{mounted.current=false;epoch.current++;request.current?.abort();};},[recordId]);
  useEffect(()=>{const changed=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail.recordId===recordId&&detail.source!==source.current){epoch.current++;request.current?.abort();setBusy(false);setReloadRequired(true);setNotice('');setError('这条登记已在其他位置更新，草稿保留，请重新载入。');}};window.addEventListener('yuqiao-sample-changed',changed);return()=>window.removeEventListener('yuqiao-sample-changed',changed);},[recordId]);
  function change<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(previous=>({...previous,[key]:value}));setReviewed(false);setNotice('');}
  function changeCategory(category:string){setDraft(previous=>({...previous,category,detail:!previous.detail.trim()||development.actions.some(a=>a.text===previous.detail)?(development.actions.find(a=>a.category===category)?.text??''):previous.detail}));setReviewed(false);setNotice('');}
  const editable=!busy&&!reloadRequired&&!!snapshot;
  const valid=editable&&reviewed&&draft.category&&draft.detail.trim()&&draft.performer.trim()&&draft.startSeconds.trim()&&draft.endSeconds.trim()&&Number(draft.startSeconds)>=0&&Number(draft.endSeconds)>Number(draft.startSeconds)&&Number(draft.endSeconds)<=(snapshot?.duration??0)&&(!development.actions.some(a=>a.category===draft.category)||draft.complete);
  const assigned=snapshot?.assignedNumbers?.[draft.category],nextNumber=snapshot?.nextNumbers?.[draft.category];
  const prefix=numberPrefixes[draft.category as keyof typeof numberPrefixes];
  return <details className="sample-registration"><summary>试采样本登记{snapshot?.sample?' · 已登记':''}</summary><section aria-label="试采样本登记表">
    <p>先回看上方录像，再手动登记实际内容。不会根据候选自动打标签；本轮仅准备试采，不启动训练。</p>
    <p className="sample-plan">新动作采集以学习页当前指南为准；已有背景和通过的旧样本不需要重复录制。</p>
    {busy&&<p role="status">正在读取或保存登记…</p>}
    {snapshot?.sample&&<p>当前登记：{snapshot.sample.excluded?'不确定 · 排除训练':'人工已核对 · 特征质量待检查'}。尚未进入训练集。</p>}
    <fieldset disabled={!editable}><legend>原片内容与采集信息</legend>
      <label>样本类别<select value={draft.category} onChange={e=>changeCategory(e.target.value)}><option value="">请选择实际内容</option>{development.actions.filter(a=>a.collectByDefault||a.category===draft.category||snapshot?.assignedNumbers?.[a.category]).map(a=><option key={a.category} value={a.category}>完整目标动作（{a.text}{a.collectByDefault?' · 采集中':' · 历史类别'}）</option>)}<option value="background">背景／普通活动</option><option value="other">其他／不完整动作</option><option value="uncertain">不确定（排除训练）</option></select></label>
      <label>样本编号（自动）<input readOnly data-testid="sample-number" value={assigned??(prefix?`预计 ${nextNumber??prefix+'.…'}，保存后确定`:'选择类别后自动编号')}/></label>
      <p>谢谢26、帮助30、需要31、我32、请33、背景27、其他28、不确定29，各自递增。修改或撤回后重新登记同一录像、同一类别，保留原编号。</p>
      <label>动作名称／实际内容说明<input maxLength={100} value={draft.detail} onChange={e=>change('detail',e.target.value)} placeholder="例如：谢谢；纯空手背景；保持点赞不弯拇指"/></label>
      {draft.category==='help'&&<p>帮助采集：双手掌心向外，向前拍动两下，保留完整过程和前后自然停顿。帮助已接入录像复核与实时试用，保存不自动识别。识别时自动比较已支持的四个动作，无需选择模型。<a href="/anny-review.html?motion=csl.ref.bmcx.1900&amp;version=source-reference-1" target="_blank" rel="noreferrer">查看帮助动作参考</a></p>}
        {['need','me','please'].includes(draft.category)&&<ActionCollectionGuide category={draft.category}/>}
        {draft.category==='thanks'&&<p>本轮按你的动作定义采集：谢谢不固定拇指弯曲次数，保留完整表达过程。不同次数不自动拆成多个词，也不自动标为非常感谢。</p>}
      <details><summary>采集信息（通常不用改）</summary><p>新录像默认按保存日期归组。编号不用手填；采集批次用于之后的数据整理，不是第几个动作。</p><label>采集批次<input maxLength={40} value={draft.batch} onChange={e=>change('batch',e.target.value)} placeholder={snapshot?.defaultBatch??'按录像保存日期自动归组'}/></label><label>使用者代号<input maxLength={40} value={draft.performer} onChange={e=>change('performer',e.target.value)} placeholder="同一位使用者保持同一代号"/></label></details>
      <div className="sample-times"><label>起始秒<input type="number" min="0" step="0.1" value={draft.startSeconds} onChange={e=>change('startSeconds',e.target.value)}/></label><label>结束秒<input type="number" min="0" max={snapshot?.duration??undefined} step="0.1" value={draft.endSeconds} onChange={e=>change('endSeconds',e.target.value)}/></label></div>
      <p>录像登记时长：{snapshot?.duration??'未知'}秒。回看后填写内容起止；时长与特征质量还需后续检查。</p>
      <label className="sample-check"><input type="checkbox" checked={draft.complete} onChange={e=>change('complete',e.target.checked)}/>这段内容完整，没有截断（完整目标动作必须勾选）</label>
      <label className="sample-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>我已回看原片并核对以上标签，同意加入本机私有试采集合</label>
    </fieldset>
    <div className="sample-actions"><button className="secondary-button" disabled={!valid} onClick={()=>void run('PUT')}>{snapshot?.sample?'保存登记修改':'加入试采集合'}</button>{snapshot?.sample&&<button className="text-button" disabled={!editable} onClick={()=>void run('DELETE')}>撤回试采登记</button>}<button className="text-button" disabled={busy} onClick={()=>void run('GET')}>重新载入登记（覆盖草稿）</button></div>
    {error&&<p role="alert" className="notice-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <p>撤回只移除试采登记；删除原录像会同时清理登记。不确定的素材不会用于训练。</p>
  </section></details>;
}
