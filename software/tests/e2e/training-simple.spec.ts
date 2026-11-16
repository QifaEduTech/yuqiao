import {test,expect,type Page} from '@playwright/test';

async function folders(page:Page,{failOnce=false,ready=false}={}){
 const action={id:'a',text:'你',description:'一手食指指向对方。',motion:'static',hands:1,state:'collecting',revision:1,samples:[] as any[],activeVersion:null};
 if(ready)for(const split of ['train','validation'])for(const label of [0,1])for(let i=0;i<3;i++)action.samples.push({recordId:split+label+i,start:0,end:2,split,label,group:'synthetic'});
 const requests:any[]=[],jobs:any[]=[];let uploads=0,failed=false;
 await page.route('**/api/training/actions/a/jobs',r=>{jobs.push(r.request().postDataJSON());return r.fulfill({json:{ok:true}});});
 await page.route('**/api/training/state',r=>r.fulfill({json:{actions:[action],jobs:[],busy:false}}));
 await page.route('**/api/training/sources',r=>r.fulfill({json:{sources:['long','next','third'].map(id=>({id,text:'已有录像',duration:8,legacy:false}))}}));
 await page.route('**/api/records/video?**',r=>{uploads++;return r.fulfill({json:{record:{id:'uploaded'}}});});
 await page.route('**/api/training/actions/a',r=>{
  const body=r.request().postDataJSON();requests.push(body);
  if(failOnce&&!failed){failed=true;return r.fulfill({status:503,json:{error:'模拟加入失败，请重试'}});}
  if(body.operation==='sample')action.samples=[...action.samples.filter(s=>s.recordId!==body.recordId),body];
  if(body.operation==='removeSample')action.samples=action.samples.filter(s=>s.recordId!==body.recordId);
  return r.fulfill({json:{actions:[action],jobs:[],busy:false}});
 });
 await page.goto('/training.html');await page.getByRole('button',{name:'打开任务：你'}).click();
 return {requests,jobs,uploads:()=>uploads};
}

for(const [split,title] of [['train','用来学习'],['validation','练习后检查'],['test','最后考试']]){
 for(const label of [1,0])test(`${title}的${label?'这个词':'不是这个词'}入口固定归类，8秒整片直接加入`,async({page})=>{
  const state=await folders(page);const name=`${title}：${label?'这个词':'不是这个词'}，点击录制`;
  await page.getByRole('button',{name,exact:true}).click();
  await expect(page.getByLabel('实际内容',{exact:true})).toHaveCount(0);await expect(page.getByLabel('数据用途',{exact:true})).toHaveCount(0);
  await page.getByText('添加已有视频',{exact:true}).click();await page.getByLabel('选择已保存录像').selectOption('long');

  await page.getByRole('button',{name:'确认保存'}).click();await expect.poll(()=>state.requests.length).toBe(1);
  expect(state.requests[0]).toMatchObject({split,label,recordId:'long',start:0,end:8,groupMode:'automatic',reviewed:true});expect(state.uploads()).toBe(0);
  await expect(page.getByRole('button',{name,exact:true})).toContainText('1 / '+(split==='test'?20:3)+'条');
  await expect(page.locator('.training-file')).toHaveCount(1);
 });
}

test('轮次自动记录：同用途正反例共用批次，不同用途另记，无确认表',async({page})=>{
 const state=await folders(page);
 for(const [name,source] of [['用来学习：这个词，点击录制','long'],['用来学习：不是这个词，点击录制','next'],['最后考试：不是这个词，点击录制','third']]){
  await page.getByRole('button',{name,exact:true}).click();await expect(page.getByText('先确认一次拍摄轮次',{exact:true})).toHaveCount(0);
  if(!await page.getByLabel('选择已保存录像').isVisible())await page.getByText('添加已有视频',{exact:true}).click();
  await page.getByLabel('选择已保存录像').selectOption(source);await page.getByRole('button',{name:'确认保存'}).click();await expect(page.getByRole('status')).toContainText('已放入');
 }
 expect(state.requests).toHaveLength(3);expect(state.requests[0].batchId).toBe(state.requests[1].batchId);expect(state.requests[2].batchId).not.toBe(state.requests[0].batchId);expect(state.requests.every(r=>r.groupMode==='automatic'&&r.realGroupConfirmed===undefined)).toBe(true);
});

test('负例录制保持归类，加入失败重试不重复上传且保护未保存录像',async({page})=>{
 const state=await folders(page,{failOnce:true});await page.getByRole('button',{name:'用来学习：不是这个词，点击录制'}).click();
 await page.getByRole('button',{name:'开始录制',exact:true}).click();await page.getByRole('button',{name:'结束录制'}).waitFor();await page.waitForTimeout(1000);await page.getByRole('button',{name:'结束录制'}).click();
 await expect(page.getByRole('button',{name:'最后考试：这个词，点击录制'})).toBeDisabled();await expect(page.getByRole('button',{name:'全部任务'})).toBeDisabled();
 await page.getByRole('button',{name:'确认保存'}).click();await expect(page.getByRole('alert')).toContainText('原片已经保存');
 await page.getByRole('button',{name:'确认保存'}).click();await expect.poll(()=>state.requests.length).toBe(2);expect(state.uploads()).toBe(1);expect(state.requests.every(r=>r.split==='train'&&r.label===0)).toBe(true);
 await expect(page.getByRole('button',{name:'用来学习：不是这个词，点击录制'})).toContainText('1 / 3条');
});

test('无旧词检查，资料够后可直接手动开始训练',async({page})=>{
 const state=await folders(page,{ready:true});await expect(page.getByText('补充检查以前会的词',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'检查样本质量'})).toHaveCount(0);
 const start=page.getByRole('button',{name:'开始训练',exact:true});await expect(start).toBeEnabled();expect(state.jobs).toHaveLength(0);await start.click();await expect.poll(()=>state.jobs.length).toBe(1);expect(state.jobs[0]).toEqual({kind:'train'});
});

test('电脑视频导入当前文件夹，自动记录轮次且不自动训练',async({page})=>{
 const state=await folders(page);await page.getByRole('button',{name:'练习后检查：不是这个词，点击录制'}).click();
 const bytes=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;canvas.getContext('2d')!.fillRect(0,0,64,64);
  const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks:Blob[]=[];
  const finished=new Promise<Blob>(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=()=>resolve(new Blob(chunks,{type:'video/webm'}));});
  recorder.start();const paint=setInterval(()=>canvas.getContext('2d')!.fillRect(0,0,64,64),50);await new Promise(resolve=>setTimeout(resolve,1000));clearInterval(paint);recorder.stop();const result=await finished;stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(await result.arrayBuffer()));
 });
 await page.getByText('添加已有视频',{exact:true}).click();await page.locator('input[type=file]').setInputFiles({name:'synthetic.webm',mimeType:'video/webm',buffer:Buffer.from(bytes)});
 await page.getByRole('button',{name:'确认保存'}).click();
 await expect.poll(()=>state.requests.length).toBe(1);expect(state.uploads()).toBe(1);expect(state.requests[0]).toMatchObject({split:'validation',label:0,start:0,groupMode:'automatic'});expect(state.requests[0].end).toBeGreaterThan(.5);
});
