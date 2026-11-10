/// <reference types="vite/client" />
import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createAnnyRig,extendAnnySkinning,type AnnyRig} from './annyRig';
import {configureAvatarNavigation,positionAvatarView} from './avatarNavigation';
import {loadFixedMotion,applyFixedMotion,type FixedMotion,type FixedMotionAsset} from './fixedAnnyMotion';
import motionCatalog from '../../shared/sign-motion-catalog.json';
import report from '../../docs/assets/anny-export.json';
import {AppearancePanel} from './AppearancePanel';
import {createAnnyAppearance,type AnnyAppearance} from './annyAppearance';
import './styles.css';
import './anny-review.css';

type View='body'|'hands'|'face';
type Action='idle'|'fingers'|'expression'|'jaw'|'motion';
const fixedAssets=import.meta.glob<FixedMotionAsset>('../../shared/sign-motions/anny/*.json',{eager:true,import:'default'});
const previewRequest=new URLSearchParams(window.location.search);
const requestedMotion=previewRequest.get('motion');
const requestedVersion=previewRequest.get('version');
function disposeScene(scene:THREE.Object3D) {
  scene.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry.dispose();(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>m.dispose());if(object instanceof THREE.SkinnedMesh)object.skeleton.dispose();}});
}
function Review(){
  const host=useRef<HTMLDivElement>(null);
  const appearance=useRef<AnnyAppearance|null>(null);
  const [wardrobeStatus,setWardrobeStatus]=useState<'loading'|'ready'|'error'>('loading');
  const runtime=useRef<{rig:AnnyRig;camera:THREE.PerspectiveCamera;controls:OrbitControls}|null>(null);
  const [status,setStatus]=useState('正在载入 Anny…');
  const [error,setError]=useState('');
  const [loaded,setLoaded]=useState(false);
  const [view,setView]=useState<View>('body');
  const [action,setAction]=useState<Action>('idle');
  const actionRef=useRef<Action>('idle');
  const [verdict,setVerdict]=useState('');
  const compiled=useRef<FixedMotion|null>(null);
  const [selectedMotion,setSelectedMotion]=useState(requestedMotion??motionCatalog.entries[0]?.id??'');
  const [motion,setMotion]=useState<FixedMotionAsset|null>(null);
  const [referenceError,setReferenceError]=useState('');
  const [referenceEpoch,setReferenceEpoch]=useState(0);
  const [motionTime,setMotionTime]=useState(0);
  const playback=useRef({playing:false,position:0,last:0,rate:1,uiAt:0});
  const [playing,setPlaying]=useState(false);
  const stopMotion=()=>{playback.current.playing=false;setPlaying(false);};
  const frame=(next:View)=>{
    const current=runtime.current;if(!current)return;
    const {rig,camera,controls}=current;
    const center=new THREE.Vector3();let width=1.0,height=1.8;
    if(next==='hands'){
      const a=rig.world('wrist.L'),b=rig.world('wrist.R');center.copy(a).add(b).multiplyScalar(.5);center.y-=.015;center.z+=.04;
      width=a.distanceTo(b)+.28;height=Math.abs(a.y-b.y)+.42;
    }else if(next==='face'){
      center.copy(rig.world('head'));center.y+=.025;center.z+=.035;width=.34;height=.38;
    }else{center.set(0,.86,0);width=1.25;height=1.85;}
    const half=THREE.MathUtils.degToRad(camera.fov)/2;
    const distance=Math.max(height/(2*Math.tan(half)),width/(2*Math.tan(half)*camera.aspect))*1.12;
    positionAvatarView(controls,new THREE.Vector3(center.x,center.y+.025,center.z+distance),center);
  };
  useEffect(()=>{
    if(!host.current)return;
    const container=host.current;let disposed=false,raf=0;
    const scene=new THREE.Scene();scene.background=new THREE.Color('#e9eeeb');
    const camera=new THREE.PerspectiveCamera(32,1,.01,40);
    let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true});}catch{setError('无法开启 3D 预览，请检查浏览器硬件加速。');return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','Anny 数字人三维预览');
    const controls=new OrbitControls(camera,renderer.domElement);configureAvatarNavigation(controls);
    scene.add(new THREE.HemisphereLight(0xffffff,0x76857c,2.3));
    const light=new THREE.DirectionalLight(0xfff1de,3.0);light.position.set(2,3,4);scene.add(light);
    const fill=new THREE.DirectionalLight(0xd9e8ff,1.5);fill.position.set(-2,2,-2);scene.add(fill);
    const floor=new THREE.Mesh(new THREE.CircleGeometry(1.2,64),new THREE.MeshStandardMaterial({color:0xdbe3df,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.006;scene.add(floor);
    const resize=new ResizeObserver(()=>{const {width,height}=container.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();});resize.observe(container);
    new GLTFLoader().load(report.served_url,gltf=>{
      if(disposed){disposeScene(gltf.scene);return;}
      try{
        let mesh:THREE.SkinnedMesh|undefined;gltf.scene.traverse(o=>{if(o instanceof THREE.SkinnedMesh)mesh=o;});
        if(!mesh)throw new Error('导出文件缺少蒙皮网格。');
        extendAnnySkinning(mesh);
        const base=mesh.geometry.getAttribute('position');let minimum=Infinity;
        for(let i=0;i<base.count;i++)minimum=Math.min(minimum,base.getY(i));
        gltf.scene.position.y=-minimum;gltf.scene.updateMatrixWorld(true);
        const rig=createAnnyRig(gltf.scene,mesh);appearance.current=createAnnyAppearance(rig,status=>{if(!disposed){setWardrobeStatus(status);setLoaded(status==='ready');setError(status==='error'?'服装加载失败，人物暂不显示。':'');}});
        rig.ready();scene.add(gltf.scene);runtime.current={rig,camera,controls};
        (window as unknown as Record<string,unknown>).__annyPreview={rig,renderer,camera,controls,scene,appearance:appearance.current};
        frame('body');setStatus('Anny · 可自由旋转、平移与缩放');
      }catch(e){gltf.scene.removeFromParent();disposeScene(gltf.scene);setError(e instanceof Error?e.message:'模型初始化失败。');}
    },undefined,()=>{if(!disposed)setError('模型载入失败，请刷新后重试。');});
    const render=()=>{
      raf=requestAnimationFrame(render);const rig=runtime.current?.rig;
      if(rig){
        const amount=(Math.sin(performance.now()/550)+1)/2;
        if(actionRef.current==='fingers')rig.fingers(amount);
        if(actionRef.current==='expression'){
          rig.previewExpression(amount);
        }
        if(actionRef.current==='jaw'){
          const bone=rig.bones.jaw;bone.quaternion.copy(rig.rest.jaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),amount*.22));
        }
        if(actionRef.current==='motion'&&compiled.current){
          const clock=playback.current,now=performance.now();
          const [start,end]=compiled.current.activeSpan,duration=end-start;
          if(clock.playing){clock.position=Math.min(duration,clock.position+(now-clock.last)/1000*clock.rate);clock.last=now;}
          try{applyFixedMotion(rig,compiled.current,start+clock.position);}catch(e){clock.playing=false;setPlaying(false);actionRef.current='idle';rig.ready();setReferenceError(e instanceof Error?e.message:'动作播放失败。');}
          if(clock.position>=duration&&clock.playing){clock.playing=false;setPlaying(false);setStatus(`“${compiled.current.asset.label}”播放完成 · 动作待核对`);}
          if(now-clock.uiAt>100){clock.uiAt=now;setMotionTime(clock.position);}
        }
      }
      controls.update();renderer.render(scene,camera);
    };render();
    return()=>{disposed=true;cancelAnimationFrame(raf);resize.disconnect();controls.dispose();appearance.current?.dispose();disposeScene(scene);renderer.dispose();renderer.domElement.remove();runtime.current=null;appearance.current=null;delete (window as unknown as Record<string,unknown>).__annyPreview;};
  },[]);
  useEffect(()=>{
    if(!loaded||!runtime.current)return;
    stopMotion();compiled.current=null;setMotion(null);setReferenceError('');playback.current.position=0;setMotionTime(0);
    try{
      if(previewRequest.getAll('motion').length>1||previewRequest.getAll('version').length>1||requestedVersion!==null&&requestedMotion===null)throw new Error('预览链接不完整，请回首页重新匹配动作。');
      const entry=motionCatalog.entries.find(item=>item.id===selectedMotion);
      if(!entry)throw new Error('没有找到指定的固定动作，不会改为播放其他动作。');
      if(requestedMotion===selectedMotion&&requestedVersion!==null&&entry.version!==requestedVersion)throw new Error('这个动作的版本已更新，请回首页重新匹配后预览。');
      const asset=entry&&fixedAssets[`../../shared/sign-motions/${entry.asset}`];
      if(!entry||!asset||asset.id!==entry.id||asset.label!==entry.label||asset.version!==entry.version)throw new Error('固定动作资源缺失或版本不匹配。');
      compiled.current=loadFixedMotion(runtime.current.rig,asset);setMotion(asset);
      setStatus(`已载入固定动作“${asset.label}” · 待核对`);setVerdict('');
      (window as unknown as Record<string,unknown>).__annyFixedMotion=compiled.current;
    }catch(error){setReferenceError(error instanceof Error?error.message:'固定动作加载失败。');}
    return()=>{compiled.current=null;delete (window as unknown as Record<string,unknown>).__annyFixedMotion;};
  },[loaded,referenceEpoch,selectedMotion]);
  const selectAction=(next:Action)=>{
    stopMotion();
    const chosen=action===next?'idle':next;runtime.current?.rig.ready();actionRef.current=chosen;setAction(chosen);
    setStatus(chosen==='idle'?'已恢复自然站姿，双臂下垂':'正在循环演示关节或表情 · 非手语动作');
  };
  const playMotion=()=>{
    const clip=compiled.current;if(!clip)return;
    runtime.current?.rig.ready();setAction('motion');actionRef.current='motion';setReferenceError('');
    const clock=playback.current;if(clock.position>=clip.activeSpan[1]-clip.activeSpan[0])clock.position=0;
    clock.last=performance.now();clock.playing=true;setPlaying(true);setStatus(`正在播放固定动作“${clip.asset.label}” · 待核对`);
  };
  return <main className="anny-page">
    <header className="anny-header"><a href="/">← 返回语桥</a><a href="/sign-dictionary.html">手语词典</a><a href="/">主页面数字人空间</a></header>
    <div className="anny-layout"><section className="anny-stage">
      <div className="anny-viewport-wrap"><div className="anny-viewport" ref={host}/><AppearancePanel wardrobeStatus={wardrobeStatus} disabled={!loaded} onChange={value=>appearance.current?.apply(value)}/></div>
      <p className={error?'anny-status error':'anny-status'} role="status">{error||(wardrobeStatus==='loading'?'正在载入人物与服装…':status)}</p>{wardrobeStatus==='error'&&<button className="secondary-button" onClick={()=>void appearance.current?.retry()}>重新加载服装</button>}
      <div className="anny-toolbar" aria-label="观察视角">{([['body','全身'],['hands','手指特写'],['face','面部特写']] as const).map(([value,label])=><button key={value} data-view={value} aria-pressed={view===value} disabled={!loaded} onClick={()=>{setView(value);frame(value);}}>{label}</button>)}<button disabled={!loaded} onClick={()=>{setView('body');frame('body');}}>重置视角</button></div>
      <div className="anny-toolbar" aria-label="关节自检"><button disabled={!loaded} aria-pressed={action==='fingers'} onClick={()=>selectAction('fingers')}>手指开合</button><button disabled={!loaded} aria-pressed={action==='expression'} onClick={()=>selectAction('expression')}>眉眼与嘴部表情</button><button disabled={!loaded} aria-pressed={action==='jaw'} onClick={()=>selectAction('jaw')}>下颌骨自检</button><button disabled={!loaded} onClick={()=>{stopMotion();playback.current.position=0;setMotionTime(0);actionRef.current='idle';setAction('idle');runtime.current?.rig.ready();frame(view);setStatus('已恢复自然站姿，双臂下垂');}}>复位</button></div>
      <p className="anny-hint">左键拖动旋转，右键拖动上下／左右平移，滚轮缩放。触屏可单指旋转、双指平移或缩放。特写按钮仅用于快速定位，之后仍可自由拖动；“重置视角”恢复全身正面，不打断动作。</p>
    </section><aside className="anny-details"><span className="section-kicker">当前路线 · ANNY</span><h1>固定动作库</h1><p>选择已经制作好的动作，直接播放。无需登录、录制或选择参考视频。</p>
      <section className="anny-motion-panel" aria-label="固定动作预览">
        <div><span className="section-kicker">固定动画 · 待核对</span><h2>{motion?.label??(referenceError?'动作不可用':'正在载入动作…')}</h2><p>{motion?.description}</p></div>
        {motion?.sequence&&<div aria-label="连续动作顺序"><p>{motion.sequence.map(s=>s.label).join(' → ')}</p><p data-testid="sequence-current">{(()=>{const active=motion.sequence.find(s=>motionTime>=s.start&&motionTime<=s.end);const next=motion.sequence.find(s=>motionTime<s.start);return active?`当前片段：${active.label}`:next?`衔接到：${next.label}`:'整段结束';})()}</p></div>}
        {motionCatalog.entries.length>1&&<label>选择动作 <select aria-label="选择固定动作" value={selectedMotion} onChange={e=>{stopMotion();actionRef.current='idle';setAction('idle');runtime.current?.rig.ready();setSelectedMotion(e.target.value);}}>{motionCatalog.entries.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
        {motion&&<div className="anny-source-layout"><div><label>动作进度 <input type="range" aria-label="动作进度" min="0" max={motion.duration} step="0.01" value={motionTime} onChange={e=>{stopMotion();runtime.current?.rig.ready();actionRef.current='motion';setAction('motion');playback.current.position=Number(e.target.value);setMotionTime(Number(e.target.value));}}/></label><p>{motionTime.toFixed(2)} / {motion.duration.toFixed(2)} 秒</p><div className="anny-toolbar"><button disabled={!loaded||playing} data-testid="motion-play" onClick={playMotion}>{playing?'正在播放':`播放“${motion.label}”`}</button><button disabled={!playing} onClick={stopMotion}>暂停动作</button><button onClick={()=>{playback.current.position=0;setMotionTime(0);playMotion();}}>重播动作</button><label>速度 <select aria-label="动作播放速度" defaultValue="1" onChange={e=>{playback.current.rate=Number(e.target.value);}}><option value="1">正常</option><option value="0.5">半速</option><option value="1.5">1.5 倍</option></select></label></div></div></div>}
        {referenceError&&<p role="alert">{referenceError}</p>}
        {referenceError&&<button onClick={()=>{stopMotion();actionRef.current='idle';setAction('idle');runtime.current?.rig.ready();setReferenceEpoch(v=>v+1);}}>重新加载动作</button>}
        {referenceError&&<p><a href="/">返回首页重新匹配</a> · <a href="/anny-review.html">查看当前固定动作库</a></p>}
        <p className="anny-hint">本版按你描述的动作制作，手形与节奏待核对，仅用于独立预览。</p>
      </section>
      <dl><div><dt>全身骨骼</dt><dd>{report.bones}</dd></div><div><dt>手指关节</dt><dd>{report.fingerJoints} 节</dd></div><div><dt>手部完整骨链</dt><dd>{report.handChainBones} 根</dd></div><div><dt>面部骨骼</dt><dd>{report.facialBones} 根</dd></div><div><dt>表情通道</dt><dd>{report.facialActions}</dd></div><div><dt>模型大小</dt><dd>{(report.bytes/1048576).toFixed(1)} MB</dd></div></dl>
      <div className="anny-note"><strong>动作核对</strong><p>{motion?.authoring.basis??'请选择动作，查看具体制作依据。'}</p><p>请核对手形、位置、方向、先后顺序与次数；动作仍待内容校验。</p></div>
      <div className="anny-toolbar"><button disabled={!loaded} onClick={()=>setVerdict('本页已标记动作符合描述，请在聊天里说明核对结果；不会自动变更标准校验状态。')}>动作符合描述</button><button disabled={!loaded} onClick={()=>setVerdict('请在聊天里指出需要调整的外观或关节。')}>需要调整</button></div><p aria-live="polite">{verdict}</p>
      <p className="anny-license">核心人体数据 CC0 · Anny 代码 Apache-2.0<br/><a href={report.source} target="_blank" rel="noreferrer">查看开源来源</a></p><p className="anny-hint">Anny 已用于主页面；此处的未校验动作仍仅作预览。</p>
    </aside></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Review/>);
