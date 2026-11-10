import {useRef,useState} from 'react';
import Avatar,{type AvatarHandle} from './Avatar';
import motions from '../../shared/sign-motion-catalog.json';
import dictionary from '../../shared/sign-dictionary.json';
export default function LearningPreview(){
 const requested=new URLSearchParams(location.search).get('motion');
 const [id,setId]=useState(motions.entries.some(m=>m.id===requested)?requested!:motions.entries[0].id);
 const avatar=useRef<AvatarHandle>(null),motion=motions.entries.find(m=>m.id===id)!;
 const entry=dictionary.entries.find(e=>e.id===id);
 return <section className="learning-preview" aria-label="固定动作预览"><h2>固定动作预览</h2><label>选择学习动作<select value={id} onChange={e=>{avatar.current?.cancelMotion();setId(e.target.value);}}>{motions.entries.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label><p>{entry?.description}</p><div className="stage has-home-motion learning-preview-stage"><Avatar ref={avatar} preview={{id:motion.id,label:motion.label,version:motion.version,status:'authored_unverified'}} learning/></div><p className="small-hint">观看示范后在右侧练习；示范内容仍需专业核对。</p></section>;
}
