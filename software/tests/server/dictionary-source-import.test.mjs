import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeSourceIndex} from '../../scripts/import-dictionary-source-index.mjs';
const index=JSON.parse(readFileSync(new URL('../../shared/sign-dictionary-sources.json',import.meta.url),'utf8'));
const dictionary=JSON.parse(readFileSync(new URL('../../shared/sign-dictionary.json',import.meta.url),'utf8'));
test('re-import is idempotent and does not alter original words',()=>{
 const result=mergeSourceIndex(dictionary,index);assert.equal(result.added,0);assert.deepEqual(result.dictionary,dictionary);
 const original={...dictionary,entries:dictionary.entries.filter(e=>!e.sourceId)};
 const merged=mergeSourceIndex(original,index);assert.equal(merged.added,20);assert.deepEqual(merged.dictionary.entries.slice(0,original.entries.length),original.entries);
 assert.ok(merged.dictionary.entries.filter(e=>e.referenceOnly).every(e=>e.description===''&&e.review==='not_reviewed'));
});
test('same word never overwrites a project definition',()=>{
 const source=structuredClone(index);source.entries=[{...source.entries[0],term:'谢谢'}];const result=mergeSourceIndex(dictionary,source);
 // Remove the corresponding source ID first so the duplicate-name path is exercised.
 const base={...dictionary,entries:dictionary.entries.filter(e=>e.id!=='csl.ref.'+source.entries[0].sourceId)};
 const collision=mergeSourceIndex(base,source);assert.equal(collision.added,0);assert.equal(collision.collisions[0].word,'谢谢');assert.deepEqual(collision.dictionary.entries.find(e=>e.id==='csl.thanks'),dictionary.entries.find(e=>e.id==='csl.thanks'));
});
test('untrusted URL or copied content mode cannot enter the dictionary',()=>{
 for(const patch of [{canonicalUrl:'javascript:alert(1)'},{canonicalUrl:'https://evil.example/95__shouyud/'},{descriptionImported:true},{mediaDownloaded:true},{rightsStatus:'verified'}]){
  const bad=structuredClone(index);bad.entries=[{...bad.entries[0],...patch}];assert.throws(()=>mergeSourceIndex(dictionary,bad));
 }
});
