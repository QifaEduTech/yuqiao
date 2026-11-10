import {useRef,useState} from 'react';
import {BookOpen,RotateCcw,X} from 'lucide-react';
import Avatar,{type AvatarHandle} from './Avatar';
import type {MotionPreview} from './fixedMotionLibrary';
import dictionary from '../../shared/sign-dictionary.json';
import realtimeTargets from '../../shared/realtime-targets.json';
const recognition={entries:Object.values(realtimeTargets).map(t=>({id:t.signId,text:t.text}))};
import motions from '../../shared/sign-motion-catalog.json';
import './learning-dictionary.css';

/** Recognition, dictionary entries and fixed animation assets are separate lists.
 * Manual browsing never changes the model candidate or the speech text. */
export function LearningDictionary({candidate}:{candidate:string|null}){
  const recognizedId=recognition.entries.find(e=>e.text===candidate)?.id??'';
  const [manualId,setManualId]=useState<string|null>(null),[showDemo,setShowDemo]=useState(false),[browse,setBrowse]=useState(false);
  const [lookupQuery,setLookupQuery]=useState('');
  const avatar=useRef<AvatarHandle>(null);
  const selectedId=manualId??recognizedId;
  const entry=dictionary.entries.find(e=>e.id===selectedId);
  const motion=entry&&motions.entries.find(e=>e.id===entry.id&&e.label===entry.text);
  const preview:MotionPreview|null=motion?{id:motion.id,label:motion.label,version:motion.version,status:'authored_unverified'}:null;
  const recognitionSupported=entry&&recognition.entries.some(e=>e.id===entry.id);
  const matchingEntries=dictionary.entries.filter(e=>e.text.includes(lookupQuery.trim()));
  const lookupEntries=matchingEntries.slice(0,100);
  if(entry&&!lookupEntries.some(e=>e.id===entry.id))lookupEntries.unshift(entry);
  function select(id:string|null){avatar.current?.cancelMotion();setShowDemo(false);setManualId(id);}
  return <section className="learning-dictionary" aria-label="词典与动作对照" aria-live="off" data-word-id={entry?.id??''}>
    <div className="dictionary-compare-heading"><BookOpen size={18}/><h4>词典与动作对照</h4></div>
    {manualId!==null?<p className="dictionary-origin">手动查阅，不改变识别结果。{candidate&&<>原候选仍为“{candidate}”。</>}</p>:candidate?<p className="dictionary-origin">根据本次候选“{candidate}”查阅参考。</p>:<p className="dictionary-origin">本次没有可靠候选。你可以手动查词对照，不会自动补成识别结果。</p>}
    {entry?<>
      <h5 className="dictionary-word">{entry.text}<span>参考动作 · 待核对</span></h5>
      <p className="dictionary-description">{entry.description||'此词已登记外部来源，动作说明待补充核对。'}</p>
      {'referenceMaterial' in entry&&entry.referenceMaterial&&<p className="dictionary-support">外部来源动作解释，供核对参考。{'sourceUrl' in entry&&typeof entry.sourceUrl==='string'&&<a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">查看原站词条 ↗</a>}</p>}
      {'referenceOnly' in entry&&entry.referenceOnly&&<p className="dictionary-support">外部词典来源索引，供核对参考。{'sourceUrl' in entry&&typeof entry.sourceUrl==='string'&&<a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">查看原站词条 ↗</a>}</p>}
      {!recognitionSupported&&<p className="dictionary-support">此词可查阅，但不在当前四词识别范围内。</p>}
      <details className="dictionary-provenance"><summary>来源与核对状态</summary><p>{entry.source}</p><p>现有说明和人物示范尚未完成专业标准校验，不能据此判断你的动作完全正确。</p>{entry.note&&<p>{entry.note}</p>}<small>词典更新：{dictionary.updated}{motion&&<> · 示范版本：{motion.version}</>}</small></details>
      {preview?<>
        <button type="button" className="secondary-button dictionary-demo-toggle" aria-expanded={showDemo} onClick={()=>{if(showDemo)avatar.current?.cancelMotion();setShowDemo(v=>!v);}}>{showDemo?<><X size={16}/>收起人物示范</>:<>查看“{entry.text}”人物示范</>}</button>
        {showDemo&&<div className="stage has-home-motion learning-motion-stage" aria-label={`${entry.text}人物示范`}>
          <div className="stage-topline"><span className="stage-label">人物示范 · {entry.text}</span><span className="stage-badge">待核对</span></div>
          <Avatar key={entry.id} ref={avatar} preview={preview} learning/>
          <div className="stage-bottomline"><span>左键旋转 · 右键平移 · 滚轮缩放</span><button type="button" className="icon-button" aria-label="恢复示范正面视角" onClick={()=>avatar.current?.resetView()}><RotateCcw size={16}/></button></div>
        </div>}
      </>:<p className="dictionary-support">这个词还没有独立人物示范，可以先查看文字说明。</p>}
    </>:candidate&&manualId===null?<p className="dictionary-support">对应词典条目暂不可用，可以手动查阅其他词；不会改播别的动作。</p>:null}
    <div className="dictionary-lookup">
      <button type="button" className="text-button" aria-expanded={browse||!entry} onClick={()=>setBrowse(v=>!v)}>{candidate?'想对照其他词？':'手动查词对照'}</button>
      {(browse||!entry)&&<>{dictionary.entries.length>100&&<label>查找参考词条<input aria-label="查找参考词条" type="search" value={lookupQuery} onChange={e=>setLookupQuery(e.target.value)} placeholder="输入词名，缩小查找范围"/><small>匹配 {matchingEntries.length} 条，最多列出100条；查阅不改变识别结果。</small></label>}<label>选择参考词条<select aria-label="选择参考词条" value={manualId??recognizedId} onChange={e=>select(e.target.value)}><option value="">请选择，不会自动填写识别结果</option>{lookupEntries.map(e=><option key={e.id} value={e.id}>{e.text}{'referenceOnly' in e&&e.referenceOnly?'（仅来源索引）':'referenceMaterial' in e&&e.referenceMaterial?'（解释参考）':recognition.entries.some(r=>r.id===e.id)?'':'（仅查阅）'}</option>)}</select></label></>}
      {manualId!==null&&recognizedId&&<button type="button" className="text-button" onClick={()=>select(null)}>返回候选词“{candidate}”</button>}
    </div>
  </section>;
}
