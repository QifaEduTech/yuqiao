// Offline authoring only: export fixed assets, never solve IK during playback.
import * as THREE from 'three';
import type {AnnyRig} from './annyRig';
import type {FixedMotionAsset} from './fixedAnnyMotion';
import {authorHello, prepareThumbsUp} from './annyAuthoring';
import expressionConfig from '../../shared/anny-expressions.json';

type Pose=Record<string,THREE.Quaternion>;
type Side='L'|'R';
const v=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);
const smooth=(x:number)=>{const a=THREE.MathUtils.clamp(x,0,1);return a*a*(3-2*a);};

function studio(rig:AnnyRig){
  rig.idle();
  const keys=Object.keys(rig.bones).filter(k=>/^(upperarm|lowerarm|wrist|finger)/.test(k));
  const snapshot=():Pose=>Object.fromEntries(keys.map(k=>[k,rig.bones[k].quaternion.clone()]));
  const idle=snapshot();
  const restore=(pose:Pose)=>{for(const k of keys)rig.bones[k].quaternion.copy(pose[k]);rig.scene.updateMatrixWorld(true);};
  const rotate=(name:string,delta:THREE.Quaternion)=>{
    const b=rig.bones[name],world=b.getWorldQuaternion(new THREE.Quaternion()),parent=b.parent!.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(parent.invert().multiply(delta).multiply(world));rig.scene.updateMatrixWorld(true);
  };
  const aim=(name:string,direction:THREE.Vector3,end?:string)=>{
    const b=rig.bones[name],tail=end?rig.world(end):b.localToWorld(new THREE.Vector3().fromArray(b.userData.tail));
    rotate(name,new THREE.Quaternion().setFromUnitVectors(tail.sub(rig.world(name)).normalize(),direction.clone().normalize()));
  };
  const hinge=(side:Side,elbow:THREE.Vector3,wrist:THREE.Vector3)=>{
    const upper=`upperarm01.${side}`,lower=`lowerarm01.${side}`;
    for(const name of [upper,`upperarm02.${side}`,lower,`lowerarm02.${side}`,`wrist.${side}`])rig.bones[name].quaternion.copy(rig.rest[name]);
    rig.scene.updateMatrixWorld(true);
    const axis=elbow.clone().sub(rig.world(upper)).normalize(),target=wrist.clone().sub(elbow).normalize();
    aim(upper,axis,lower);
    const current=rig.world(`wrist.${side}`).sub(rig.world(lower));current.addScaledVector(axis,-current.dot(axis)).normalize();
    const projected=target.clone().addScaledVector(axis,-target.dot(axis)).normalize();
    const roll=Math.atan2(axis.dot(current.clone().cross(projected)),current.dot(projected));
    rotate(upper,new THREE.Quaternion().setFromAxisAngle(axis,roll));
    aim(lower,target,`wrist.${side}`);
  };
  // Two-bone IK with an explicit outward/downward elbow pole; lengths never change.
  const arm=(side:Side,target:THREE.Vector3,poleOverride?:THREE.Vector3)=>{
    const upper=`upperarm01.${side}`,lower=`lowerarm01.${side}`,wrist=`wrist.${side}`;
    const shoulder=rig.world(upper),a=shoulder.distanceTo(rig.world(lower)),b=rig.world(lower).distanceTo(rig.world(wrist));
    const offset=target.clone().sub(shoulder),distance=offset.length();
    if(distance>a+b-.002||distance<Math.abs(a-b)+.002)throw Error(`Unreachable wrist target: ${side} ${distance}`);
    const axis=offset.normalize(),pole=poleOverride?.clone()??v(side==='R'?-1:1,-.65,.15);pole.addScaledVector(axis,-pole.dot(axis)).normalize();
    const along=(a*a-b*b+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,a*a-along*along));
    const elbow=shoulder.clone().addScaledVector(axis,along).addScaledVector(pole,height);
    aim(upper,elbow.sub(shoulder),lower);aim(lower,target.clone().sub(rig.world(lower)),wrist);
  };
  const hand=(side:Side,long:THREE.Vector3,thumbSide:THREE.Vector3)=>{
    const y=rig.world(`finger3-1.${side}`).sub(rig.world(`wrist.${side}`)).normalize();
    const x=rig.world(`finger2-1.${side}`).sub(rig.world(`finger5-1.${side}`));x.addScaledVector(y,-x.dot(y)).normalize();
    const ty=long.clone().normalize(),tx=thumbSide.clone().addScaledVector(ty,-thumbSide.dot(ty)).normalize();
    const q=(a:THREE.Vector3,b:THREE.Vector3)=>new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(a,b,new THREE.Vector3().crossVectors(a,b)));
    rotate(`wrist.${side}`,q(tx,ty).multiply(q(x,y).invert()));
  };
  const fist=(side:Side,except=0)=>{
    for(let i=1;i<=5;i++)rig.finger(side,i,i===except?0:1,{axis:'x',sign:1,angles:i===1?[0,1.1,.9]:[1,1.3,.9]});
  };
  const straight=(side:Side,index:number,direction:THREE.Vector3)=>{rig.finger(side,index,0);for(let j=1;j<=3;j++)aim(`finger${index}-${j}.${side}`,direction);};
  const blend=(a:Pose,b:Pose,t:number):Pose=>Object.fromEntries(keys.map(k=>[k,a[k].clone().slerp(b[k],smooth(t))]));
  const exportClip=(id:string,label:string,duration:number,description:string,basis:string,sample:(t:number)=>Pose):FixedMotionAsset=>{
    const frames=Array.from({length:duration*30+1},(_,i)=>{const t=i/30,pose=sample(t);return {t:Number(t.toFixed(6)),rotations:Object.fromEntries(keys.map(k=>[k,pose[k].toArray().map(n=>Number(n.toFixed(8)))]))};});
    rig.idle();return {schemaVersion:1,kind:'fixed-anny-motion',id,label,rig:'anny-makehuman',version:'user-description-1',status:'authored_unverified',review:'not_reviewed',verifiedBy:null,duration,description,authoring:{basis,source:'用户文字说明；左右手选择、具体位置、角度、节奏和未指定的次数为助手预览参数。表情中性，未经标准手语核验。'},frames};
  };
  return {keys,idle,snapshot,restore,rotate,aim,arm,hand,fist,straight,blend,exportClip,hinge};
}

