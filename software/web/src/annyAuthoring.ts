// Authoring tool only. Runtime playback consumes the exported fixed asset.
import * as THREE from 'three';
import type {AnnyRig} from './annyRig';
import type {FixedMotionAsset} from './fixedAnnyMotion';

export function prepareThumbsUp(rig:AnnyRig){
  rig.ready();
  const keys=Object.keys(rig.bones).filter(name=>/^(upperarm|lowerarm|wrist|finger)/.test(name));
  const snapshot=()=>Object.fromEntries(keys.map(name=>[name,rig.bones[name].quaternion.clone()]));
  const ready=snapshot();
  const rotateWorld=(name:string,delta:THREE.Quaternion)=>{
    const bone=rig.bones[name],current=bone.getWorldQuaternion(new THREE.Quaternion()),parent=bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parent.invert().multiply(delta).multiply(current));rig.scene.updateMatrixWorld(true);
  };
  const aim=(name:string,direction:THREE.Vector3,end?:string)=>{
    const bone=rig.bones[name],tail=end?rig.world(end):bone.localToWorld(new THREE.Vector3().fromArray(bone.userData.tail));
    rotateWorld(name,new THREE.Quaternion().setFromUnitVectors(tail.sub(rig.world(name)).normalize(),direction.clone().normalize()));
  };
  // Both segments point forwards in the same direction: a genuinely extended elbow.
  const forward=new THREE.Vector3(-.12,-.12,1).normalize();
  aim('upperarm01.R',forward,'lowerarm01.R');aim('lowerarm01.R',forward,'wrist.R');
  for(let finger=2;finger<=5;finger++)rig.finger('R',finger,1,{axis:'x',sign:1,angles:[1.0,1.3,.9]});
  const up=new THREE.Vector3(0,1,0);
  const palmY=rig.world('finger3-1.R').sub(rig.world('wrist.R')).normalize();
  const palmX=rig.world('finger2-1.R').sub(rig.world('finger5-1.R'));palmX.addScaledVector(palmY,-palmX.dot(palmY)).normalize();
  const palmZ=new THREE.Vector3().crossVectors(palmX,palmY).normalize();
  const currentPalm=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(palmX,palmY,palmZ));
  // Keep the palm's longitudinal axis along the forearm. Making it vertical
  // would bend the wrist by 90 degrees instead of producing a thumbs-up.
  const targetX=up.clone().addScaledVector(forward,-up.dot(forward)).normalize();
  const targetZ=new THREE.Vector3().crossVectors(targetX,forward).normalize();
  const targetPalm=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(targetX,forward,targetZ));
  rotateWorld('wrist.R',targetPalm.multiply(currentPalm.invert()));
  // Preserve the thumb-column/first-web-space root. Forcing all three joints
  // vertical rotated this root by ~54 degrees and stretched some web edges 2.48x.
  // Only straighten the two exposed phalanges; the basal segment stays natural.
  const naturalThumb=rig.tip('R',1).sub(rig.world('finger1-2.R')).normalize();
  const openDirection=naturalThumb.lerp(up,.6).normalize();
  for(let joint=2;joint<=3;joint++)aim(`finger1-${joint}.R`,openDirection);
  const open=snapshot();
  // Curl towards the index finger; the axis is derived in world space, then
  // transformed to each thumb joint's own space. Never flip signs by guesswork.
  const toward=rig.world('finger2-2.R').sub(rig.world('finger1-2.R'));toward.addScaledVector(openDirection,-toward.dot(openDirection)).normalize();
  const axis=new THREE.Vector3().crossVectors(openDirection,toward).normalize();
  const localAxes=[2,3].map(j=>axis.clone().applyQuaternion(rig.bones[`finger1-${j}.R`].getWorldQuaternion(new THREE.Quaternion()).invert()));
  return {keys,ready,open,localAxes,forward,aim};
}

