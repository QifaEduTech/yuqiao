import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {withTrainingReassessment} from '../../server/training-report-view.mjs';
test('补充分层复查保留旧成绩与启用决定，错误模型和损坏附件不采用',t=>{
 const parent=resolve('.runtime-logs/layered-report-tests');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'case-'));t.after(()=>{assert.ok(dir.startsWith(parent+sep));rmSync(dir,{recursive:true,force:true});});
 const id='a1111111-1111-4111-8111-111111111111',job={id,status:'needs_data',report:{trained:true,passed:false,modelSha256:'a'.repeat(64),perClass:[{text:'你',recall:0}]}};
 const folder=join(dir,id);mkdirSync(folder);const file=join(folder,'evaluation-layers.json');const review={jobId:id,modelSha256:job.report.modelSha256,mode:'diagnostic_replay',evaluationVersion:'joint-layered-evaluation-v1',perClass:job.report.perClass,recordingPerClass:[{text:'你',recall:.6}],passed:true};
 writeFileSync(file,JSON.stringify(review));const out=withTrainingReassessment(job,dir);assert.equal(out.report.passed,false);assert.equal(out.report.perClass[0].recall,0);assert.equal(out.report.reassessment.recordingPerClass[0].recall,.6);assert.equal(job.report.reassessment,undefined);
 writeFileSync(file,JSON.stringify({...review,modelSha256:'wrong'}));assert.equal(withTrainingReassessment(job,dir),job);writeFileSync(file,'broken');assert.equal(withTrainingReassessment(job,dir),job);
});
