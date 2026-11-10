import * as THREE from 'three';
import config from '../../shared/anny-rig.json';
import expressionConfig from '../../shared/anny-expressions.json';

type Finger = {axis:string;sign:number;angles:number[]};
export type AnnyRig = ReturnType<typeof createAnnyRig>;

// GLTFLoader normalizes WEIGHTS_0 in isolation. Restore the original sum and
// extend the material to use WEIGHTS_1/2 as well, retaining all 12 influences.
export function extendAnnySkinning(mesh: THREE.SkinnedMesh, restoreLoaderWeights = true) {
  const geometry = mesh.geometry;
  const w0 = geometry.getAttribute('skinWeight');
  const w1 = geometry.getAttribute('weights_1');
  const w2 = geometry.getAttribute('weights_2');
  if (!w1 || !w2) throw new Error('Anny 蒙皮权重不完整，无法预览。');
  for (let i=0;restoreLoaderWeights && i<w0.count;i++) {
    const remaining=1-w1.getX(i)-w1.getY(i)-w1.getZ(i)-w1.getW(i)-w2.getX(i)-w2.getY(i)-w2.getZ(i)-w2.getW(i);
    w0.setXYZW(i,w0.getX(i)*remaining,w0.getY(i)*remaining,w0.getZ(i)*remaining,w0.getW(i)*remaining);
  }
  w0.needsUpdate=true;
  for (const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material])) {
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <skinning_pars_vertex>', `#include <skinning_pars_vertex>
attribute vec4 joints_1; attribute vec4 weights_1;
attribute vec4 joints_2; attribute vec4 weights_2;`);
      const extra = [1,2].flatMap(set => ['x','y','z','w'].map((axis,i)=>({name:`boneExtra${set}${i}`,joint:`joints_${set}.${axis}`,weight:`weights_${set}.${axis}`})));
      shader.vertexShader = shader.vertexShader.replace('#include <skinbase_vertex>', '#include <skinbase_vertex>\n'+extra.map(e=>`mat4 ${e.name}=getBoneMatrix(${e.joint});`).join('\n'));
      shader.vertexShader = shader.vertexShader.replace('#include <skinning_vertex>', `
vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
vec4 skinned = boneMatX * skinVertex * skinWeight.x + boneMatY * skinVertex * skinWeight.y + boneMatZ * skinVertex * skinWeight.z + boneMatW * skinVertex * skinWeight.w;
${extra.map(e=>`skinned += ${e.name} * skinVertex * ${e.weight};`).join('\n')}
transformed = ( bindMatrixInverse * skinned ).xyz;`);
      shader.vertexShader = shader.vertexShader.replace('#include <skinnormal_vertex>', `
mat4 skinMatrix = skinWeight.x * boneMatX + skinWeight.y * boneMatY + skinWeight.z * boneMatZ + skinWeight.w * boneMatW;
${extra.map(e=>`skinMatrix += ${e.weight} * ${e.name};`).join('\n')}
skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
#ifdef USE_TANGENT
objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
#endif`);
    };
    material.customProgramCacheKey=()=> 'anny-12-influences-v1';
    material.needsUpdate=true;
  }
  mesh.frustumCulled=false;
}

