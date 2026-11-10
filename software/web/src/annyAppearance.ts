import * as THREE from 'three';
import {extendAnnySkinning, type AnnyRig} from './annyRig';
import {loadImportedWardrobe,type ImportedWardrobe} from './importedWardrobe';
import {createAnnyFace,eyeColors,type EyeColor} from './annyFace';

export const appearanceKey='yuqiao.anny.appearance.v1';
export const outfitColors={forest:{label:'松绿',top:'#426759',pants:'#293e3a'},ocean:{label:'海蓝',top:'#456b89',pants:'#283747'},clay:{label:'陶红',top:'#965e51',pants:'#393735'}};
export const hairColors={ink:{label:'自然黑',color:'#252421'},brown:{label:'深棕',color:'#50382b'}};
export type Appearance={gender:'male'|'female';outfit:keyof typeof outfitColors;garment:'tee'|'vintage';hair:'crop'|'sweep'|'bun';hairColor:keyof typeof hairColors;skin:'warm';eyes:EyeColor;face:'natural'|'soft'};
export const defaultAppearance:Appearance={gender:'male',outfit:'forest',garment:'tee',hair:'crop',hairColor:'ink',skin:'warm',eyes:'brown',face:'natural'};
export function sanitizeAppearance(value:unknown):Appearance{
  const v=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const gender=v.gender==='female'||v.gender!=='male'&&v.garment==='vintage'?'female':'male';
  return {gender,garment:gender==='female'?'vintage':'tee',outfit:Object.hasOwn(outfitColors,String(v.outfit))?v.outfit as Appearance['outfit']:'forest',hair:v.hair==='sweep'||v.hair==='bun'?v.hair:'crop',hairColor:v.hairColor==='brown'?'brown':'ink',skin:'warm',eyes:Object.hasOwn(eyeColors,String(v.eyes))?v.eyes as EyeColor:'brown',face:v.face==='soft'?'soft':'natural'};
}
export function readAppearance():Appearance{try{return sanitizeAppearance(JSON.parse(localStorage.getItem(appearanceKey)??'null'));}catch{return {...defaultAppearance};}}

type Vertex={p:THREE.Vector3;n:THREE.Vector3;weights:Map<number,number>};
type Cut=(p:THREE.Vector3)=>number;
function mix(a:Vertex,b:Vertex,t:number):Vertex{
  const weights=new Map<number,number>();
  for(const [joint,w] of a.weights)weights.set(joint,w*(1-t));
  for(const [joint,w] of b.weights)weights.set(joint,(weights.get(joint)??0)+w*t);
  return {p:a.p.clone().lerp(b.p,t),n:a.n.clone().lerp(b.n,t).normalize(),weights};
}
function clip(input:Vertex[],cut:Cut){
  const output:Vertex[]=[];
  for(let i=0;i<input.length;i++){
    const a=input[i],b=input[(i+1)%input.length],da=cut(a.p),db=cut(b.p);
    if(da>=0)output.push(a);
    if((da>=0)!==(db>=0))output.push(mix(a,b,da/(da-db)));
  }
  return output;
}

/** Keep the avatar hidden until its complete opaque outfit is ready.
 * Hair follows the original 12-influence rig; body/expression geometry is unchanged. */
