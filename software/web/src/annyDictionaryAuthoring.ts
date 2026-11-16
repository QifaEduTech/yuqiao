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

// Hospital mutual-aid pilot drafts. These six actions have source descriptions
// with a single primary motion. They are playback assets only; each remains
// authored_unverified until the meaning and appearance are reviewed by a
// qualified signer or the user.
export function authorWhat(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=(palmUp:boolean)=>{
    s.restore(s.idle);
    for(const side of ['L','R'] as Side[]){
      windowArm(s,rig,side,v(side==='R'?-0.16:0.16,1.17,.32));
      windowHand(s,rig,side,v(0,0,1),palmUp?v(0,1,0):v(0,-1,0));
    }
    return s.snapshot();
  };
  const down=pose(false),up=pose(true);
  const asset=s.exportClip('csl.ref.bmcx.3796','什么',3.4,'双手伸开，掌心向下，然后翻转为掌心向上，短暂停留后回到自然站姿。','词典来源原文：双手伸开，掌心向下，然后翻转为掌心向上。',t=>{
    if(t<.7)return s.blend(s.idle,down,t/.7);
    if(t<1.35)return down;
    if(t<2.15)return s.blend(down,up,(t-1.35)/.8);
    if(t<2.6)return up;
    return s.blend(up,s.idle,(t-2.6)/.8);
  });
  return windowAsset(asset,'https://shouyu.bmcx.com/3796__shouyud/');
}

export function authorFever(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const handPose=(wrist:THREE.Vector3)=>{
    s.restore(s.idle);
    windowArm(s,rig,'R',wrist);
    s.hand('R',v(0,1,0),v(0,0,1));
    for(let i=1;i<=5;i++)rig.finger('R',i,.28,{axis:'x',sign:1,angles:[.35,.55,.35]});
    return s.snapshot();
  };
  const head=rig.world('head');
  const forehead=handPose(head.clone().add(v(-.13,.04,.18)));
  const side=handPose(head.clone().add(v(-.24,.01,.24)));
  const asset=s.exportClip('csl.ref.bmcx.3928','发烧',3.6,'右手先按于前额，再移至头侧；五指微曲、指尖向上，手指微动两下后回到自然站姿。','词典来源原文：一手先按于前额，然后手移至头边，五指微曲，指尖向上，微动两下。',t=>{
    if(t<.65)return s.blend(s.idle,forehead,t/.65);
    if(t<1.15)return forehead;
    if(t<1.7)return s.blend(forehead,side,(t-1.15)/.55);
    if(t<2.85){
      s.restore(side);
      const phase=(t-1.7)/1.15;
      s.rotate('wrist.R',new THREE.Quaternion().setFromAxisAngle(v(0,0,1),.12*Math.sin(4*Math.PI*phase)*Math.sin(Math.PI*phase)**2));
      return s.snapshot();
    }
    return s.blend(side,s.idle,(t-2.85)/.75);
  });
  return windowAsset(asset,'https://shouyu.bmcx.com/3928__shouyud/');
}

export function authorMedicine(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const hand=v(0,1,.25).normalize();
  const letterY=()=>{
    s.restore(s.idle);windowArm(s,rig,'R',v(-.15,1.22,.34));s.hand('R',hand,v(0,0,1));s.fist('R');
    s.straight('R',1,v(.72,.18,.67));s.straight('R',5,v(.72,.18,.67));
    return s.snapshot();
  };
  const letterO=()=>{
    s.restore(s.idle);windowArm(s,rig,'R',v(-.15,1.22,.34));s.hand('R',hand,v(0,0,1));
    for(let i=1;i<=5;i++)rig.finger('R',i,.46,{axis:'x',sign:1,angles:[.45,.72,.55]});
    return s.snapshot();
  };
  const y=letterY(),o=letterO();
  const asset=s.exportClip('csl.ref.bmcx.3964','药',3.6,'右手在胸前依次做手指字母Y和O的指式，两个指式之间自然过渡，再回到自然站姿。','词典来源原文：一手连续打手指字母“Y”“O”两个指式。',t=>{
    if(t<.65)return s.blend(s.idle,y,t/.65);
    if(t<1.45)return y;
    if(t<2.15)return s.blend(y,o,(t-1.45)/.7);
    if(t<2.9)return o;
    return s.blend(o,s.idle,(t-2.9)/.7);
  });
  return windowAsset(asset,'https://shouyu.bmcx.com/3964__shouyud/');
}

