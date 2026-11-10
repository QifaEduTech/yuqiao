import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {composeFixedMotion} from './lib/compose-fixed-motion.mjs';
const root=new URL('../',import.meta.url),id=process.argv[2];
const definitions=JSON.parse(await readFile(new URL('shared/sign-motion-sequences.json',root),'utf8'));
const definition=definitions.entries.find(e=>e.id===id);if(!definition)throw Error('Unknown configured sequence');
const catalog=JSON.parse(await readFile(new URL('shared/sign-motion-catalog.json',root),'utf8')),sources=new Map(),hashes={};
for(const step of definition.steps){
 const entry=catalog.entries.find(e=>e.id===step.id);if(!entry||entry.version!==step.version||!/^anny\/[a-z0-9_.-]+\.json$/.test(entry.asset))throw Error('Missing or stale registered source');
 const raw=await readFile(new URL('shared/sign-motions/'+entry.asset,root));sources.set(step.id,JSON.parse(raw));hashes[step.id]=createHash('sha256').update(raw).digest('hex');
}
const asset=composeFixedMotion(definition,sources);asset.sourceHashes=hashes;
await writeFile(new URL(`shared/sign-motions/anny/${id}.json`,root),JSON.stringify(asset)+'\n');
console.log(JSON.stringify({id:asset.id,duration:asset.duration,frames:asset.frames.length,sequence:asset.sequence}));
