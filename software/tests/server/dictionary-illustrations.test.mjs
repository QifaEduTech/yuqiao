import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeIllustrated,validateGesture} from '../../scripts/import-dictionary-content.mjs';
const dictionary=JSON.parse(readFileSync(new URL('../../shared/sign-dictionary.json',import.meta.url),'utf8'));
const content=JSON.parse(readFileSync(new URL('../../shared/sign-dictionary-content.json',import.meta.url),'utf8'));
test('illustration import is idempotent; 是 matches the user-provided text',()=>{
 const result=mergeIllustrated(dictionary,content);assert.equal(result.added,0);assert.equal(result.updated,0);assert.deepEqual(result.dictionary,dictionary);
 const shi=dictionary.entries.find(e=>e.text==='是');assert.equal(shi.id,'csl.yes');assert.equal(shi.description,'一手食、中指相搭，并点动一下。');assert.equal(shi.gestureImages[0].sourceUrl,'https://d.bmcx.com/shouyu/_file/c/ed9305275555e84d.png');assert.equal(shi.review,'not_reviewed');
});
test('gesture paths and source URLs reject traversal and executable links',()=>{
 const image=content.entries[0].gestureImages[0];
 for(const patch of [{path:'/dictionary-images/../../data/private.png'},{sourceUrl:'javascript:alert(1)'},{path:'/dictionary-images/bad.svg'},{sha256:'invalid'},{width:999999}])assert.throws(()=>validateGesture({...image,...patch}));
});
test('manual edits to a sourced definition are not silently overwritten',()=>{
 const edited=structuredClone(dictionary);edited.entries.find(e=>e.id===content.entries[0].dictionaryId).description='人工重新核对后的说明，请保留。';
 const result=mergeIllustrated(edited,content);assert.ok(result.conflicts.includes(content.entries[0].dictionaryId));assert.equal(result.dictionary.entries.find(e=>e.id===content.entries[0].dictionaryId).description,'人工重新核对后的说明，请保留。');
});
test('source title/hash mismatch is rejected before mutation',()=>{
 for(const patch of [{term:'错误词'},{description:'篡改后的动作说明。'},{dictionaryId:'csl.hello'}]){const bad=structuredClone(content);bad.entries=[{...bad.entries[0],...patch}];assert.throws(()=>mergeIllustrated(dictionary,bad));}
});