export function authorCheck(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=(leftUp:boolean)=>{
    s.restore(s.idle);
    const leftY=leftUp?1.34:1.18,rightY=leftUp?1.18:1.34;
    const arms:[Side,number][]=[['L',leftY],['R',rightY]];
    for(const [side,y] of arms){
      windowArm(s,rig,side,v(side==='R'?-0.17:0.17,y,.34));
      s.hand(side,v(0,0,1),v(0,1,0));
      for(let i=1;i<=5;i++)rig.finger(side,i,.38,{axis:'x',sign:1,angles:[.42,.65,.5]});
    }
    return s.snapshot();
  };
  const low=pose(false),high=pose(true);
  const asset=s.exportClip('csl.ref.bmcx.2379','检查',3.6,'双手在胸前以拇、食、中指相捏的手形交替上下移动，表示查看物件，再回到自然站姿。','词典来源原文：双手拇、食、中指相捏，在胸前交替上下移动，模仿查看物件的样子。',t=>{
    if(t<.65)return s.blend(s.idle,low,t/.65);
    if(t<1.05)return low;
    if(t<2.65){
      const phase=(t-1.05)/1.6;
      return s.blend(low,high,(Math.sin(phase*2*Math.PI)+1)/2);
    }
    return s.blend(low,s.idle,(t-2.65)/.95);
  });
  return windowAsset(asset,'https://shouyu.bmcx.com/2379__shouyud/');
}

export function authorReport(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const head=rig.world('head');
  const gathered=()=>{
    s.restore(s.idle);windowArm(s,rig,'R',head.clone().add(v(-.16,-.08,.2)));s.hand('R',v(0,1,0),v(0,0,1));s.fist('R');return s.snapshot();
  };
  const opened=()=>{
    s.restore(s.idle);windowArm(s,rig,'R',head.clone().add(v(-.24,-.08,.32)));windowHand(s,rig,'R',v(0,1,0),v(0,0,1));return s.snapshot();
  };
  const close=gathered(),open=opened();
  const asset=s.exportClip('csl.ref.bmcx.123','报告',3.4,'右手五指撮合放在嘴边，然后向前伸出并张开五指，再回到自然站姿。','词典来源原文：一手五指撮合，放于嘴边，然后向前边伸出边张开五指。',t=>{
    if(t<.65)return s.blend(s.idle,close,t/.65);
    if(t<1.25)return close;
    if(t<2.35)return s.blend(close,open,(t-1.25)/1.1);
    return s.blend(open,s.idle,(t-2.35)/1.05);
  });
  return windowAsset(asset,'https://shouyu.bmcx.com/123__shouyud/');
}

export function authorGive(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const held=()=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.14,1.22,.3));s.hand('R',v(0,0,1),v(0,1,0));s.fist('R');return s.snapshot();};
  const open=()=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.14,1.22,.48));windowHand(s,rig,'R',v(0,0,1),v(0,1,0));return s.snapshot();};
  const start=held(),end=open();
  const asset=s.exportClip('csl.ref.bmcx.1952','给',3.4,'右手五指虚握、掌心向上，向外伸出并张开手掌，再回到自然站姿。','词典来源原文：一手五指虚握，掌心向上，向外伸出，张开手掌，如把物品归还给别人。',t=>{
    if(t<.65)return s.blend(s.idle,start,t/.65);
    if(t<2.25)return s.blend(start,end,(t-.65)/1.6);
    return s.blend(end,s.idle,(t-2.25)/1.15);
  });
  return windowAsset(asset,'https://shouyu.bmcx.com/1952__shouyud/');
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

// Hospital mutual-aid avatar batch: user-provided descriptions, playback only.
// All assets remain authored_unverified and are not added to recognition.
const STANDARD_SOURCE='用户2026-11-16提供的国家通用手语就医词文字说明（标注GF0020-2018）';
function userAsset(asset:FixedMotionAsset,basis:string,source:string,version='user-standard-1',note=''){
  asset.version=version;
  asset.authoring.basis=basis;
  asset.authoring.source=`${STANDARD_SOURCE}：${source}。手位、幅度、节奏为Anny预览编排参数，未经专业手语核验；不用于扩充识别模型。${note}`;
  return asset;
}
function questionExpression(asset:FixedMotionAsset,amount=.12){
  for(const frame of asset.frames)frame.expressions={browInnerUp:Number(amount.toFixed(6))};
  return asset;
}