export function authorYou(rig:AnnyRig):FixedMotionAsset{
  const hello=authorHello(rig),s=studio(rig);
  const point=Object.fromEntries(Object.entries(hello.frames[30].rotations).map(([k,q])=>[k,new THREE.Quaternion().fromArray(q)]));
  return s.exportClip('csl.you','你',3,'右手食指指向对方，停留后回到自然站姿。','一手食指指向对方。',t=>t<.6?s.blend(s.idle,point,t/.6):t>2.2?s.blend(point,s.idle,(t-2.2)/.8):point);
}

export function authorGoodbye(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);s.arm('R',v(-.31,1.4,.17));s.hand('R',v(0,1,.05),v(1,0,0));
  for(let i=1;i<=5;i++)rig.finger('R',i,.08);
  const raised=s.snapshot();
  return s.exportClip('csl.goodbye','再见',4,'右手上举，五指自然伸出，手腕左右挥动两下，再回到自然站姿。','一手上举，五指自然伸出，手腕挥动两下。这是一般的“再见”手势。',t=>{
    if(t<.7)return s.blend(s.idle,raised,t/.7);
    if(t>3.1)return s.blend(raised,s.idle,(t-3.1)/.9);
    s.restore(raised);
    // Two complete left/right cycles with zero velocity at their boundaries.
    if(t>=.9&&t<=2.9){const phase=(t-.9)/2;s.rotate('wrist.R',new THREE.Quaternion().setFromAxisAngle(v(0,0,1),.26*Math.sin(4*Math.PI*phase)*Math.sin(Math.PI*phase)**2));}
    return s.snapshot();
  });
}

