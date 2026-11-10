import {forwardRef,useCallback,useEffect,useImperativeHandle,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Box,LoaderCircle} from 'lucide-react';
import {createAnnyRig,extendAnnySkinning,type AnnyRig} from './annyRig';
import {applyFixedMotion,loadFixedMotion,type FixedMotion,type FixedMotionAsset} from './fixedAnnyMotion';
import {fetchFixedPreview,type MotionPreview} from './fixedMotionLibrary';
import {configureAvatarNavigation,positionAvatarView} from './avatarNavigation';
import model from '../../docs/assets/anny-export.json';
import {AppearancePanel} from './AppearancePanel';
import {createAnnyAppearance,type AnnyAppearance} from './annyAppearance';
import {publicAsset} from './assetUrl';

export interface AvatarHandle {resetView:()=>void;cancelMotion:()=>void}
function disposeModel(object:THREE.Object3D){
  object.traverse(node=>{
    if(node instanceof THREE.Mesh){node.geometry.dispose();(Array.isArray(node.material)?node.material:[node.material]).forEach(material=>material.dispose());}
    if(node instanceof THREE.SkinnedMesh)node.skeleton.dispose();
  });
}

/** User-authorized homepage trial playback; this does not upgrade review status. */
const Avatar=forwardRef<AvatarHandle,{preview:MotionPreview|null;learning?:boolean;autoPlay?:boolean;requestId?:number;displayText?:string}>(function Avatar({preview,learning=false,autoPlay=false,requestId=0,displayText},ref){
  const host=useRef<HTMLDivElement>(null),reset=useRef<()=>void>(()=>{});
  const panel=useRef<HTMLElement|null>(null);
  const rig=useRef<AnnyRig|null>(null),generation=useRef(0);
  const appearance=useRef<AnnyAppearance|null>(null);
  const [wardrobeStatus,setWardrobeStatus]=useState<'loading'|'ready'|'error'>('loading');
  const motionRequest=useRef<AbortController|null>(null);
  const autoStarted=useRef('');
  const clock=useRef<{clip:FixedMotion|null;position:number;playing:boolean;rate:number;last:number;uiAt:number}>({clip:null,position:0,playing:false,rate:1,last:0,uiAt:0});
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading');
  const [motion,setMotion]=useState<FixedMotionAsset|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [playing,setPlaying]=useState(false),[position,setPosition]=useState(0),[rate,setRate]=useState(1),[attempt,setAttempt]=useState(0);
  const cancelMotion=useCallback(()=>{
    generation.current++;clock.current.clip=null;clock.current.playing=false;clock.current.position=0;
    motionRequest.current?.abort();motionRequest.current=null;
    rig.current?.idle();setPlaying(false);setPosition(0);setMotion(null);setLoading(false);setError('');
    host.current?.querySelector('canvas')?.setAttribute('aria-label','Anny 数字人，双臂自然下垂，双手与腿留有间距');
  },[]);
  useImperativeHandle(ref,()=>({resetView:()=>reset.current(),cancelMotion}),[cancelMotion]);
  useEffect(()=>{
    const stage=host.current?.closest<HTMLElement>('.stage');
    if(!preview||!panel.current){if(host.current)host.current.style.bottom='';stage?.style.removeProperty('--appearance-bottom');return;}
    const reserve=()=>{if(host.current&&panel.current){const height=panel.current.getBoundingClientRect().height;host.current.style.bottom=`${height+77}px`;stage?.style.setProperty('--appearance-bottom',`${height+85}px`);}};
    reserve();const observer=new ResizeObserver(reserve);observer.observe(panel.current);return()=>observer.disconnect();
  },[preview?.id]);
  useEffect(()=>{
    cancelMotion();if(!preview||state!=='ready')return;
    const epoch=generation.current,controller=new AbortController();motionRequest.current=controller;setLoading(true);
    void fetchFixedPreview(preview,controller.signal).then(asset=>{
      if(epoch!==generation.current||controller.signal.aborted||!rig.current)return;
      clock.current.clip=loadFixedMotion(rig.current,asset);setMotion(asset);setLoading(false);
      host.current?.querySelector('canvas')?.setAttribute('aria-label',`Anny 数字人，${displayText??asset.label}动作试播，内容待核对`);
      const autoKey=`${requestId}:${attempt}:${preview.id}:${preview.version}`;
      if(autoPlay&&!learning&&!document.hidden&&autoStarted.current!==autoKey){
        autoStarted.current=autoKey;
        applyFixedMotion(rig.current,clock.current.clip,0);clock.current.last=performance.now();clock.current.playing=true;setPlaying(true);
      }
    }).catch(caught=>{if(epoch!==generation.current)return;controller.abort();clock.current.clip=null;rig.current?.idle();setLoading(false);setError(caught instanceof Error?caught.message:'动作加载失败，请重试。');});
    return()=>{controller.abort();generation.current++;clock.current.playing=false;clock.current.clip=null;rig.current?.idle();};
  },[preview?.id,preview?.label,preview?.version,preview?.status,state,attempt,cancelMotion,autoPlay,requestId,displayText,learning]);
  const pause=()=>{clock.current.playing=false;setPlaying(false);setPosition(clock.current.position);};
  const play=(restart=false)=>{
    const c=clock.current;if(!c.clip||!rig.current||state!=='ready')return;
    if(restart||c.position>=c.clip.asset.duration)c.position=0;
    applyFixedMotion(rig.current,c.clip,c.position);c.last=performance.now();c.playing=true;setPosition(c.position);setPlaying(true);
  };
  useEffect(()=>{
    const container=host.current!;let disposed=false,animation=0;
    setState('loading');
    let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch{setState('error');return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','Anny 数字人，双臂自然下垂，双手与腿留有间距');
    container.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,1,.01,20);
    const controls=new OrbitControls(camera,renderer.domElement);
    configureAvatarNavigation(controls);
    scene.add(new THREE.HemisphereLight(0xffffff,0x788a83,2.2));
    const key=new THREE.DirectionalLight(0xfff3e3,2.7);key.position.set(-2,3,4);scene.add(key);
    const fill=new THREE.DirectionalLight(0xe0efff,1.4);fill.position.set(3,2,1);scene.add(fill);
    const resize=()=>{
      const {width,height}=container.getBoundingClientRect();if(!width||!height)return;
      renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();
    };
    const frame=()=>{
      resize();
      const half=THREE.MathUtils.degToRad(camera.fov)/2;
      const distance=Math.max(1.85/(2*Math.tan(half)),1.05/(2*Math.tan(half)*camera.aspect))*1.10;
      positionAvatarView(controls,new THREE.Vector3(0,.89,.08+distance),new THREE.Vector3(0,.86,.08));
    };
    reset.current=frame;
    const observer=new ResizeObserver(resize);observer.observe(container);frame();
    const lost=(event:Event)=>{event.preventDefault();if(!disposed){cancelMotion();setState('error');}};
    renderer.domElement.addEventListener('webglcontextlost',lost);
    new GLTFLoader().load(`${publicAsset(model.served_url)}?v=${model.sha256.slice(0,12)}`,gltf=>{
      if(disposed){disposeModel(gltf.scene);return;}
      try{
        let body:THREE.SkinnedMesh|undefined;gltf.scene.traverse(node=>{if(node instanceof THREE.SkinnedMesh)body=node;});
        if(!body)throw Error('Missing Anny skin');
        extendAnnySkinning(body);
        const positions=body.geometry.getAttribute('position');let floor=Infinity;
        for(let i=0;i<positions.count;i++)floor=Math.min(floor,positions.getY(i));
        gltf.scene.position.y=-floor;gltf.scene.updateMatrixWorld(true);
        rig.current=createAnnyRig(gltf.scene,body);
        appearance.current=createAnnyAppearance(rig.current,status=>{if(!disposed){setWardrobeStatus(status);setState(status);}});
        rig.current.ready();scene.add(gltf.scene);frame();
      }catch{gltf.scene.removeFromParent();disposeModel(gltf.scene);setState('error');}
    },undefined,()=>{if(!disposed)setState('error');});
    const visibility=()=>{if(document.hidden){clock.current.playing=false;setPlaying(false);setPosition(clock.current.position);}};
    document.addEventListener('visibilitychange',visibility);
    const render=()=>{
      animation=requestAnimationFrame(render);const c=clock.current,now=performance.now();
      if(c.playing&&c.clip&&rig.current){
        c.position=Math.min(c.clip.asset.duration,c.position+(now-c.last)/1000*c.rate);c.last=now;
        try{applyFixedMotion(rig.current,c.clip,c.position);}catch{c.playing=false;c.clip=null;rig.current.idle();setPlaying(false);setMotion(null);setError('动作播放失败，请重新加载。');}
        if(c.clip&&c.position>=c.clip.asset.duration){c.playing=false;setPlaying(false);setPosition(c.position);}
        if(now-c.uiAt>80){c.uiAt=now;setPosition(c.position);}
      }
      controls.update();renderer.render(scene,camera);
    };render();
    return()=>{disposed=true;generation.current++;clock.current.playing=false;clock.current.clip=null;rig.current=null;cancelAnimationFrame(animation);document.removeEventListener('visibilitychange',visibility);observer.disconnect();controls.dispose();reset.current=()=>{};renderer.domElement.removeEventListener('webglcontextlost',lost);appearance.current?.dispose();disposeModel(scene);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
  },[]);
  const active=motion?.id===preview?.id&&motion?.version===preview?.version?motion:null;
  const current=active?.sequence?.find(s=>position>=s.start&&position<=s.end),next=active?.sequence?.find(s=>position<s.start);
  const word=active?.sequence?(current?current.label:next?`衔接到 ${next.label}`:active.label):active?.label;
  const context=learning?'学习示范':'首页动作';
  return <><div className={`avatar-host ${preview?'with-motion':''}`} ref={host} data-testid="avatar" data-model="anny-makehuman" data-ready={state==='ready'} data-motion-id={active?.id??''} data-playing={playing}>
    {state==='loading'&&<div className="avatar-unavailable" role="progressbar" aria-label="载入 Anny"><LoaderCircle className="spinning" size={28}/><strong>正在载入人物与服装…</strong></div>}
    {state==='error'&&<div className="avatar-unavailable" role="alert"><Box size={36}/><strong>暂时无法显示数字人</strong><span>请刷新重试或检查浏览器硬件加速，其他输入功能仍可使用。</span>{wardrobeStatus==='error'&&<button className="secondary-button" onClick={()=>void appearance.current?.retry()}>重新加载服装</button>}</div>}
  </div>{!learning&&<AppearancePanel wardrobeStatus={wardrobeStatus} disabled={state!=='ready'} onChange={value=>appearance.current?.apply(value)}/>}{preview&&<section ref={panel} className="home-motion-controls" aria-label={learning?'学习动作示范控制':'首页动作试播'}>
    <div className="home-motion-title"><strong>{displayText??preview.label}</strong><span>动作试播 · 待核对</span></div>
    {loading||state==='loading'?<p aria-live="polite">{state==='loading'?'正在载入数字人…':'正在载入动作…'}</p>:error?<><p role="alert">{error}</p><button className="secondary-button" onClick={()=>setAttempt(v=>v+1)}>重新加载动作</button></>:state==='error'?<p>数字人暂不可用，请刷新后重试；文字说明仍可查看。</p>:<>
      <div className="home-motion-progress"><span data-testid={learning?'learning-motion-current':'home-motion-current'}>{position>= (active?.duration??Infinity)?'本段播放结束':playing?(learning?`正在表达：${word}`:'正在播放'):position>0?(learning?`已暂停：${word}`:'已暂停'):'准备就绪，点击播放'}</span><span>{position.toFixed(1)} / {(active?.duration??0).toFixed(1)} 秒</span></div>
      <input aria-label={`${context}进度`} type="range" min="0" max={active?.duration??0} step="0.01" value={position} disabled={!active} onChange={e=>{pause();const t=Number(e.target.value);clock.current.position=t;setPosition(t);if(rig.current&&clock.current.clip)applyFixedMotion(rig.current,clock.current.clip,t);}}/>
      <div className="home-motion-buttons"><button className="primary-button" data-testid={learning?'learning-motion-play':'home-motion-play'} disabled={!active||playing} onClick={()=>play()}>{position>0&&position<(active?.duration??0)?'继续播放':'播放动作'}</button><button className="secondary-button" disabled={!playing} onClick={pause}>暂停动作</button><button className="secondary-button" disabled={!active} onClick={()=>play(true)}>重播动作</button><label>速度<select aria-label={`${context}速度`} value={rate} onChange={e=>{const value=Number(e.target.value);clock.current.rate=value;clock.current.last=performance.now();setRate(value);}}><option value="0.5">半速</option><option value="1">正常</option><option value="1.5">1.5 倍</option></select></label></div>
    </>}
  </section>}</>;
});
export default Avatar;