export function authorWhatQuestion(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=()=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.14,1.3,.3));windowHand(s,rig,'R',v(0,1,0),v(0,0,1));s.fist('R',2);s.straight('R',2,v(0,1,0));return s.snapshot();};
  const base=pose();
  const asset=s.exportClip('csl.ref.bmcx.3796','什么',3.0,'右手食指直立、掌心向外，胸前小幅左右晃动两下，带疑问表情。','食指直立、掌心向外，胸前小幅左右晃动2–3次，疑问神情；和“哪里”手势相同，靠语境区分。',t=>{
    if(t<.6)return s.blend(s.idle,base,t/.6);
    if(t>2.3)return s.blend(base,s.idle,(t-2.3)/.7);
    s.restore(base);const phase=(t-.6)/1.7;
    s.rotate('wrist.R',new THREE.Quaternion().setFromAxisAngle(v(0,0,1),.18*Math.sin(4*Math.PI*phase)*Math.sin(Math.PI*phase)**2));
    return s.snapshot();
  });
  return questionExpression(userAsset(asset,'右手食指直立、掌心向外，胸前小幅左右晃动两下，疑问表情。','食指直立、掌心向外，胸前小幅左右晃动2–3次，疑问神情；和哪里手势相同，靠语境区分。','user-standard-1','与“哪里”手形相同，数字人只靠词条名称区分，不能体现语境；疑问表情仅用保守通道轻微抬眉。'),.16);
}

export function authorWhere(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=()=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.14,1.3,.3));windowHand(s,rig,'R',v(0,1,0),v(0,0,1));s.fist('R',2);s.straight('R',2,v(0,1,0));return s.snapshot();};
  const base=pose();
  const asset=s.exportClip('csl.ref.bmcx.3789','哪里',3.0,'右手食指直立、掌心向外，胸前高度小幅左右晃动两下，带疑惑表情。','食指直立、掌心向外，胸前高度小幅左右晃动2–3次，带疑惑表情。',t=>{
    if(t<.6)return s.blend(s.idle,base,t/.6);
    if(t>2.3)return s.blend(base,s.idle,(t-2.3)/.7);
    s.restore(base);const phase=(t-.6)/1.7;
    s.rotate('wrist.R',new THREE.Quaternion().setFromAxisAngle(v(0,0,1),.13*Math.sin(4*Math.PI*phase)*Math.sin(Math.PI*phase)**2));
    return s.snapshot();
  });
  return questionExpression(userAsset(asset,'右手食指直立、掌心向外，胸前高度小幅左右晃动两下，带疑惑表情。','食指直立、掌心向外，胸前高度小幅左右晃动2–3次，带疑惑表情。','user-standard-1','与“什么”手形相同，数字人只靠词条名称区分，不能体现语境。'),.12);
}

export function authorHere(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=(depth:number)=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.12,1.06,depth));windowHand(s,rig,'R',v(0,-1,0),v(0,0,1));s.fist('R',2);s.straight('R',2,v(0,-1,0));return s.snapshot();};
  const high=pose(.34),low=pose(.41);
  const asset=s.exportClip('csl.ref.bmcx.3786','这里',3.2,'右手食指尖朝下，在身前偏下位置短距离向下点两下，再回到自然站姿。','食指竖直、指尖朝下，身前偏下空间，短距离向下点2下；幅度很小，指示自己身前近处。',t=>{
    if(t<.6)return s.blend(s.idle,high,t/.6);
    if(t>2.5)return s.blend(high,s.idle,(t-2.5)/.7);
    if(t<1.0)return high;
    if(t<1.3)return s.blend(high,low,(t-1.0)/.3);
    if(t<1.7)return low;
    if(t<2.0)return s.blend(low,high,(t-1.7)/.3);
    if(t<2.25)return s.blend(high,low,(t-2.0)/.25);
    return s.blend(low,high,(t-2.25)/.25);
  });
  return userAsset(asset,'右手食指尖朝下，在身前偏下位置短距离向下点两下。','食指竖直、指尖朝下，身前偏下空间，短距离向下点2下；动作幅度很小，指示自己身前近处。');
}

