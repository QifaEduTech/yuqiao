import * as THREE from 'three';
import type {AnnyRig} from './annyRig';

export const skinTone='#cfae8c';
export const eyeColors={brown:{label:'深棕',color:'#503221'},hazel:{label:'浅棕',color:'#8b6635'},blue:{label:'灰蓝',color:'#536f80'}};
export type EyeColor=keyof typeof eyeColors;

/** Rest-space colour details follow the existing skinned/morphed surface.
 * No extra face shells, geometry displacement or expression changes. */
export function createAnnyFace(rig:AnnyRig){
  const mesh=rig.mesh,geometry=mesh.geometry,count=geometry.getAttribute('position').count;
  const region=new Float32Array(count);
  for(let i=0;i<count;i++){
    let eye=0;
    for(let s=0;s<3;s++){
      const joints=geometry.getAttribute(s?`joints_${s}`:'skinIndex'),weights=geometry.getAttribute(s?`weights_${s}`:'skinWeight');
      for(let k=0;k<4;k++)if(/^eye\.[LR]$/.test(mesh.skeleton.bones[joints.getComponent(i,k)].name))eye+=weights.getComponent(i,k);
    }
    region[i]=eye>.5?1:0;
  }
  geometry.setAttribute('faceRegion',new THREE.BufferAttribute(region,1));
  const eyeCentre=mesh.worldToLocal(rig.world('eye.L'));
  const uniforms={faceEye:{value:new THREE.Color(eyeColors.brown.color)},faceWhite:{value:new THREE.Color('#eee8de')},faceLip:{value:new THREE.Color('#ad7060')},faceBrow:{value:new THREE.Color('#443126')},faceSoft:{value:0},faceEyeCentre:{value:eyeCentre}};
  for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
    const material=mat as THREE.MeshStandardMaterial;
    material.color.set(skinTone);material.roughness=.72;
    const skinning=material.onBeforeCompile,cacheKey=material.customProgramCacheKey();
    material.onBeforeCompile=(shader,renderer)=>{
      skinning.call(material,shader,renderer);Object.assign(shader.uniforms,uniforms);
      shader.vertexShader='attribute float faceRegion; varying float vFaceRegion; varying vec3 vFaceRest;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFaceRegion=faceRegion; vFaceRest=position;');
      shader.fragmentShader=`varying float vFaceRegion; varying vec3 vFaceRest;
uniform vec3 faceEye; uniform vec3 faceWhite; uniform vec3 faceLip; uniform vec3 faceBrow; uniform float faceSoft; uniform vec3 faceEyeCentre;\n`+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
if(vFaceRegion>.5){
  vec2 eyePoint=vec2(abs(vFaceRest.x)-faceEyeCentre.x,vFaceRest.y-faceEyeCentre.y);
  float r=length(eyePoint),front=smoothstep(faceEyeCentre.z+.005,faceEyeCentre.z+.010,vFaceRest.z);
  float iris=(1.-smoothstep(.0054,.0061,r))*front;
  float pupil=(1.-smoothstep(.0021,.0026,r))*front;
  float rays=.82+.18*sin(atan(eyePoint.y,eyePoint.x)*38.+r*1900.);
  vec3 irisColor=faceEye*rays*(.75+.25*smoothstep(.0026,.0045,r));
  diffuseColor.rgb=mix(faceWhite,irisColor,iris);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.006),pupil);
  float glint=(1.-smoothstep(.00045,.00085,length(eyePoint-vec2(-.0016,.0019))))*front;
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.95),glint*.8);
}else if(vFaceRest.y>.59&&vFaceRest.z>.105){
  float lipRadius=length(vec2(vFaceRest.x/.023,(vFaceRest.y-.6283)/.009));
  float lip=(1.-smoothstep(.65,1.08,lipRadius))*smoothstep(.136,.146,vFaceRest.z);
  diffuseColor.rgb=mix(diffuseColor.rgb,faceLip,lip*(.60-.14*faceSoft));
  float browX=(abs(vFaceRest.x)-.030)/.023;
  float browY=.712+.0045*(1.-browX*browX);
  float brow=(1.-smoothstep(.0010,.0025,abs(vFaceRest.y-browY)))*(1.-smoothstep(.75,1.,abs(browX)));
  float strands=.8+.2*sin(vFaceRest.x*6700.+vFaceRest.y*1500.);
  diffuseColor.rgb=mix(diffuseColor.rgb,faceBrow,brow*strands*(.85-.25*faceSoft));
}`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nif(vFaceRegion>.5)roughnessFactor=.30;');
    };
    material.customProgramCacheKey=()=>`${cacheKey}-face-v1`;material.needsUpdate=true;
  }
  return {apply:(eye:EyeColor,soft:boolean)=>{uniforms.faceEye.value.set(eyeColors[eye].color);uniforms.faceSoft.value=soft?1:0;},eyeVertices:Array.from(region).filter(v=>v===1).length,uniforms};
}
