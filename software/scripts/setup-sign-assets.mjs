import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const repo = 'wuli-git/gesture_languish_recognize';
const pinned = JSON.parse(await readFile('docs/assets/sign-word-source.json', 'utf8'));
const tree = { sha: pinned.commit, tree: pinned.files.map(item => ({path: item.source.split(`${pinned.commit}/`)[1], sha: item.gitBlob, sha256: item.sha256})) };
const bases = [`https://raw.githubusercontent.com/${repo}/${tree.sha}/`, `https://cdn.jsdelivr.net/gh/${repo}@${tree.sha}/`];
const benchmark = await Promise.all(bases.map(async base => {
  const start = performance.now();
  try { const r = await fetch(base + 'model/dynamic_gesture_classifier/dynamic_gesture_label.csv', {signal: AbortSignal.timeout(15000)}); const b = Buffer.from(await r.arrayBuffer()); if (!r.ok || !b.includes(Buffer.from('你好'))) throw Error('invalid'); return {base, ms: Math.round(performance.now()-start)}; }
  catch(e) { return {base, error:e.message}; }
}));
await mkdir('models/sign-word-baseline', {recursive:true});
await mkdir('.runtime-logs/sign-source', {recursive:true});
await writeFile('.runtime-logs/sign-source/download-benchmark.json', JSON.stringify(benchmark,null,2));
console.log(benchmark);
const mirrors = benchmark.filter(x=>x.ms !== undefined).sort((a,b)=>a.ms-b.ms);
if (!mirrors.length) throw Error('No verified source reachable');
const paths = ['LICENSE', 'dynamic_recognizer.py', 'extract_dynamic_dataset.py', 'app.py', 'model/dynamic_gesture_classifier/dynamic_gesture_classifier.py', 'model/dynamic_gesture_classifier/dynamic_gesture_classifier.tflite', 'model/dynamic_gesture_classifier/dynamic_gesture_label.csv', 'model/dynamic_gesture_classifier/dynamic_gesture_dataset.csv'];
const files=[];
for (const path of paths) {
  const item=tree.tree.find(x=>x.path===path);
  let bytes, source;
  for (const mirror of mirrors) {
    try { const r=await fetch(mirror.base+path,{signal:AbortSignal.timeout(30000)}); if(!r.ok) throw Error(`HTTP ${r.status}`); const b=Buffer.from(await r.arrayBuffer()); const hash=createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex'); if(hash!==item.sha || createHash('sha256').update(b).digest('hex')!==item.sha256) throw Error('Model integrity mismatch'); bytes=b; source=mirror.base+path; break; } catch(e) { console.log(path,e.message); }
  }
  if(!bytes) throw Error(`Could not download ${path}`);
  const name=path.split('/').at(-1);
  const output=path.endsWith('.py') || name==='dynamic_gesture_dataset.csv' ? `.runtime-logs/sign-source/${name}` : `models/sign-word-baseline/${name}`;
  await writeFile(output,bytes);
  files.push({path:output, source, bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex'),gitBlob:item.sha});
  console.log('Verified',output,bytes.length);
}
await writeFile('models/sign-word-baseline/source.json',JSON.stringify({repository:`https://github.com/${repo}`,commit:tree.sha,license:'Apache-2.0',standardValidated:false,files},null,2));