export function authorHave(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=(y:number)=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.13,y,.3));windowHand(s,rig,'R',v(0,1,0),v(0,0,1));s.fist('R',1);s.straight('R',1,v(0,1,0));return s.snapshot();};
  const low=pose(1.08),high=pose(1.2);
  const asset=s.exportClip('csl.ref.bmcx.3757','有',3.0,'右手伸拇指，向上微微抬起，停留后回到自然站姿。','右手伸拇指，向上微微抬起。',t=>{
    if(t<.7)return s.blend(s.idle,low,t/.7);
    if(t<1.6)return s.blend(low,high,(t-.7)/.9);
    if(t<2.1)return high;
    return s.blend(high,s.idle,(t-2.1)/.9);
  });
  return userAsset(asset,'右手伸拇指，在胸前向上小幅抬起一次。','一手伸拇指，在胸前向上小幅抬起1次。');
}

export function authorNotHave(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=()=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.12,1.2,.34));windowHand(s,rig,'R',v(1,0,0),v(0,-1,0));return s.snapshot();};
  const base=pose();
  const asset=s.exportClip('csl.ref.bmcx.3758','没有',3.2,'右手横伸、掌心向下，左右摆动，再回到自然站姿。','右手横伸，掌心向下，左右摆动。',t=>{
    if(t<.6)return s.blend(s.idle,base,t/.6);
    if(t>2.5)return s.blend(base,s.idle,(t-2.5)/.7);
    s.restore(base);const phase=(t-.6)/1.9;
    s.rotate('wrist.R',new THREE.Quaternion().setFromAxisAngle(v(0,0,1),.32*Math.sin(4*Math.PI*phase)*Math.sin(Math.PI*phase)**2));
    return s.snapshot();
  });
  return userAsset(asset,'右手横伸、掌心向下，在胸前水平左右摆动两下，幅度小。','一手横伸、掌心向下，胸前水平左右摆动2次，幅度小。');
}

export function authorCan(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const base=()=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.14,1.2,.32));windowHand(s,rig,'R',v(0,1,0),v(0,0,1));return s.snapshot();};
  const bent=()=>{const p=base();s.restore(p);for(let i=2;i<=5;i++)rig.finger('R',i,.5,{axis:'x',sign:1,angles:[.5,.8,.6]});return s.snapshot();};
  const straight=base(),curled=bent();
  const asset=s.exportClip('csl.ref.bmcx.208','可以',3.4,'右手五指伸直向上，拇指不动，其余四指连续弯动几下，再回到自然站姿。','右手五指伸直向上，拇指不动，其余四指连续弯动几下。',t=>{
    if(t<.65)return s.blend(s.idle,straight,t/.65);
    if(t>2.7)return s.blend(straight,s.idle,(t-2.7)/.7);
    const phase=(t-.65)/2.05;
    return s.blend(straight,curled,(1-Math.cos(phase*4*Math.PI))/2);
  });
  return userAsset(asset,'右手五指直立向上，拇指固定不动，其余四指连续弯曲两次。','一手五指直立向上，拇指固定不动，其余四指连续弯曲2–3次。');
}

export function authorPain(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=(depth:number)=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.1,1.18,depth));s.hand('R',v(0,0,-1),v(0,1,0));s.fist('R');for(let i=1;i<=5;i++)rig.finger('R',i,.45,{axis:'x',sign:1,angles:[.5,.7,.5]});return s.snapshot();};
  const near=pose(.35),touch=pose(.31);
  const asset=s.exportClip('csl.ref.bmcx.1606','痛',3.2,'右手五指捏拢，在胸前痛处轻点两下，配合不适表情。','右手五指捏拢，在痛处轻点，皱眉。',t=>{
    if(t<.7)return s.blend(s.idle,near,t/.7);
    if(t>2.5)return s.blend(near,s.idle,(t-2.5)/.7);
    if(t<1.1)return s.blend(near,touch,(t-.7)/.4);
    if(t<1.45)return touch;
    if(t<1.8)return s.blend(touch,near,(t-1.45)/.35);
    return s.blend(near,touch,(t-1.8)/.7);
  });
  return userAsset(asset,'右手五指聚拢捏成小圆，在胸前上方小幅轻点两下，模拟一般疼痛。','一手五指聚拢捏成小圆，在疼痛部位上方小幅轻点2次；面部轻微蹙眉（一般疼痛，非剧痛）。','user-standard-1','患处位置未固定，预览暂按胸前代替实际疼痛部位；当前骨架只开放保守表情通道，没有蹙眉通道，预览保持中性表情。');
}

