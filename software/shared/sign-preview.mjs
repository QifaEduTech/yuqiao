import {readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveSignText} from './sign-catalog.mjs';
import {planMotionText} from './motion-planner.mjs';

const motionRoot=fileURLToPath(new URL('./sign-motions/',import.meta.url));
const catalog=JSON.parse(readFileSync(new URL('./sign-motion-catalog.json',import.meta.url),'utf8'));
// This is a preview lookup only. Neither the recognition vocabulary nor the
// reviewed-playback gate is expanded by adding a fixed action to the library.
export function resolveInputPreview(input){
  const legacy=resolveSignText(input);
  const normalized=typeof input==='string'?input.trim().replace(/[。！!？?，,、；;\s]+$/u,''):'';
  const registered=catalog.entries.find(item=>item.label===normalized);
  const entry=legacy.entry??(registered?{id:registered.id,text:registered.label}:null);
  if(!entry){
    const plan=planMotionText(input);
    if(plan.status==='unsupported')return {status:'unsupported',entry:null,preview:null,missing:plan.missing,reason:plan.reason};
    if(plan.status==='single')return resolveInputPreview(plan.entry.label);
    for(const step of plan.preview.steps){const source=catalog.entries.find(e=>e.id===step.id),result=source&&resolveInputPreview(source.label);if(!result?.preview||result.preview.version!==step.version)return {status:'asset_missing',entry:{id:plan.preview.id,text:plan.preview.label},preview:null};}
    return {status:'asset_unverified',entry:{id:plan.preview.id,text:plan.preview.label},preview:plan.preview};
  }
  if(!registered)return {status:'asset_missing',entry,preview:null};
  try{
    if(typeof registered.asset!=='string'||!/^anny\/[a-z0-9_.-]+\.json$/.test(registered.asset))throw Error('Invalid asset path');
    const path=resolve(motionRoot,registered.asset);
    if(!path.startsWith(resolve(motionRoot)+sep))throw Error('Asset outside library');
    const asset=JSON.parse(readFileSync(path,'utf8'));
    if(asset.schemaVersion!==1||asset.kind!=='fixed-anny-motion'||asset.rig!==catalog.rig||asset.id!==registered.id||asset.label!==registered.label||asset.version!==registered.version||asset.status!=='authored_unverified'||asset.review!=='not_reviewed'||asset.verifiedBy!==null||!Array.isArray(asset.frames)||asset.frames.length<2)throw Error('Asset not eligible for preview');
    return {status:'asset_unverified',entry,preview:{id:asset.id,label:asset.label,version:asset.version,status:'authored_unverified'}};
  }catch{
    return {status:'asset_missing',entry,preview:null};
  }
}
