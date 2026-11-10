import { readFileSync } from 'node:fs';

export function validateCatalog(catalog) {
  if(catalog.schemaVersion!==1 || !catalog.catalogVersion || !Array.isArray(catalog.entries) || !catalog.entries.length)throw Error('Invalid sign catalog');
  const model=catalog.recognitionModel;
  if(!model?.id || !/^[a-f0-9]{64}$/.test(model.sha256) || !Array.isArray(model.labels))throw Error('Invalid recognition model identity');
  if(model.features?.id!=='mp-hands-xyz-wrist-maxabs-left-right-v1' || model.features.sequenceLength!==30 || model.features.dimensions!==126 || model.features.mirrored!==true)throw Error('Feature adapter not implemented');
  const ids=new Set(), indexes=new Set(), names=new Set();
  for(const entry of catalog.entries){
    if(!/^csl\.[a-z0-9_.-]+$/.test(entry.id)||ids.has(entry.id)||names.has(entry.text))throw Error('Duplicate or invalid sign identity');
    if(!Number.isInteger(entry.recognitionIndex)||indexes.has(entry.recognitionIndex)||model.labels[entry.recognitionIndex]!==entry.text)throw Error('Recognition label mapping mismatch');
    if(typeof entry.speechText!=='string'||!entry.speechText.trim())throw Error('Missing speech text');
    // Playback states, deliberately narrow:
    //   missing              — nothing to play.
    //   authored_unverified  — a motion exists and may be previewed, but nobody qualified has
    //                          checked it. It must stay marked unverified and MUST NOT be
    //                          presented as validated sign language.
    // 'ready' is still rejected on purpose: only a real review can unlock it, and a JSON edit
    // must never be able to fake that.
    const playback=entry.playback??{};
    if(playback.status==='missing'){
      if(playback.asset!==null||playback.review!=='not_reviewed')throw Error('Missing playback must not reference an asset');
    }else if(playback.status==='authored_unverified'){
      if(typeof playback.asset!=='string'||!playback.asset)throw Error('Authored playback needs an asset path');
      if(playback.review!=='not_reviewed'||playback.verifiedBy!=null)throw Error('Authored playback must stay marked unverified');
    }else{
      throw Error('Playback adapter and asset validation required');
    }
    ids.add(entry.id);indexes.add(entry.recognitionIndex);names.add(entry.text);
  }
  return catalog;
}

export const signCatalog=validateCatalog(JSON.parse(readFileSync(new URL('./sign-catalog.json',import.meta.url),'utf8')));
export function resolveSignText(input) {
  if(typeof input!=='string')return {status:'unsupported',entry:null};
  const cleaned=input.trim().replace(/[。！!？?，,、；;\s]+$/u,'');
  const entry=signCatalog.entries.find(item=>item.text===cleaned);
  if(!entry)return {status:'unsupported',entry:null};
  // 'asset_unverified' is intentionally not 'ready' — the caller must not auto-play it.
  return {status:entry.playback.status==='missing'?'asset_missing':'asset_unverified',entry};
}