export function authorDoctor(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=()=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.18,1.45,.28));s.hand('R',v(0,1,0),v(0,0,1));s.fist('R');s.straight('R',2,v(0,1,0));s.straight('R',3,v(0,1,0));return s.snapshot();};
  const base=pose();
  const asset=s.exportClip('csl.ref.bmcx.526','医生',3.2,'右手食、中指放在太阳穴旁，点两下，再回到自然站姿。','右手食、中指放在太阳穴旁，点两下。',t=>{
    if(t<.65)return s.blend(s.idle,base,t/.65);
    if(t>2.5)return s.blend(base,s.idle,(t-2.5)/.7);
    s.restore(base);const phase=(t-.65)/1.85;
    s.rotate('wrist.R',new THREE.Quaternion().setFromAxisAngle(v(0,0,1),.12*Math.sin(4*Math.PI*phase)*Math.sin(Math.PI*phase)**2));
    return s.snapshot();
  });
  return userAsset(asset,'右手食、中指并拢放在太阳穴旁，连续点两下。','一手食、中指并拢，放在太阳穴旁，连续点2下。');
}

export function authorIDCard(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=(count:number)=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.2,1.4,.28));s.hand('R',v(0,1,0),v(0,0,1));s.fist('R');for(let i=2;i<=count;i++)s.straight('R',i,v(0,1,0));return s.snapshot();};
  const p1=pose(1),p2=pose(2),p3=pose(3),p4=pose(4),p5=pose(5);
  const asset=s.exportClip('csl.ref.bmcx.2512','身份证',4.0,'右手握拳，虎口朝上置于头侧，依次伸出食、中、无名、小指。','右手握拳，虎口朝上置于头侧，依次伸出食、中、无名、小指。',t=>{
    if(t<.6)return s.blend(s.idle,p1,t/.6);
    if(t<1.1)return p1;
    if(t<1.5)return s.blend(p1,p2,(t-1.1)/.4);
    if(t<1.9)return s.blend(p2,p3,(t-1.5)/.4);
    if(t<2.3)return s.blend(p3,p4,(t-1.9)/.4);
    if(t<2.7)return s.blend(p4,p5,(t-2.3)/.4);
    if(t<3.2)return p5;
    return s.blend(p5,s.idle,(t-3.2)/.8);
  });
  return userAsset(asset,'右手握拳，虎口朝上置于头侧，依次伸出食、中、无名、小指。','方案A（主流）：一手握拳，虎口朝上置于头侧，依次伸出食、中、无名、小指。','user-standard-1','国标另有方案B（一掌贴胸口向下微移表示“身”，再双手合掌向外翻开表示“证”），本版未制作，保留为备选。');
}

export function authorAllergy(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=(tap:number)=>{s.restore(s.idle);for(const side of ['L','R'] as Side[]){windowArm(s,rig,side,v(side==='R'?-.07:.07,1.2,.34+tap));windowHand(s,rig,side,v(side==='R'?-1:1,0,0),v(0,0,-1));s.fist(side,5);s.straight(side,5,v(side==='R'?-1:1,0,0));}return s.snapshot();};
  const apart=pose(0),touch=pose(-.035);
  const bump=(t:number,center:number,width=.3)=>{const d=Math.abs(t-center);return d<width?(1+Math.cos(Math.PI*d/width))/2:0;};
  const asset=s.exportClip('csl.ref.bmcx.4040','过敏',3.2,'双手伸小指、手背朝外，两小指指尖相对互戳两次，再回到自然站姿。','双手伸小指，手背朝外，两小指指尖相对互戳2次。',t=>{
    if(t<.7)return s.blend(s.idle,apart,t/.7);
    if(t>2.5)return s.blend(apart,s.idle,(t-2.5)/.7);
    return s.blend(apart,touch,Math.max(bump(t,1.05),bump(t,1.75)));
  });
  return userAsset(asset,'双手伸小指、手背朝外，两小指指尖相对互戳两次。','双手伸小指，手背朝外，两小指指尖相对互戳2次。');
}

export function authorHospital(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  // 五指并拢的平掌交叉：左手横过胸前，右手竖立在胸前正中，两掌在胸前交叉成十字。
  const pose=()=>{s.restore(s.idle);
    windowArm(s,rig,'L',v(.12,1.18,.3));windowHand(s,rig,'L',v(-1,0,0),v(0,0,1));
    windowArm(s,rig,'R',v(-.01,1.1,.35));windowHand(s,rig,'R',v(0,1,0),v(0,0,1));
    return s.snapshot();};
  const cross=pose();
  const asset=s.exportClip('csl.ref.bmcx.3984','医院',3.4,'双手五指并拢，在胸前正中搭成十字，静态定格后回到自然站姿。','双手五指并拢，搭成十字，置于胸前正中，静态定格。',t=>{
    if(t<.7)return s.blend(s.idle,cross,t/.7);
    if(t<2.4)return cross;
    return s.blend(cross,s.idle,(t-2.4)/1.0);
  });
  return userAsset(asset,'双手五指并拢，在胸前正中搭成十字，静态定格。','双手五指并拢，搭成十字，置于胸前正中，静态定格。','user-standard-1','“搭成十字”的两掌前后层次与掌心朝向为预览选择，仍需专业核对。');
}

