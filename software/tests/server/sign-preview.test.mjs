import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveInputPreview} from '../../shared/sign-preview.mjs';

test('固定动作匹配返回实际 Anny 资源版本，但不升级正式播放状态',()=>{
  const asset=JSON.parse(readFileSync('shared/sign-motions/anny/csl.thanks.json','utf8'));
  for(const input of ['谢谢',' 谢谢。 ','谢谢！']){
    const result=resolveInputPreview(input);
    assert.equal(result.status,'asset_unverified');assert.equal(result.entry.id,'csl.thanks');
    assert.deepEqual(result.preview,{id:asset.id,label:asset.label,version:asset.version,status:'authored_unverified'});
  }
});
test('缺动作与不支持的整段文字分别处理，不能按子串返回谢谢',()=>{
  for(const input of ['谢谢你呀','你好，我叫小明','我不爱你','没关系','',null]){
    const result=resolveInputPreview(input);assert.equal(result.status,'unsupported');assert.equal(result.preview,null);assert.equal(result.entry,null);
  }
});
test('你好映射到自己的固定版本；词典组成动作不自动扩充单独播放',()=>{
  const asset=JSON.parse(readFileSync('shared/sign-motions/anny/csl.hello.json','utf8'));
  const result=resolveInputPreview('你好。');assert.equal(result.status,'asset_unverified');assert.equal(result.preview.id,'csl.hello');assert.equal(result.preview.version,asset.version);
  // 「好」已有独立固定动作，不再属于 unsupported；整句仍不按子串扩展。
  for(const value of ['你好，没关系']){assert.equal(resolveInputPreview(value).status,'unsupported');assert.equal(resolveInputPreview(value).preview,null);}
});

test('好、是、不是可精确预览，资产保持未校验',()=>{
  for(const [word,id] of [['好','csl.good'],['是','csl.yes'],['不是','csl.not']]){
    const result=resolveInputPreview(word+'。');
    assert.equal(result.status,'asset_unverified');assert.equal(result.preview.id,id);
    const asset=JSON.parse(readFileSync(`shared/sign-motions/anny/${id}.json`,'utf8'));
    assert.equal(result.preview.version,asset.version);
    assert.equal(asset.status,'authored_unverified');assert.equal(asset.review,'not_reviewed');assert.equal(asset.verifiedBy,null);
  }
});

test('五个新增词可精确预览，资产保持未校验',()=>{
  for(const [word,id] of [['再见','csl.goodbye'],['对不起','csl.sorry'],['我','csl.me'],['爱','csl.love'],['你','csl.you']]){
    const result=resolveInputPreview(word+'。');assert.equal(result.preview.id,id);assert.equal(result.status,'asset_unverified');
    const asset=JSON.parse(readFileSync(`shared/sign-motions/anny/${id}.json`,'utf8'));
    assert.equal(result.preview.version,asset.version);assert.equal(asset.review,'not_reviewed');assert.equal(asset.verifiedBy,null);
  }
  assert.equal(resolveInputPreview('我爱你').preview.id,'csl.i_love_you');
  for(const phrase of ['我不爱你','我不知道'])assert.equal(resolveInputPreview(phrase).status,'unsupported');
});