export function authorMe(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);s.arm('R',v(-.025,1.2,.335));s.hand('R',v(0,0,-1),v(0,1,0));s.fist('R',2);s.straight('R',2,v(0,0,-1));
  const point=s.snapshot();
  return s.exportClip('csl.me','我',3,'右手食指指向自己的胸前，停留后回到自然站姿。','一手食指指自己。',t=>t<.7?s.blend(s.idle,point,t/.7):t>2.2?s.blend(point,s.idle,(t-2.2)/.8):point);
}

export function authorSorry(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  // Bareheaded salute: choose the right temple on this mesh, not the forehead.
  // The head is unchanged by idle, so neutral vertex positions remain valid here.
  const ideal=rig.world('head').add(v(-.078,.065,.003));
  const positions=rig.mesh.geometry.getAttribute('position');let closest=Infinity,temple=ideal.clone();
  for(let i=0;i<positions.count;i++){
    const point=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(rig.mesh.matrixWorld);
    if(point.x>=-.045||Math.abs(point.y-ideal.y)>.035||Math.abs(point.z-ideal.z)>.035)continue;
    const distance=point.distanceToSquared(ideal);if(distance<closest){closest=distance;temple=point;}
  }
  if(!Number.isFinite(closest))throw Error('Cannot locate right temple');
  temple.x-=.018; // Allow for finger surface thickness, not only the bone endpoint.
  const shoulder=rig.world('upperarm01.R'),upperLength=shoulder.distanceTo(rig.world('lowerarm01.R'));
  const forearmLength=rig.world('lowerarm01.R').distanceTo(rig.world('wrist.R'));
  let handLength=rig.world('wrist.R').distanceTo(rig.world('finger3-1.R'));
  for(let j=1;j<3;j++)handLength+=rig.world(`finger3-${j}.R`).distanceTo(rig.world(`finger3-${j+1}.R`));
  handLength+=rig.world('finger3-3.R').distanceTo(rig.tip('R',3));
  // Solve shoulder -> elbow -> middle fingertip, treating forearm + straight
  // wrist/hand as one segment. This prevents aiming the hand by bending the wrist.
  const secondLength=forearmLength+handLength,delta=temple.clone().sub(shoulder),distance=delta.length(),axis=delta.normalize();
  const pole=v(-1,-.1,.2);pole.addScaledVector(axis,-pole.dot(axis)).normalize();
  const along=(upperLength**2-secondLength**2+distance**2)/(2*distance);
  const heightSquared=upperLength**2-along**2;if(heightSquared<0)throw Error('Unreachable salute');
  const elbow=shoulder.clone().addScaledVector(axis,along).addScaledVector(pole,Math.sqrt(heightSquared));
  const direction=temple.clone().sub(elbow).normalize();
  s.hinge('R',elbow,elbow.clone().addScaledVector(direction,forearmLength));
  const down=v(0,-1,0).addScaledVector(direction,direction.y).normalize();
  // Outward means away from the torso (+Z), a recorded authoring interpretation.
  const palm=down.clone().applyAxisAngle(direction,-THREE.MathUtils.degToRad(20));
  s.hand('R',direction,new THREE.Vector3().crossVectors(direction,palm));
  for(let i=2;i<=5;i++)s.straight('R',i,direction);
  const tuck=rig.world('finger2-1.R').sub(rig.world('finger1-2.R')).normalize().lerp(direction,.25).normalize();
  s.aim('finger1-2.R',tuck);s.aim('finger1-3.R',direction);
  const salute=s.snapshot();
  const retreatWrist=rig.world('wrist.R').add(v(-.065,-.025,.12));
  s.arm('R',retreatWrist);s.hinge('R',rig.world('lowerarm01.R'),retreatWrist);
  s.hand('R',direction,new THREE.Vector3().crossVectors(direction,palm));
  const retreat=s.snapshot();
  const chest=(depth:number)=>{
    s.restore(s.idle);const wrist=v(-.13,1.27,depth);s.arm('R',wrist,v(-.2,-.65,1));s.hinge('R',rig.world('lowerarm01.R'),wrist);
    const pointing=v(.8,-.1,-.6).normalize();s.hand('R',pointing,v(0,1,0));s.fist('R',5);s.straight('R',5,pointing);return s.snapshot();
  };
  const away=chest(.285),near=chest(.255);
  const asset=s.exportClip('csl.sorry','对不起',5,'右手五指并拢伸直、手腕挺直，掌心向下略向外，中指靠近右太阳穴；下放改伸小指，胸前点动三下，再回到自然站姿。','一手五指并拢，举于额际，先做“敬礼”手势，然后下放改伸小指，在胸部点几下。用户补充：右手、五指并拢伸直、手腕挺直、掌心向下微向外约20°；不戴帽时中指微接右太阳穴。',t=>{
    if(t<.7)return s.blend(s.idle,salute,t/.7);
    if(t<1.3)return salute;
    if(t<1.55)return s.blend(salute,retreat,(t-1.3)/.25);
    if(t<2)return s.blend(retreat,away,(t-1.55)/.45);
    if(t>4.2)return s.blend(away,s.idle,(t-4.2)/.8);
    let amount=0;for(const center of [2.35,3,3.65]){const d=Math.abs(t-center);if(d<.24)amount=Math.max(amount,.5+.5*Math.cos(Math.PI*d/.24));}
    return s.blend(away,near,amount);
  });
  asset.version='user-description-3';
  asset.authoring.source+=' 敬礼按用户补充的军事举手礼说明修订；20°以垂直前臂的朝下方向为基准，向身体外侧（前方）倾转。v3按手指表面厚度留距，修正肘部弯曲平面和过渡。点胸三下为暂定。';
  return asset;
}