export function authorRegister(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const leftPalm=()=>{s.restore(s.idle);windowArm(s,rig,'L',v(.1,1.15,.34));windowHand(s,rig,'L',v(1,0,0),v(0,1,0));return s.snapshot();};
  const tap=()=>{s.restore(s.idle);windowArm(s,rig,'L',v(.1,1.15,.34));windowHand(s,rig,'L',v(1,0,0),v(0,1,0));
    windowArm(s,rig,'R',v(-.02,1.2,.34));s.hand('R',v(0,-1,0),v(0,0,1));s.fist('R');s.straight('R',3,v(0,-1,0));s.straight('R',4,v(0,-1,0));s.straight('R',5,v(0,-1,0));return s.snapshot();};
  const mouth=()=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.1,1.42,.3));s.hand('R',v(0,1,0),v(0,0,1));s.fist('R');s.straight('R',2,v(0,1,0));s.straight('R',3,v(0,1,0));s.straight('R',4,v(0,1,0));s.straight('R',5,v(0,1,0));s.straight('R',1,v(-.7,.2,.2));return s.snapshot();};
  const a=leftPalm(),b=tap(),c=mouth();
  const asset=s.exportClip('csl.ref.bmcx.4039','挂号',4.2,'左掌放平，右手中、无名、小指在左掌心轻点一下；右手再移到嘴边，其余四指直立。','（1）左掌放平，右手中、无名、小指向下，在左掌心轻点一下；（2）右手虎口贴嘴边，其余四指直立。',t=>{
    if(t<.6)return s.blend(s.idle,a,t/.6);
    if(t<1.2)return a;
    if(t<1.6)return s.blend(a,b,(t-1.2)/.4);
    if(t<2.0)return b;
    if(t<2.8)return s.blend(b,c,(t-2.0)/.8);
    if(t<3.4)return c;
    return s.blend(c,s.idle,(t-3.4)/.8);
  });
  return userAsset(asset,'左掌放平，右手中、无名、小指向下在左掌心轻点一次；右手再贴到嘴边，四指直立。','左掌放平；右手中、无名、小指向下，在左掌心轻点1次；右手虎口贴嘴边，四指直立。');
}

export function authorClinic(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const parallel=()=>{s.restore(s.idle);for(const side of ['L','R'] as Side[]){windowArm(s,rig,side,v(side==='R'?-.12:.12,1.3,.34));windowHand(s,rig,side,v(0,1,0),v(0,0,1));}return s.snapshot();};
  // 左腕停在胸前作为“脉门”，右手食指从上方按到左腕内侧，轻点两下。
  const pulse=(press:number)=>{s.restore(s.idle);windowArm(s,rig,'L',v(.1,1.12,.32));windowHand(s,rig,'L',v(1,0,0),v(0,1,0));
    const long=v(.55,-.83,0);
    windowArm(s,rig,'R',v(.04,1.2-.012*press,.34));s.hand('R',long,v(0,0,1));s.fist('R',2);s.straight('R',2,long);return s.snapshot();};
  const bump=(t:number,center:number,width=.22)=>{const d=Math.abs(t-center);return d<width?(1+Math.cos(Math.PI*d/width))/2:0;};
  const a=parallel(),b=pulse(0),tap=pulse(1);
  const asset=s.exportClip('csl.ref.bmcx.3985','门诊',4.0,'双手五指并拢、掌心朝外并排；随后一手食指按另一手腕脉门轻点两下，模仿诊脉。','双手五指并拢、掌心朝外并排；一手食指按另一手腕脉门，轻点2下。',t=>{
    if(t<.65)return s.blend(s.idle,a,t/.65);
    if(t<1.5)return a;
    if(t<2.15)return s.blend(a,b,(t-1.5)/.65);
    if(t>3.15)return s.blend(b,s.idle,(t-3.15)/.85);
    return s.blend(b,tap,Math.max(bump(t,2.4),bump(t,2.85)));
  });
  return userAsset(asset,'双手五指并拢、掌心朝外并排；一手食指按另一手腕脉门轻点两下。','双手五指并拢、掌心朝外并排；一手食指按另一手腕脉门，轻点2下。');
}