export function createAnnyRig(scene:THREE.Object3D, mesh:THREE.SkinnedMesh) {
  // GLTFLoader strips '.' from node.name for animation bindings. Recover the
  // original MakeHuman identity from the loader's preserved userData.name.
  for(const bone of mesh.skeleton.bones) if(bone.userData.name)bone.name=bone.userData.name;
  const bones = Object.fromEntries(mesh.skeleton.bones.map(b=>[b.name,b]));
  const rest = Object.fromEntries(mesh.skeleton.bones.map(b=>[b.name,b.quaternion.clone()]));
  const world = (name:string) => {
    if (!bones[name]) throw new Error(`缺少骨骼 ${name}`);
    return bones[name].getWorldPosition(new THREE.Vector3());
  };
  const reset = () => {
    for(const [name,bone] of Object.entries(bones)) bone.quaternion.copy(rest[name]);
    mesh.morphTargetInfluences?.fill(0);
    scene.updateMatrixWorld(true);
  };
  const aim = (name:string,end:string,direction:THREE.Vector3) => {
    const bone=bones[name];
    const current=world(end).sub(world(name)).normalize();
    const delta=new THREE.Quaternion().setFromUnitVectors(current,direction.normalize());
    const parent=bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parent.invert().multiply(delta).multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
    scene.updateMatrixWorld(true);
  };
  const idle=()=>{
    reset();
    for(const side of ['L','R']) {
      const direction=side==='L'?1:-1;
      aim(`upperarm01.${side}`,`lowerarm01.${side}`,new THREE.Vector3(config.idle.upper[0]*direction,config.idle.upper[1],config.idle.upper[2]));
      aim(`lowerarm01.${side}`,`wrist.${side}`,new THREE.Vector3(config.idle.lower[0]*direction,config.idle.lower[1],config.idle.lower[2]));
    }
  };
  const finger=(side:string,index:number,amount:number,override?:Finger)=>{
    const params=override??(config.fingers as Record<string,Record<string,Finger>>)[side][index];
    const axis=params.axis==='x'?new THREE.Vector3(1,0,0):params.axis==='y'?new THREE.Vector3(0,1,0):new THREE.Vector3(0,0,1);
    for(let j=1;j<=3;j++) {
      const name=`finger${index}-${j}.${side}`;
      bones[name].quaternion.copy(rest[name]).multiply(new THREE.Quaternion().setFromAxisAngle(axis,amount*params.sign*params.angles[j-1]));
    }
    scene.updateMatrixWorld(true);
  };
  const fingers=(amount:number)=>{for(const side of ['L','R'])for(let i=1;i<=5;i++)finger(side,i,amount);};
  const expression=(name:string,amount:number)=>{
    const index=mesh.morphTargetDictionary?.[name];
    if(index===undefined||!mesh.morphTargetInfluences)throw new Error(`缺少表情 ${name}`);
    mesh.morphTargetInfluences[index]=amount;
  };
  const previewExpression=(amount:number)=>{
    mesh.morphTargetInfluences?.fill(0);
    for(const [name,limit] of Object.entries(expressionConfig.channels))expression(name,THREE.MathUtils.clamp(amount,0,1)*limit);
  };
  const tip=(side:string,index:number)=>{
    const bone=bones[`finger${index}-3.${side}`];
    return bone.localToWorld(new THREE.Vector3().fromArray(bone.userData.tail));
  };
  // Numerical sampling uses the same 12 influences as the material.
  const vertex=(index:number)=>{
    scene.updateMatrixWorld(true); mesh.skeleton.update();
    const base=new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'),index);
    const morph=mesh.geometry.morphAttributes.position;
    morph?.forEach((attribute,i)=>base.addScaledVector(new THREE.Vector3().fromBufferAttribute(attribute,index),mesh.morphTargetInfluences?.[i]??0));
    base.applyMatrix4(mesh.bindMatrix);
    const point=new THREE.Vector3();
    for(let set=0;set<3;set++) {
      const joints=mesh.geometry.getAttribute(set?`joints_${set}`:'skinIndex');
      const weights=mesh.geometry.getAttribute(set?`weights_${set}`:'skinWeight');
      for(let j=0;j<4;j++) {
        const matrix=new THREE.Matrix4().fromArray(mesh.skeleton.boneMatrices,joints.getComponent(index,j)*16);
        point.addScaledVector(base.clone().applyMatrix4(matrix),weights.getComponent(index,j));
      }
    }
    return point.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
  };
  // `ready` is retained for authoring-tool compatibility; it now means the
  // user-selected arms-down idle pose, not the previous raised signing pose.
  return {scene,mesh,bones,rest,world,reset,idle,ready:idle,fingers,finger,tip,expression,previewExpression,vertex,config};
}
