import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import scene from '../../shared/hospital-mutual-aid-scene.json' with {type:'json'};
import catalog from '../../shared/sign-motion-catalog.json' with {type:'json'};
import windows from '../../shared/sign-motion-windows.json' with {type:'json'};
import {planMotionText} from '../../shared/motion-planner.mjs';
import {planHospitalScene,hospitalScenePlaylist} from '../../shared/hospital-scene-plan.mjs';
import {composeFixedMotion} from '../../shared/compose-fixed-motion.mjs';

test('医院互助场景的每个动作都存在且版本一致，保持未校验',()=>{
  for(const motion of scene.motions){
    const entry=catalog.entries.find(item=>item.id===motion.id);
    const window=windows.entries.find(item=>item.id===motion.id);
    assert.ok(entry,`missing catalog ${motion.id}`);
    assert.equal(entry.version,motion.version,`catalog version ${motion.id}`);
    assert.ok(window,`missing window ${motion.id}`);
    assert.equal(window.version,motion.version,`window version ${motion.id}`);
    const asset=JSON.parse(readFileSync(`shared/sign-motions/anny/${motion.id}.json`,'utf8'));
    assert.equal(asset.version,motion.version,`asset version ${motion.id}`);
    assert.equal(asset.status,'authored_unverified',`asset status ${motion.id}`);
    assert.equal(asset.review,'not_reviewed',`asset review ${motion.id}`);
    assert.equal(asset.verifiedBy,null,`asset verifier ${motion.id}`);
  }
});

test('14句全部可实际合成，缺少语义明确标注且保留原文',()=>{
  const lines=planHospitalScene();assert.equal(lines.length,14);
  const assets=new Map(catalog.entries.map(e=>[e.id,JSON.parse(readFileSync('shared/sign-motions/'+e.asset,'utf8'))]));
  for(const line of lines){
    assert.ok(line.duration>0&&line.duration<=30);
    if(line.preview.kind==='sequence'){const asset=composeFixedMotion(line.preview,assets);assert.equal(asset.duration,line.duration);assert.equal(asset.review,'not_reviewed');}
    else assert.ok(assets.has(line.preview.id));
  }
  assert.equal(lines[3].text,'我第一次来，需要挂号。');assert.match(lines[3].coverageNote,/第一次来/);assert.ok(!lines[3].signText.includes('第一次'));
  assert.ok(lines[6].signText.includes('请'));assert.match(lines[11].coverageNote,/疑问/);
  assert.equal(hospitalScenePlaylist(scene.id).length,14);assert.throws(()=>hospitalScenePlaylist('unknown'));
});

test('场景每句的动作顺序与手语文本规划一致，不补造未识别动作',()=>{
  assert.equal(scene.recognitionReady,false);
  assert.equal(scene.status,'animation_trial_unverified');
  for(const line of scene.dialogue){
    const plan=planMotionText(line.signText);
    const ids=plan.status==='single'?[plan.entry.id]:plan.status==='sequence'?plan.preview.steps.map(step=>step.id):null;
    assert.deepEqual(ids,line.motionIds,`line sequence: ${line.text}`);
    for(const id of line.motionIds)assert.ok(scene.motions.some(motion=>motion.id===id),`line uses unlisted motion ${id}`);
  }
});