export function createAnnyAppearance(rig:AnnyRig,onStatus?:(status:'loading'|'ready'|'error')=>void){
  rig.scene.visible=false;
  const face=createAnnyFace(rig);
  const body=rig.mesh,g=body.geometry,positions=g.getAttribute('position'),normals=g.getAttribute('normal');
  if(!g.index)throw Error('外观初始化失败：人体网格缺少索引。');
  const vertices:Vertex[]=Array.from({length:positions.count},(_,i)=>{
    const weights=new Map<number,number>();
    for(let s=0;s<3;s++){
      const j=g.getAttribute(s?`joints_${s}`:'skinIndex'),w=g.getAttribute(s?`weights_${s}`:'skinWeight');
      for(let k=0;k<4;k++)if(w.getComponent(i,k)>0)weights.set(j.getComponent(i,k),(weights.get(j.getComponent(i,k))??0)+w.getComponent(i,k));
    }
    return {p:new THREE.Vector3().fromBufferAttribute(positions,i),n:new THREE.Vector3().fromBufferAttribute(normals,i),weights};
  });
  // Values are for the versioned Anny export's neutral bind coordinates (metres).
  const scalpCuts:Cut[]=[p=>p.y-.655-Math.max(0,p.z)*.57];
  const material=(color:string)=>new THREE.MeshStandardMaterial({color,roughness:.95,metalness:0,side:THREE.DoubleSide});
  const hairMat=material(hairColors.ink.color),bunMat=material(hairColors.ink.color);
  const index=Array.from(g.index.array);
  const meshes:THREE.SkinnedMesh[]=[];
  function shell(name:string,cuts:Cut[],materials:THREE.Material[],offset:number){
    const output:Vertex[]=[],groups:{start:number;count:number;materialIndex:number}[]=[];
    for(let i=0;i<index.length;i+=3){
      let polygon=[vertices[index[i]],vertices[index[i+1]],vertices[index[i+2]]];
      for(const cut of cuts){polygon=clip(polygon,cut);if(polygon.length<3)break;}
      for(let k=1;k<polygon.length-1;k++){
        const tri=[polygon[0],polygon[k],polygon[k+1]];
        const mat=materials.length>1&&tri.every(v=>Math.abs(v.p.x)>.16&&v.p.y>.30)?1:0;
        const previous=groups.at(-1);if(previous?.materialIndex===mat)previous.count+=3;else groups.push({start:output.length,count:3,materialIndex:mat});
        output.push(...tri);
      }
    }
    const geometry=new THREE.BufferGeometry(),p:number[]=[],n:number[]=[],joints=[[],[],[]] as number[][],weights=[[],[],[]] as number[][];
    for(const v of output){
      const point=v.p.clone().addScaledVector(v.n,offset);
      const normal=v.n.clone();
      p.push(...point.toArray());n.push(...normal.toArray());
      const entries=[...v.weights].sort((a,b)=>b[1]-a[1]).slice(0,12),total=entries.reduce((sum,e)=>sum+e[1],0);
      for(let s=0;s<3;s++)for(let k=0;k<4;k++){const entry=entries[s*4+k];joints[s].push(entry?.[0]??0);weights[s].push((entry?.[1]??0)/total);}
    }
    if(!output.length)throw Error('外观初始化失败：衣服网格为空。');
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));
    for(let s=0;s<3;s++){geometry.setAttribute(s?`joints_${s}`:'skinIndex',new THREE.Uint16BufferAttribute(joints[s],4));geometry.setAttribute(s?`weights_${s}`:'skinWeight',new THREE.Float32BufferAttribute(weights[s],4));}
    for(const group of groups)geometry.addGroup(group.start,group.count,group.materialIndex);
    const mesh=new THREE.SkinnedMesh(geometry,materials);mesh.name=name;
    mesh.position.copy(body.position);mesh.quaternion.copy(body.quaternion);mesh.scale.copy(body.scale);
    body.parent!.add(mesh);mesh.bind(body.skeleton,body.bindMatrix);extendAnnySkinning(mesh,false);meshes.push(mesh);return mesh;
  }
  // Build everything before the caller adds the model to its visible scene.
  const hair=shell('anny-hair',scalpCuts,[hairMat],.006);
  // Fine strand-like shading uses original generated vertex colours, no images.
  const hp=hair.geometry.getAttribute('position'),hairTint:number[]=[];
  for(let i=0;i<hp.count;i++){
    const angle=Math.atan2(hp.getX(i),hp.getZ(i)-.015),tone=.72+.28*(.5+.5*Math.sin(angle*110+hp.getY(i)*30));
    hairTint.push(tone,tone,tone);
  }
  hair.geometry.setAttribute('color',new THREE.Float32BufferAttribute(hairTint,3));hairMat.vertexColors=true;
  const hairBase=(hair.geometry.getAttribute('position').array as Float32Array).slice();
  const bunGeometry=new THREE.SphereGeometry(1,24,16);
  bunGeometry.scale(.055,.052,.044);bunGeometry.translate(0,.747,-.075);
  // Bake bind-space geometry into the head's local coordinates once.
  body.updateWorldMatrix(true,false);rig.bones.head.updateWorldMatrix(true,false);
  bunGeometry.applyMatrix4(new THREE.Matrix4().copy(rig.bones.head.matrixWorld).invert().multiply(body.matrixWorld));
  const bun=new THREE.Mesh(bunGeometry,bunMat);bun.name='anny-hair-bun';rig.bones.head.add(bun);
  let wardrobe:ImportedWardrobe|null=null,current=readAppearance(),activeMask='';
  const controller=new AbortController();
  const apply=(raw:Appearance)=>{
    const value=sanitizeAppearance(raw);
    current=value;
    face.apply(value.eyes,value.face==='soft');
    hairMat.color.set(hairColors[value.hairColor].color);bunMat.color.copy(hairMat.color);
    const pos=hair.geometry.getAttribute('position');
    for(let i=0;i<pos.count;i++){
      const x=hairBase[i*3],y=hairBase[i*3+1],z=hairBase[i*3+2],lift=Math.max(0,(y-.73)/.09);
      pos.setXYZ(i,x+(value.hair==='sweep'?.012*lift:0),y+(value.hair==='sweep'?.018*lift*(1-x/.16):0),z);
    }
    pos.needsUpdate=true;bun.visible=value.hair==='bun';
    const imported=wardrobe?value.garment:null;
    if(wardrobe){
      for(const [id,item] of Object.entries(wardrobe.items))item.mesh.visible=!!imported&&(id===imported||id==='trousers');
      // Keep original textures: the vintage blouse retains its original red.
      (wardrobe.items.tee.mesh.material as THREE.MeshStandardMaterial).color.set(value.outfit==='forest'?'#c6e0cf':value.outfit==='ocean'?'#bdd8ed':'#efc4b0');
      if(imported&&activeMask!==imported){
        const mask=new Set([...wardrobe.items[imported].mask,...wardrobe.items.trousers.mask]),kept:number[]=[];
        // The imported tops were lengthened and tucked into a separate trouser.
        // Hide the newly covered waist band as well as the authors' original masks.
        vertices.forEach((v,id)=>{if(Math.abs(v.p.x)<.19&&v.p.y>.07&&v.p.y<.205)mask.add(id);});
        for(let i=0;i<index.length;i+=3)if(!index.slice(i,i+3).every(v=>mask.has(v)))kept.push(...index.slice(i,i+3));
        g.setIndex(kept);activeMask=imported;
      }
    }
    hair.userData.appearance=value;
  };
  apply(readAppearance());
  let pending:Promise<boolean>|null=null;
  const retry=()=>{
    if(pending||controller.signal.aborted)return pending??Promise.resolve(false);
    onStatus?.('loading');
    pending=loadImportedWardrobe(rig,controller.signal).then(result=>{wardrobe=result;apply(current);rig.scene.visible=true;onStatus?.('ready');return true;}).catch(()=>{rig.scene.visible=false;if(!controller.signal.aborted)onStatus?.('error');return false;}).finally(()=>{pending=null;});
    return pending;
  };
  const ready=retry();
  return {apply,hair,bun,meshes,face,ready,retry,get wardrobe(){return wardrobe;},dispose:()=>{controller.abort();wardrobe?.dispose();}};
}
export type AnnyAppearance=ReturnType<typeof createAnnyAppearance>;
