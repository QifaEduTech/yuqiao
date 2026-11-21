import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {activeEngine} from './recording-catalog.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
export const iterationOwnerKey = owner => digest(owner);

// Manifests stay beside deployed weights. An account's development run can
// update its own active iteration, not silently replace another user's version.
export function iterationReference(store, owner, labels, samples) {
 const active = activeEngine(store.root, store.data);
 if (!active.iterationOwnerKey) return null;
 const base = {referenceHash:active.weightsSha256, referenceVersion:active.version};
 if (active.iterationOwnerKey !== iterationOwnerKey(owner)) return {...base, unavailable:'当前模型属于其他训练账号'};
 const ids = new Set(labels.map(l=>l.signId));
 if (!active.labels.every(l=>ids.has(l.signId))) return {...base, unavailable:'本轮资料未覆盖当前模型的全部动作'};
 const bytes = readFileSync(resolve(active.modelDirectory,'fit-sources.json'));
 if (digest(bytes)!==active.fitSourcesSha256) throw Error('当前模型拟合来源校验失败。');
 const fitted = new Set(JSON.parse(bytes.toString('utf8')));
 return {...base, directory:active.modelDirectory, labels:active.labels,
  excluded:samples.filter(s=>s.split==='validation'&&fitted.has(s.sourceHash)).map(s=>s.sourceHash)};
}

export function iterationDecision(comparison, labels, previousHash, candidateHash) {
 if (!comparison || comparison.metric!=='macro-auto-f1-v1' || comparison.referenceHash!==previousHash ||
     comparison.candidateHash!==candidateHash || !Number.isSafeInteger(comparison.clips) || comparison.clips<1) return null;
 const scores={};
 for (const key of ['previous','current']) {
  const rows=comparison[key];
  if (!Array.isArray(rows)||rows.length!==labels.length||!rows.length) return null;
  let sum=0;
  for (const [i,r] of rows.entries()) {
   if (!r || r.signId!==labels[i].signId || ![r.tp,r.fp,r.tn,r.fn].every(n=>Number.isSafeInteger(n)&&n>=0) ||
       r.tp+r.fp+r.tn+r.fn!==comparison.clips || ! (r.tp+r.fn) || !(r.fp+r.tn)) return null;
   if (key==='current' && r.tp+r.fn!==comparison.previous[i].tp+comparison.previous[i].fn) return null;
   sum+=2*r.tp/(2*r.tp+r.fp+r.fn);
  }
  scores[key]=sum/rows.length;
 }
 return {...scores, improved:scores.current-scores.previous>1e-12, clips:comparison.clips};
}