export function authorThanks(rig:AnnyRig):FixedMotionAsset {
  const {keys,ready,open,localAxes}=prepareThumbsUp(rig);
  const smooth=(x:number)=>{const v=THREE.MathUtils.clamp(x,0,1);return v*v*(3-2*v);};
  const frames:FixedMotionAsset['frames']=[];
  for(let i=0;i<=120;i++){
    const t=i/30;
    const reach=t<.6?smooth(t/.6):t>3.3?1-smooth((t-3.3)/.7):1;
    for(const key of keys)rig.bones[key].quaternion.copy(ready[key]).slerp(open[key],reach);
    let curl=0;
    for(const center of [1.15,1.85,2.55]){
      const d=Math.abs(t-center);if(d<.25)curl=Math.max(curl,.5+.5*Math.cos(Math.PI*d/.25));
    }
    for(let j=0;j<2;j++){const key=`finger1-${j+2}.R`;rig.bones[key].quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(localAxes[j],curl*(j===0?.85:.65)));}
    frames.push({t:Number(t.toFixed(6)),rotations:Object.fromEntries(keys.map(key=>[key,rig.bones[key].quaternion.toArray().map(v=>Number(v.toFixed(8)))]))});
  }
  rig.ready();
  return {schemaVersion:1,kind:'fixed-anny-motion',id:'csl.thanks',label:'谢谢',rig:'anny-makehuman',version:'user-description-3',status:'authored_unverified',review:'not_reviewed',verifiedBy:null,duration:4,
    description:'从双臂自然下垂、双手与腿留有间距的站姿抬起右臂点赞；拇指屈伸 3 次，最后回到自然站姿。',
    authoring:{basis:'用户明确描述：伸直手臂点赞，然后大拇指弯曲3次。',source:'用户动作说明；角度、伸臂方向和节奏由助手设为预览参数，尚未经过标准手语核验。'},frames};
}

export function authorHello(rig:AnnyRig):FixedMotionAsset {
  const {keys,ready,open,forward,aim}=prepareThumbsUp(rig);
  // “你”: point the index towards the other person (model-space +Z).
  // The other three fingers remain folded; the thumb folds towards the fist.
  rig.finger('R',2,0);
  for(let joint=1;joint<=3;joint++)aim(`finger2-${joint}.R`,forward);
  rig.finger('R',1,1,{axis:'x',sign:1,angles:[0,1.1,.9]});
  const point=Object.fromEntries(keys.map(key=>[key,rig.bones[key].quaternion.clone()]));
  const smooth=(x:number)=>{const v=THREE.MathUtils.clamp(x,0,1);return v*v*(3-2*v);};
  const frames:FixedMotionAsset['frames']=[];
  for(let i=0;i<=120;i++){
    const t=i/30;
    let from=point,to=point,amount=0;
    if(t<.6){from=ready;to=point;amount=smooth(t/.6);}
    else if(t>1.4&&t<2){from=point;to=open;amount=smooth((t-1.4)/.6);}
    else if(t>=2&&t<=3.2){from=open;to=open;}
    else if(t>3.2){from=open;to=ready;amount=smooth((t-3.2)/.8);}
    frames.push({t:Number(t.toFixed(6)),rotations:Object.fromEntries(keys.map(key=>[key,from[key].clone().slerp(to[key],amount).toArray().map(v=>Number(v.toFixed(8)))]))});
  }
  rig.ready();
  return {schemaVersion:1,kind:'fixed-anny-motion',id:'csl.hello',label:'你好',rig:'anny-makehuman',version:'user-description-1',status:'authored_unverified',review:'not_reviewed',verifiedBy:null,duration:4,
    description:'右手食指指向前方表示“你”，随后收起食指、握拳向上伸出拇指表示“好”，最后回到双手与腿留有间距的自然站姿。',
    authoring:{basis:'用户提供：“你”：一手食指指向对方。“好”：一手握拳，向上伸出拇指。',source:'用户动作说明。右手、手臂位置、其他手指收拢方式、角度、过渡与停留节奏为助手预览参数；面部保持中性，未经标准手语校验。'},frames};
}