export function authorLove(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=(stroke:number)=>{
    s.restore(s.idle);
    const support=v(.15,1.18,.255);s.arm('L',support);s.hinge('L',rig.world('lowerarm01.L'),support);s.hand('L',v(-1,0,0),v(0,1,0));
    for(let i=2;i<=5;i++)rig.finger('L',i,1,{axis:'x',sign:1,angles:[.85,1.15,.8]});
    // Thumb column root stays natural; the two exposed joints point upwards.
    for(let j=2;j<=3;j++)s.aim(`finger1-${j}.L`,v(0,1,0));
    const thumbTip=rig.tip('L',1),thumbBase=rig.world('finger1-2.L');
    const target=thumbTip.clone().lerp(thumbBase,.05+.75*stroke).add(v(0,0,.038));
    // The palm (not the index fingertip) faces the thumb's back. Fingers run
    // diagonally upwards, keeping wrist and forearm in a comfortable corridor.
    const long=v(.8,.6,0),across=v(-.6,.8,0);
    const place=(wrist:THREE.Vector3)=>{s.arm('R',wrist);s.hinge('R',rig.world('lowerarm01.R'),wrist);s.hand('R',long,across);};
    place(v(-.08,1.25,.32));
    const center=()=>rig.world('wrist.R').lerp(rig.world('finger3-1.R'),.58);
    for(let iteration=0;iteration<3;iteration++)place(rig.world('wrist.R').add(target.clone().sub(center())));
    for(let i=2;i<=5;i++)s.straight('R',i,long);
    const tuck=rig.world('finger2-1.R').sub(rig.world('finger1-2.R')).normalize().lerp(long,.3).normalize();
    s.aim('finger1-2.R',tuck);s.aim('finger1-3.R',long);
    return s.snapshot();
  };
  const start=pose(0),end=pose(1);
  const asset=s.exportClip('csl.love','爱',4,'左手在胸前竖起拇指；右手五指自然伸直并拢，掌心朝向左拇指，从指尖沿指背向下轻抚一次，配合柔和表情。','用户补充：左手拇指直立朝上、其余四指握拳置于胸前；右手五指伸直并拢，掌心朝向左拇指，从指尖顺指背向下轻抚，单次即可，可重复一次；表情柔和、怜爱。',t=>{
    if(t<.8)return s.blend(s.idle,start,t/.8);
    if(t>3.2)return s.blend(end,s.idle,(t-3.2)/.8);
    return pose(smooth((t-1)/1.7));
  });
  asset.version='user-description-2';
  asset.authoring.source=asset.authoring.source.replace('表情中性，','')+' 本版选择单次向下轻抚；轻柔以缓入缓出和保持表面间距表现，不模拟真实压力。微笑与眉眼小幅放松为预览参数，不能替代专业非手控语义校验。';
  for(const frame of asset.frames){const amount=frame.t<.8?smooth(frame.t/.8):frame.t>3.2?1-smooth((frame.t-3.2)/.8):1;frame.expressions=Object.fromEntries(Object.entries(expressionConfig.motions.love).map(([name,value])=>[name,Number((value*amount).toFixed(6))]));}
  return asset;
}