export function authorVolunteer(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const zh=()=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.15,1.28,.34));windowHand(s,rig,'R',v(0,1,0),v(0,0,1));s.fist('R');s.straight('R',2,v(.2,1,.1));s.straight('R',3,v(-.1,1,.1));return s.snapshot();};
  const mouth=()=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.1,1.45,.3));windowHand(s,rig,'R',v(0,1,0),v(0,0,1));s.fist('R');s.straight('R',1,v(-.6,.2,.3));s.straight('R',2,v(.6,.2,.3));return s.snapshot();};
  const pull=()=>{s.restore(s.idle);windowArm(s,rig,'R',v(-.2,1.4,.3));windowHand(s,rig,'R',v(0,1,0),v(0,0,1));s.fist('R');s.straight('R',1,v(-.8,.1,.1));s.straight('R',2,v(.8,.1,.1));return s.snapshot();};
  const person=()=>{s.restore(s.idle);for(const side of ['L','R'] as Side[]){windowArm(s,rig,side,v(side==='R'?-.08:.08,1.22,.4));windowHand(s,rig,side,v(0,1,0),v(0,0,1));s.fist(side,2);s.straight(side,2,v(side==='R'?-.5:1,.2,0));}return s.snapshot();};
  const a=zh(),b=mouth(),c=pull(),d=person();
  const asset=s.exportClip('csl.ref.bmcx.546','志愿者',4.6,'右手先打手指字母ZH的近似指式，再在嘴角两侧向外拉开，最后双手食指搭成人字形。','（1）右手打手指字母ZH；（2）拇食指分开，放嘴角两侧向外拉开；（3）双手食指搭成“人”字形。',t=>{
    if(t<.6)return s.blend(s.idle,a,t/.6);
    if(t<1.1)return a;
    if(t<1.5)return s.blend(a,b,(t-1.1)/.4);
    if(t<1.9)return b;
    if(t<2.5)return s.blend(b,c,(t-1.9)/.6);
    if(t<2.9)return c;
    if(t<3.6)return s.blend(c,d,(t-2.9)/.7);
    if(t<4.0)return d;
    return s.blend(d,s.idle,(t-4.0)/.6);
  });
  return userAsset(asset,'右手打指字母ZH；拇食指分开，放嘴角两侧向外拉开；双手食指搭成“人”字形，位于胸前，幅度中等。','右手打指字母ZH；拇食指分开，放嘴角两侧向外拉开；双手食指搭成“人”字形。位置：胸前，幅度中等。','user-standard-1','ZH指式为预览近似，需专业核对。');
}

export function authorFeverForehead(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=()=>{s.restore(s.idle);const head=rig.world('head');windowArm(s,rig,'R',head.clone().add(v(-.14,.03,.18)));s.hand('R',v(0,1,0),v(0,0,-1));for(let i=1;i<=5;i++)rig.finger('R',i,.25,{axis:'x',sign:1,angles:[.3,.5,.3]});return s.snapshot();};
  const base=pose();
  const asset=s.exportClip('csl.ref.bmcx.3928','发烧',3.4,'右手掌贴额头，上下轻晃两下，模拟摸额头发烫，再回到自然站姿。','右手掌贴额头，上下轻晃，模拟摸额头发烫。',t=>{
    if(t<.65)return s.blend(s.idle,base,t/.65);
    if(t>2.7)return s.blend(base,s.idle,(t-2.7)/.7);
    s.restore(base);const phase=(t-.65)/2.05;
    s.rotate('wrist.R',new THREE.Quaternion().setFromAxisAngle(v(0,1,0),.1*Math.sin(4*Math.PI*phase)*Math.sin(Math.PI*phase)**2));
    return s.snapshot();
  });
  return userAsset(asset,'右手掌平贴额头，原地轻晃两下，模拟试体温。','右手掌平贴额头，原地轻晃2次，模拟试体温。');
}

