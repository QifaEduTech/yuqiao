import {test,expect} from '@playwright/test';

test('失败视频有醒目标记，取消不删除，确认删除记录与视频并清除旧提示',async({page})=>{
 const a={id:'one',text:'你',state:'collecting',activeVersion:null,samples:[{recordId:'bad',split:'train',label:1,start:0,end:2,group:'自动轮次'},{recordId:'good',split:'test',label:1,start:0,end:2,group:'自动轮次'}]};
 const state={runtimeMode:'unified-tcn',busy:false,actions:[a],jobs:[{id:'job',kind:'unified',createdAt:1,status:'needs_data',message:'部分目标视频质量不足',report:{trained:false,passed:false,quality:[{recordId:'bad',passed:false,reason:'未检测到有效手部骨架，请回看视频，删除后重新录制。'}]}}]};
 let deletes=0;await page.route('**/api/training/state',r=>r.fulfill({json:state}));await page.route('**/api/training/sources',r=>r.fulfill({json:{sources:[]}}));
 await page.route('**/api/records/bad',r=>{expect(r.request().method()).toBe('DELETE');deletes++;a.samples=a.samples.filter(s=>s.recordId!=='bad');return r.fulfill({json:{ok:true}});});
 await page.goto('/training.html');const section=page.getByRole('region',{name:'质量不足的视频'});await expect(section).toContainText('录像 01');await expect(section).toContainText('未检测到有效手部骨架');
 await page.getByRole('button',{name:'打开任务：你',exact:true}).click();await page.getByRole('button',{name:'训练集，点击录制',exact:true}).click();await expect(page.locator('.training-file-invalid')).toHaveCount(1);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/training-quality-mobile.png',fullPage:true});
 page.once('dialog',d=>{expect(d.message()).toContain('记录和视频文件');void d.dismiss();});await page.locator('.training-file-invalid').getByRole('button',{name:'删除记录及视频'}).click();expect(deletes).toBe(0);
 page.once('dialog',d=>d.accept());await page.locator('.training-file-invalid').getByRole('button',{name:'删除记录及视频'}).click();await expect(section).toHaveCount(0);expect(deletes).toBe(1);await expect(page.locator('.training-file')).toHaveCount(0);
 await page.getByRole('button',{name:'测试集，点击录制',exact:true}).click();await expect(page.locator('.training-file')).toHaveCount(1);
});