/**
 * 好：一手握拳，向上伸出拇指。
 * 直接复用“谢谢”里已验证的点赞姿势（prepareThumbsUp 的 open），不再手调手臂与手腕参数。
 */
export function authorGood(rig:AnnyRig):FixedMotionAsset{
  const {keys,ready,open}=prepareThumbsUp(rig);
  const smooth=(x:number)=>{const a=THREE.MathUtils.clamp(x,0,1);return a*a*(3-2*a);};
  const frames:FixedMotionAsset['frames']=[];
  for(let i=0;i<=90;i++){
    const t=i/30;
    const reach=t<.7?smooth(t/.7):t>2.2?1-smooth((t-2.2)/.8):1;
    for(const key of keys)rig.bones[key].quaternion.copy(ready[key]).slerp(open[key],reach);
    frames.push({t:Number(t.toFixed(6)),rotations:Object.fromEntries(keys.map(key=>[key,rig.bones[key].quaternion.toArray().map(n=>Number(n.toFixed(8)))]))});
  }
  rig.ready();
  return {schemaVersion:1,kind:'fixed-anny-motion',id:'csl.good',label:'好',rig:'anny-makehuman',version:'user-description-1',status:'authored_unverified',review:'not_reviewed',verifiedBy:null,duration:3,
    description:'从自然站姿抬起右臂，握拳并向上伸出拇指，停留后回到自然站姿。',
    authoring:{basis:'一手握拳，向上伸出拇指。',source:'词典条目 csl.good 的文字说明；手形复用“谢谢”已验证的点赞姿势（不额外旋转拇指根），表情中性，未经标准手语核验。'},frames};
}

/** 是：食、中指相叠，指尖朝前上方，向下一顿（用户图解）。 */
export function authorYes(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const wrist=v(-.16,1.24,.36),long=v(0,.55,.835).normalize();
  s.arm('R',wrist);s.hinge('R',rig.world('lowerarm01.R'),wrist);
  s.hand('R',long,v(0,.835,-.55)); // Palm faces the model's left (+X).
  s.fist('R'); // Thumb root remains natural; ring/little fingers are folded.
  s.straight('R',3,long);
  // Stack the index alongside the middle's distal section, with a surface
  // allowance. Merely aiming both fingers parallel leaves their base gap open.
  rig.finger('R',2,0);
  const overlap=rig.world('finger3-2.R').add(v(-.015,.005,-.003));
  s.aim('finger2-1.R',overlap.sub(rig.world('finger2-1.R')));
  s.aim('finger2-2.R',long);s.aim('finger2-3.R',long);
  // Lay the thumb over the folded fingers without stretching its root/webbing.
  s.aim('finger1-2.R',v(.55,-.45,.88));
  s.aim('finger1-3.R',v(.15,-.85,.46));
  const raised=s.snapshot();
  s.rotate('wrist.R',new THREE.Quaternion().setFromAxisAngle(v(1,0,0),.42));
  const dipped=s.snapshot();
  const asset=s.exportClip('csl.yes','是',3,'右手食指与中指相叠，指尖朝前上方；其余三指收拢，向下顿一下，短暂停留后回到自然站姿。','用户提供图解：一手食、中指相叠，指尖朝前上方，向下一顿。',t=>{
    if(t<.8)return s.blend(s.idle,raised,t/.8);
    if(t<1.2)return raised;
    if(t<1.45)return s.blend(raised,dipped,(t-1.2)/.25);
    if(t<2.2)return dipped;
    return s.blend(dipped,s.idle,(t-2.2)/.8);
  });
  asset.version='user-description-2';
  asset.authoring.source='用户于2026-10-19提供“是”的图解截图及图中文字。按相叠、前上方、下顿一次编排；具体手位、指间余量与节奏为本模型预览参数，未经标准手语核验。';
  return asset;
}

