import {useEffect,useRef,useState} from 'react';
import {Shirt,X} from 'lucide-react';
import {appearanceKey,defaultAppearance,hairColors,outfitColors,readAppearance,sanitizeAppearance,type Appearance} from './annyAppearance';
import {eyeColors,skinTone} from './annyFace';
import './appearance.css';

export function AppearancePanel({onChange,disabled=false,wardrobeStatus='loading'}:{onChange:(value:Appearance)=>void;disabled?:boolean;wardrobeStatus?:'loading'|'ready'|'error'}){
  const [value,setValue]=useState(readAppearance),[open,setOpen]=useState(false),[warning,setWarning]=useState('');
  const button=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLElement>(null),change=useRef(onChange);change.current=onChange;
  useEffect(()=>{
    const sync=(event:StorageEvent)=>{if(event.key===appearanceKey||event.key===null){const next=readAppearance();setValue(next);change.current(next);}};
    window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
  },[]);
  useEffect(()=>{if(open)dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();},[open]);
  const close=()=>{setOpen(false);button.current?.focus();};
  function update(patch:Partial<Appearance>){
    const next=sanitizeAppearance({...value,...patch});setValue(next);onChange(next);
    try{localStorage.setItem(appearanceKey,JSON.stringify(next));setWarning('');}catch{setWarning('本次外观已应用，浏览器未允许保存，下次打开可能恢复原外观。');}
  }
  return <div className="appearance-control">
    {open&&<section ref={dialog} className="appearance-panel" role="dialog" aria-label="人物外观" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close();}}}>
      <header><div><strong>人物外观</strong><small>简单穿搭，让双手清楚可见</small></div><button type="button" aria-label="关闭人物外观" onClick={close}><X size={18}/></button></header>
      <fieldset><legend>性别风格</legend><div className="appearance-options">{([['male','男性穿搭'],['female','女性穿搭']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={value.gender===id} onClick={()=>update({gender:id})}>{label}</button>)}</div><p className="appearance-explainer">切换对应服装，暂沿用当前人物体型。</p></fieldset>
      <p>{value.gender==='male'?'休闲 T 恤＋深色长裤':'红色复古短袖＋深色长裤'}</p>
      {wardrobeStatus!=='ready'&&<p role="status">{wardrobeStatus==='loading'?'正在载入完整服装…':'服装加载失败，人物暂不显示。'}</p>}
      <fieldset><legend>肤色</legend><div className="appearance-options"><span className="appearance-fixed"><i style={{background:skinTone}}/>自然暖黄</span></div></fieldset>
      <fieldset><legend>眼睛颜色</legend><div className="appearance-options">{Object.entries(eyeColors).map(([id,item])=><button key={id} type="button" aria-pressed={value.eyes===id} onClick={()=>update({eyes:id as Appearance['eyes']})}><i style={{background:item.color}}/>{item.label}眼</button>)}</div></fieldset>
      <fieldset><legend>眉毛与唇色</legend><div className="appearance-options">{([['natural','自然细节'],['soft','柔和细节']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={value.face===id} onClick={()=>update({face:id})}>{label}</button>)}</div></fieldset>
      {value.garment!=='vintage'?<fieldset><legend>上衣色调 · 搭配深色长裤</legend><div className="appearance-options">{Object.entries(outfitColors).map(([id,item])=><button key={id} type="button" aria-pressed={value.outfit===id} onClick={()=>update({outfit:id as Appearance['outfit']})}><i style={{background:item.top}}/>{item.label}</button>)}</div></fieldset>:<p>复古短袖保留原版红色，搭配深色长裤。</p>}
      <fieldset><legend>发型</legend><div className="appearance-options">{([['crop','利落短发'],['sweep','侧分短发'],['bun','束发髻']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={value.hair===id} onClick={()=>update({hair:id})}>{label}</button>)}</div></fieldset>
      <fieldset><legend>发色</legend><div className="appearance-options">{Object.entries(hairColors).map(([id,item])=><button key={id} type="button" aria-pressed={value.hairColor===id} onClick={()=>update({hairColor:id as Appearance['hairColor']})}><i style={{background:item.color}}/>{item.label}</button>)}</div></fieldset>
      <footer><span>始终保留上衣与长裤 · 外观保存在本机</span><button type="button" onClick={()=>update(defaultAppearance)}>恢复默认外观</button></footer>
      <a className="appearance-source" href="/avatar-wardrobe/credits.html" target="_blank" rel="noreferrer">开源服装作者与许可</a>
      {warning&&<p role="status">{warning}</p>}
    </section>}
    <button type="button" ref={button} className="appearance-trigger" disabled={disabled} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Shirt size={16}/>人物外观</button>
  </div>;
}