export function authorCheckFingers(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const pose=(swap:boolean)=>{s.restore(s.idle);for(const side of ['L','R'] as Side[]){const depth=side==='R'?(swap?.44:.32):(swap?.32:.44);windowArm(s,rig,side,v(side==='R'?-.1:.1,1.2,depth));s.hand(side,v(0,0,1),v(0,1,0));s.fist(side,2);s.straight(side,2,v(0,0,1));}return s.snapshot();};
  const a=pose(false),b=pose(true);
  const asset=s.exportClip('csl.ref.bmcx.2379','检查',3.6,'双手食指前伸，一前一后交替扫动两轮，模拟查看，再回到自然站姿。','双手食指前伸，一前一后交替扫动2轮，视线跟随指尖。',t=>{
    if(t<.65)return s.blend(s.idle,a,t/.65);
    if(t>2.8)return s.blend(a,s.idle,(t-2.8)/.8);
    const phase=(t-.65)/2.15;
    // Two complete alternations; starts and ends at pose a so the exit blend has no jump.
    return s.blend(a,b,(1-Math.cos(phase*4*Math.PI))/2);
  });
  return userAsset(asset,'双手食指前伸，一前一后交替扫动两轮。','双手食指前伸，一前一后交替扫动2轮，视线跟随指尖。');
}

export function authorReportWriting(rig:AnnyRig):FixedMotionAsset{
  const s=studio(rig);
  const paper=()=>{s.restore(s.idle);windowArm(s,rig,'L',v(.12,1.14,.34));windowHand(s,rig,'L',v(1,0,0),v(0,1,0));return s.snapshot();};
  const write=()=>{s.restore(s.idle);windowArm(s,rig,'L',v(.12,1.14,.34));windowHand(s,rig,'L',v(1,0,0),v(0,1,0));
    windowArm(s,rig,'R',v(.02,1.18,.36));s.hand('R',v(0,-1,0),v(0,0,1));s.fist('R',2);s.straight('R',2,v(-.2,-.8,.1));return s.snapshot();};
  const send=()=>{s.restore(s.idle);windowArm(s,rig,'L',v(.12,1.14,.34));windowHand(s,rig,'L',v(1,0,0),v(0,1,0));
    windowArm(s,rig,'R',v(-.12,1.2,.4));windowHand(s,rig,'R',v(0,0,1),v(0,1,0));return s.snapshot();};
  const a=paper(),b=write(),c=send();
  const asset=s.exportClip('csl.ref.bmcx.123','报告',4.0,'左手平伸像纸张，右手食指在左掌面上仿写，随后向外送出，再回到自然站姿。','左手平伸像纸张；右手食指在左手掌面上仿写字，之后向外送出。',t=>{
    if(t<.6)return s.blend(s.idle,a,t/.6);
    if(t<1.1)return a;
    if(t<1.5)return s.blend(a,b,(t-1.1)/.4);
    if(t<2.3)return b;
    if(t<3.1)return s.blend(b,c,(t-2.3)/.8);
    return s.blend(c,s.idle,(t-3.1)/.9);
  });
  return userAsset(asset,'左手平伸仿纸张；右手食指在左掌面仿写字，之后向前送出。','左手平伸仿纸张；右手食指在左掌面仿写字，之后向前送出。');
}

export const dictionaryAuthors:Record<string,(rig:AnnyRig)=>FixedMotionAsset>={
  'csl.you':authorYou,'csl.goodbye':authorGoodbye,'csl.sorry':authorSorry,'csl.me':authorMe,'csl.love':authorLove,
  'csl.good':authorGood,'csl.yes':authorYes,'csl.not':authorNot,
  'csl.ref.bmcx.3796':authorWhatQuestion,'csl.ref.bmcx.3928':authorFeverForehead,'csl.ref.bmcx.3964':authorMedicine,
  'csl.ref.bmcx.2379':authorCheckFingers,'csl.ref.bmcx.123':authorReportWriting,'csl.ref.bmcx.1952':authorGive,
  'csl.ref.bmcx.1874':authorNeed,'csl.ref.bmcx.1900':authorHelp,'csl.ref.bmcx.1932':authorPlease,'csl.ref.bmcx.1938':authorWait,
  'csl.ref.bmcx.546':authorVolunteer,'csl.ref.bmcx.3984':authorHospital,'csl.ref.bmcx.4039':authorRegister,
  'csl.ref.bmcx.3985':authorClinic,'csl.ref.bmcx.526':authorDoctor,'csl.ref.bmcx.4040':authorAllergy,
  'csl.ref.bmcx.2512':authorIDCard,'csl.ref.bmcx.1606':authorPain,'csl.ref.bmcx.3757':authorHave,
  'csl.ref.bmcx.3758':authorNotHave,'csl.ref.bmcx.208':authorCan,'csl.ref.bmcx.3789':authorWhere,
  'csl.ref.bmcx.3786':authorHere,
};