/**
 * 「不是」的历史交叉手形；「是」已独立按最新图解制作，不能共用。
 *   不是 —— 掌心正常向前，交叉后左右摆动。
 * 注意：「不是」是一个单独的词，不是「不」+「是」。
 */
function crossedFingers(s:ReturnType<typeof studio>,palm:'inward'|'forward'){
  s.arm('R',v(-.13,1.26,.34));
  if(palm==='inward')s.hand('R',v(0,1,0),v(-1,0,0));
  else s.hand('R',v(0,1,0),v(1,0,0));
  s.fist('R',0);
  s.straight('R',2,v(-.34,.92,.18));
  s.straight('R',3,v(.30,.95,.12));
}

/** 不是：掌心向前，两指交叉，左右摆动手掌。 */
export function authorNot(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  crossedFingers(s,'forward');
  const pose=s.snapshot();
  return s.exportClip('csl.not','不是',3,'右手食指与中指交叉相搭、掌心向前，手腕左右摆动三下，再回到自然站姿。','「不是」为独立词条；手形与「是」相同（两指交叉），掌心向前并左右摆动，表示否定。动作依据由用户说明。',t=>{
    if(t<.6)return s.blend(s.idle,pose,t/.6);
    if(t>2.3)return s.blend(pose,s.idle,(t-2.3)/.7);
    s.restore(pose);
    const phase=(t-.6)/1.7;
    s.rotate('wrist.R',new THREE.Quaternion().setFromAxisAngle(v(0,0,1),.34*Math.sin(6*Math.PI*phase)*Math.sin(Math.PI*phase)**2));
    return s.snapshot();
  });
}

