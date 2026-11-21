import {test,expect,type Page} from '@playwright/test';

async function task(page:Page){
 const action={id:'you',text:'你',state:'collecting',activeVersion:null,samples:[] as any[]};let uploads=0;
 await page.route('**/api/training/state',r=>r.fulfill({json:{runtimeMode:'unified-tcn',actions:[action],jobs:[],busy:false}}));
 await page.route('**/api/training/sources',r=>r.fulfill({json:{sources:[]}}));
 await page.route('**/api/records/video?**',r=>r.fulfill({json:{record:{id:'record-'+(++uploads)}}}));
 await page.route('**/api/training/actions/you',r=>{const body=r.request().postDataJSON();action.samples.push(body);return r.fulfill({json:{ok:true}});});
 await page.goto('/training.html');await page.getByRole('button',{name:'打开任务：你',exact:true}).click();await page.getByRole('button',{name:'训练集，点击录制',exact:true}).click();
 return {action,uploads:()=>uploads};
}

test('录制结束保存后可连续录下一条，未保存视频不能切换丢失',async({page})=>{
 const f=await task(page);
 for(let i=0;i<2;i++){
  await page.getByRole('button',{name:'开始录制',exact:true}).click();await expect(page.getByRole('button',{name:'结束录制',exact:true})).toBeVisible();
  await expect.poll(()=>page.getByLabel('训练摄像头画面').evaluate((v:HTMLVideoElement)=>!!v.srcObject)).toBe(true);
  await page.waitForTimeout(1100);await page.getByRole('button',{name:'结束录制',exact:true}).click();
  await expect(page.getByRole('button',{name:'测试集，点击录制',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'确认保存',exact:true}).click();await expect(page.locator('.training-file')).toHaveCount(i+1);
 }
 expect(f.uploads()).toBe(2);expect(f.action.samples.every(s=>s.split==='train'&&s.label===1&&s.end>=.5)).toBe(true);
});

for(const [name,message] of [['NotAllowedError','设备访问未获允许'],['NotReadableError','其他应用占用']])test(`${name}错误可见且允许重试录制`,async({page})=>{
 await page.addInitScript(({name})=>{const devices=navigator.mediaDevices,original=devices.getUserMedia.bind(devices);let first=true;devices.getUserMedia=(constraints)=>{if(first){first=false;return Promise.reject(new DOMException('test',name));}return original(constraints);};},{name});
 await task(page);await page.getByRole('button',{name:'开始录制',exact:true}).click();await expect(page.getByRole('alert')).toContainText(message);
 await page.getByRole('button',{name:'重新开启摄像头',exact:true}).click();await expect(page.getByRole('button',{name:'结束录制',exact:true})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
 await page.waitForTimeout(600);await page.getByRole('button',{name:'结束录制',exact:true}).click();await expect(page.getByRole('button',{name:'确认保存',exact:true})).toBeEnabled();
});
