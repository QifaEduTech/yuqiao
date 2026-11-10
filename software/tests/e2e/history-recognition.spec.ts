import {test,expect,type Page} from '@playwright/test';
import {registerForVideo,recordVideo,saveAndRecognizeVideo} from './helpers/videoPipeline';

async function setup(page:Page){
 await page.route('**/api/sign/status',r=>r.fulfill({json:{available:true}}));
 await page.route('**/api/sign/experiments',r=>r.fulfill({json:{status:'candidate',candidate:'帮助'}}));
 await page.goto('/');await registerForVideo(page);await recordVideo(page);await saveAndRecognizeVideo(page);await expect(page.getByTestId('sign-result')).toContainText('识别候选：帮助');
 const list=await(await page.request.get('/api/records')).json();return list.records[0];
}
async function openRecord(page:Page){await page.getByRole('button',{name:'查看我的记录',exact:true}).click();const dialog=page.getByRole('dialog',{name:'我的记录',exact:true});await dialog.locator('.record-item').first().click();return dialog;}

test('保留录像可重复单动作识别，旧多动作入口停用，原文件与记录数量不变',async({page})=>{
 const record=await setup(page),before=await(await page.request.get(`/api/records/${record.id}/media`)).body();const dialog=await openRecord(page);
 await dialog.getByRole('button',{name:'重新识别录像',exact:true}).click();await expect(dialog.getByTestId('sign-result')).toContainText('识别候选：帮助');await expect(dialog.getByLabel('本次播报文字')).toHaveCount(0);
 await dialog.getByRole('button',{name:'重新识别录像',exact:true}).click();await expect(dialog.getByTestId('sign-result')).toContainText('识别候选：帮助');await expect(dialog.getByLabel('本次播报文字')).toHaveCount(0);
 await expect(dialog.getByRole('combobox',{name:'历史录像识别方式'})).toHaveCount(0);
 expect((await(await page.request.get('/api/records')).json()).records).toHaveLength(1);expect(Buffer.compare(before,await(await page.request.get(`/api/records/${record.id}/media`)).body())).toBe(0);
 await page.screenshot({path:'.runtime-logs/history-recognition-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:'.runtime-logs/history-recognition-mobile.png',fullPage:true});
});

test('识别中删除录像，文件和记录消失，迟到结果及首页旧候选均不恢复',async({page})=>{
 const record=await setup(page);let release:(()=>void)|undefined;
 await page.route('**/api/sign/experiments',async r=>{await new Promise<void>(resolve=>{release=resolve;});await r.fulfill({json:{status:'candidate',candidate:'谢谢'}}).catch(()=>{});});
 const dialog=await openRecord(page);await dialog.getByRole('button',{name:'重新识别录像',exact:true}).click();await expect.poll(()=>!!release).toBe(true);
 await dialog.getByRole('button',{name:'删除这条记录',exact:true}).click();await expect(dialog).toContainText('将删除录像文件及这条记录');await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await expect(dialog.locator('.record-item')).toHaveCount(0);release!();await page.waitForTimeout(150);await expect(dialog.getByTestId('sign-result')).toHaveCount(0);
 expect((await page.request.get(`/api/records/${record.id}/media`)).status()).toBe(404);await dialog.getByRole('button',{name:'关闭我的记录'}).click();await expect(page.getByTestId('sign-result')).toHaveCount(0);await expect(page.getByLabel('本段手语录像预览')).toHaveCount(0);
});

test('关闭窗口取消读取或识别，已在别处删除的录像不会继续识别',async({page})=>{
 const record=await setup(page);const dialog=await openRecord(page);let release:(()=>void)|undefined;
 await page.route(`**/api/records/${record.id}/media`,async r=>{if(r.request().resourceType()!=='fetch')return r.continue();await new Promise<void>(resolve=>{release=resolve;});await r.continue().catch(()=>{});});
 await dialog.getByRole('button',{name:'重新识别录像',exact:true}).click();await expect.poll(()=>!!release).toBe(true);await dialog.getByRole('button',{name:'关闭我的记录'}).click();release!();await page.unroute(`**/api/records/${record.id}/media`);await page.waitForTimeout(100);
 const reopened=await openRecord(page);await expect(reopened.getByTestId('sign-result')).toHaveCount(0);await page.request.delete(`/api/records/${record.id}`,{headers:{Origin:'http://127.0.0.1:5183','X-Yuqiao-Request':'1'}});
 await reopened.getByRole('button',{name:'重新识别录像',exact:true}).click();await expect(reopened.getByRole('alert')).toContainText('不存在或已删除');await expect(reopened.getByLabel('本次播报文字')).toHaveCount(0);
});