// Public-service pilot: source-backed authoring, still awaiting human review.
function windowHand(s:ReturnType<typeof studio>,rig:AnnyRig,side:Side,long:THREE.Vector3,palm:THREE.Vector3){
  const across=new THREE.Vector3().crossVectors(long,palm).multiplyScalar(side==='R'?1:-1);
  s.hand(side,long,across);
  for(let i=2;i<=5;i++)s.straight(side,i,long);
  rig.finger(side,1,.12);
}
function windowArm(s:ReturnType<typeof studio>,rig:AnnyRig,side:Side,wrist:THREE.Vector3){
  s.arm(side,wrist);s.hinge(side,rig.world(`lowerarm01.${side}`),wrist);
}
function windowAsset(asset:FixedMotionAsset,source:string){
  asset.version='source-reference-1';
  asset.authoring.source=`依据便民查询网动作解释与本轮按需查看的图解：${source}。手位、幅度、节奏为Anny预览编排参数，未经专业手语核验；不用于扩充识别模型。`;
  return asset;
}
export function authorNeed(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const palm=(depth:number)=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.13,1.09,depth));windowHand(s,rig,'R',v(0,0,1),v(0,1,0));return s.snapshot();};
  const far=palm(.39),pulled=palm(.29);
  const asset=s.exportClip('csl.ref.bmcx.1874','需要',3.2,'一手平伸，掌心向上，向自己滑回一次，短暂停留后自然收手；没有点胸动作。','按用户2026-10-20纠正：需要只用向自己滑回，不包含前面的点自己。',t=>{
    if(t<.7)return s.blend(s.idle,far,t/.7);
    if(t<2)return s.blend(far,pulled,(t-.9)/1.1);
    if(t<2.4)return pulled;
    return s.blend(pulled,s.idle,(t-2.4)/.8);
  });
  asset.version='user-description-1';
  asset.authoring.source='用户2026-10-20纠正需要动作：删除点胸，仅保留手掌向自己滑回。沿用既有掌心向上手形与安全距离；未经专业手语核验。';
  return asset;
}
export function authorHelp(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig),long=v(0,.78,.625),palm=v(0,-.625,.78);
  const pose=(depth:number)=>{s.restore(s.idle);for(const side of ['L','R'] as Side[]){windowArm(s,rig,side,v(side==='R'?-.15:.15,1.2,depth));windowHand(s,rig,side,long,palm);}return s.snapshot();};
  const back=pose(.29),front=pose(.365);
  return windowAsset(s.exportClip('csl.ref.bmcx.1900','帮助',3.6,'双手掌心向外，向前拍动两下，停留后自然收手。','双手掌心向外，拍动两下，表示给人援助、帮助。',t=>{
    if(t<.7)return s.blend(s.idle,back,t/.7);
    if(t>2.8)return s.blend(back,s.idle,(t-2.8)/.8);
    let amount=0;for(const center of [1.2,2.1]){const d=Math.abs(t-center);if(d<.32)amount=Math.max(amount,(1+Math.cos(Math.PI*d/.32))/2);}return s.blend(back,front,amount);
  }),'https://shouyu.bmcx.com/1900__shouyud/');
}
export function authorPlease(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=(shift:number)=>{s.restore(s.idle);for(const side of ['L','R'] as Side[]){windowArm(s,rig,side,v((side==='R'?-.16:.16)+shift*.12,1.035,.28));windowHand(s,rig,side,v(.65*shift,0,1-.25*shift),v(0,1,0));}return s.snapshot();};
  const start=pose(0),end=pose(1);
  return windowAsset(s.exportClip('csl.ref.bmcx.1932','请',3.2,'双手在腰前掌心向上，一同向身旁移，表达邀请，随后自然收手。','双手掌心向上，在腰部向旁移，表示邀请之意。',t=>{
    if(t<.65)return s.blend(s.idle,start,t/.65);
    if(t<2)return s.blend(start,end,(t-.85)/1.15);
    if(t<2.4)return end;
    return s.blend(end,s.idle,(t-2.4)/.8);
  }),'https://shouyu.bmcx.com/1932__shouyud/');
}
export function authorWait(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig),jaw=rig.world('jaw');
  // Keep the back of the hand below/in front of the chin; mesh clearance is
  // checked after export. Do not push fingers into the face to fake contact.
  const pose=(wrist:THREE.Vector3)=>{s.restore(s.idle);windowArm(s,rig,'R',wrist);windowHand(s,rig,'R',v(1,0,0),v(0,-1,0));return s.snapshot();};
  const approach=pose(v(-.2,1.3,.32)),held=pose(v(-.145,jaw.y-.065,jaw.z+.12));
  return windowAsset(s.exportClip('csl.ref.bmcx.1938','等候',3.4,'右手伸平，手背靠近下颏下方，停留表示等候，再自然收手。','一手背贴于颏下，表示张望、等候之意。用户同意本轮用“好，请等候”替代原剧本“好，请稍等”。',t=>{
    if(t<.45)return s.blend(s.idle,approach,t/.45);
    if(t<.8)return s.blend(approach,held,(t-.45)/.35);
    if(t<2.5)return held;
    if(t<2.9)return s.blend(held,approach,(t-2.5)/.4);
    return s.blend(approach,s.idle,(t-2.9)/.5);
  }),'https://shouyu.bmcx.com/1938__shouyud/');
}

export const dictionaryAuthors:Record<string,(rig:AnnyRig)=>FixedMotionAsset>={
  'csl.you':authorYou,'csl.goodbye':authorGoodbye,'csl.sorry':authorSorry,'csl.me':authorMe,'csl.love':authorLove,
  'csl.good':authorGood,'csl.yes':authorYes,'csl.not':authorNot,
  'csl.ref.bmcx.1874':authorNeed,'csl.ref.bmcx.1900':authorHelp,'csl.ref.bmcx.1932':authorPlease,'csl.ref.bmcx.1938':authorWait,
};
