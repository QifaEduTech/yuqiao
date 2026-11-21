import {useMemo,useState} from 'react';
import Avatar from './Avatar';
import dictionary from '../../shared/sign-dictionary.json';
import catalog from '../../shared/sign-motion-catalog.json';
import {planMotionText} from '../../shared/motion-planner.mjs';
import type {MotionPreview} from './fixedMotionLibrary';
export default function MobileDictionary(){
 const [query,setQuery]=useState(''),[category,setCategory]=useState(''),[page,setPage]=useState(0),[preview,setPreview]=useState<MotionPreview|null>(null),[request,setRequest]=useState(0);
 const categories=useMemo(()=>[...new Set(dictionary.entries.map(e=>e.category).filter(Boolean))],[]);
 const matches=useMemo(()=>dictionary.entries.filter(e=>(!query.trim()||e.text.includes(query.trim()))&&(!category||e.category===category)),[query,category]);
 const pages=Math.max(1,Math.ceil(matches.length/10)),index=Math.min(page,pages-1),entries=matches.slice(index*10,index*10+10);
 function play(text:string){const plan=planMotionText(text);setPreview(plan.status==='sequence'?plan.preview:plan.status==='single'?{id:plan.entry.id,label:plan.entry.label,version:plan.entry.version,status:'authored_unverified'}:null);setRequest(n=>n+1);}
 return <section className="mobile-dictionary"><div className="mobile-section-title"><h1>手语词典</h1><p>查找词语和动作说明</p></div><label>搜索词语<input type="search" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);setPreview(null);}}/></label><label>分类<select value={category} onChange={e=>{setCategory(e.target.value);setPage(0);setPreview(null);}}><option value="">全部分类</option>{categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>{preview&&<div className="stage has-home-motion"><Avatar preview={preview} autoPlay requestId={request} displayText={preview.label}/></div>}<div className="mobile-dictionary-list">{entries.map(entry=><article key={entry.id}><h2>{entry.text}</h2><p>{entry.description||'暂无动作说明'}</p>{catalog.entries.some(m=>m.id===entry.id)&&<button className="text-button" onClick={()=>play(entry.text)}>播放动作</button>}</article>)}</div>{!entries.length&&<p>没有找到这个词语。</p>}<div className="mobile-dictionary-pager"><button disabled={index===0} onClick={()=>{setPage(index-1);setPreview(null);}}>上一页</button><span>{index+1} / {pages}</span><button disabled={index+1>=pages} onClick={()=>{setPage(index+1);setPreview(null);}}>下一页</button></div></section>;
}
