import {publicAsset} from './assetUrl';
import * as THREE from 'three';
import {extendAnnySkinning,type AnnyRig} from './annyRig';

type Garment={id:string;position:number[];normal:number[];uv:number[];indices:number[];joints:number[];weights:number[];deleteVertices:number[];color:string;detail:string|null;detailType:string};
export async function loadImportedWardrobe(rig:AnnyRig,signal:AbortSignal){
  const meshes:THREE.SkinnedMesh[]=[],textures:THREE.Texture[]=[];
  const dispose=()=>{for(const m of meshes){m.removeFromParent();m.geometry.dispose();(m.material as THREE.Material).dispose();}for(const t of textures)t.dispose();};
  const texture=async(file:string,srgb:boolean)=>{
    const response=await fetch(publicAsset(`/avatar-wardrobe/${file}`),{signal});if(!response.ok)throw Error('服装贴图不可用');
    const url=URL.createObjectURL(await response.blob());
    try{const tex=await new THREE.TextureLoader().loadAsync(url);if(signal.aborted){tex.dispose();throw Error('cancelled');}tex.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;tex.anisotropy=4;textures.push(tex);return tex;}finally{URL.revokeObjectURL(url);}
  };
  try{
    const items:Record<string,{mesh:THREE.SkinnedMesh;mask:Set<number>}>= {};
    // Sequential loading bounds memory; failure disposes all preceding items.
    for(const id of ['tee','vintage','trousers']){
      const response=await fetch(publicAsset(`/avatar-wardrobe/${id}.json`),{signal});if(!response.ok)throw Error('服装模型不可用');
      const data:Garment=await response.json(),count=data.position?.length/3;
      if(data.id!==id||!count||data.normal.length!==count*3||data.uv.length!==count*2||data.joints.length!==count*12||data.weights.length!==count*12)throw Error('服装数据不完整');
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.position,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(data.normal,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(data.uv,2));geometry.setIndex(data.indices);
      for(let s=0;s<3;s++){
        const joints:number[]=[],weights:number[]=[];
        for(let i=0;i<count;i++)for(let k=0;k<4;k++){joints.push(data.joints[i*12+s*4+k]);weights.push(data.weights[i*12+s*4+k]);}
        geometry.setAttribute(s?`joints_${s}`:'skinIndex',new THREE.Uint16BufferAttribute(joints,4));geometry.setAttribute(s?`weights_${s}`:'skinWeight',new THREE.Float32BufferAttribute(weights,4));
      }
      const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9,metalness:0,side:THREE.DoubleSide});
      const mesh=new THREE.SkinnedMesh(geometry,material);mesh.name=`wardrobe-${id}`;meshes.push(mesh);
      material.map=await texture(data.color,true);
      if(data.detail){const detail=await texture(data.detail,false);if(data.detailType==='normal'){material.normalMap=detail;material.normalScale.set(.5,.5);}else{material.bumpMap=detail;material.bumpScale=.0008;}}
      mesh.position.copy(rig.mesh.position);mesh.quaternion.copy(rig.mesh.quaternion);mesh.scale.copy(rig.mesh.scale);mesh.bind(rig.mesh.skeleton,rig.mesh.bindMatrix);extendAnnySkinning(mesh,false);
      mesh.visible=false;items[id]={mesh,mask:new Set(data.deleteVertices)};
    }
    if(signal.aborted)throw Error('cancelled');
    for(const mesh of meshes)rig.mesh.parent!.add(mesh);
    return {items,meshes,dispose};
  }catch(error){dispose();throw error;}
}
export type ImportedWardrobe=Awaited<ReturnType<typeof loadImportedWardrobe>>;
