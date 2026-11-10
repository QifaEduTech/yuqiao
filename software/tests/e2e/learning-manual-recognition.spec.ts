import {test,expect} from '@playwright/test';
import {registerForVideo,recordVideo,saveRecordedVideo} from './helpers/videoPipeline';

test('只保存不启动预处理或识别，手动识别可停止重来且不再次保存',async({page})=>{
  await page.addInitScript(()=>{(window as any).__processingWorkers=0;const Original=window.Worker;window.Worker=class extends Original{constructor(url:string|URL,options?:WorkerOptions){(window as any).__processingWorkers++;super(url,options);}};});
  let saved=0,inferred=0,release!:()=>void;
  page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/records/video'))saved++;});
  await page.route('**/api/sign/status',r=>r.fulfill({json:{available:true}}));
  await page.route('**/api/sign/experiments',async r=>{inferred++;if(inferred===1)await new Promise<void>(resolve=>{release=resolve;});await r.fulfill({json:{status:'candidate',candidate:'谢谢'}}).catch(()=>{});});
  await page.goto('/learning.html');await registerForVideo(page);await recordVideo(page);await saveRecordedVideo(page);await page.waitForTimeout(600);
  expect(saved).toBe(1);expect(inferred).toBe(0);expect(await page.evaluate(()=>(window as any).__processingWorkers)).toBe(0);await expect(page.locator('#video-result')).toHaveCount(0);
  await page.screenshot({path:'.runtime-logs/manual-recognition-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/manual-recognition-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'开始识别',exact:true}).click();await expect.poll(()=>inferred).toBe(1);await page.getByRole('button',{name:'停止并清除本次识别'}).click();release();await page.waitForTimeout(200);await expect(page.getByTestId('sign-result')).toHaveCount(0);
  expect((await(await page.request.get('/api/records')).json()).records).toHaveLength(1);
  await page.getByRole('button',{name:'开始识别',exact:true}).click();await expect(page.getByTestId('sign-result')).toContainText('谢谢');expect(saved).toBe(1);expect(inferred).toBe(2);
  await page.getByRole('button',{name:'重新录制',exact:true}).click();await expect(page.getByTestId('sign-result')).toHaveCount(0);await expect(page.getByRole('button',{name:'开始识别',exact:true})).toHaveCount(0);
});

test('保存后重开记录只回看，需要单独点击历史识别',async({page})=>{
  let inferred=0;await page.route('**/api/sign/status',r=>r.fulfill({json:{available:true}}));await page.route('**/api/sign/experiments',r=>{inferred++;return r.fulfill({json:{status:'candidate',candidate:'帮助'}});});
  await page.goto('/learning.html');await registerForVideo(page);await recordVideo(page);await saveRecordedVideo(page);await page.reload();await expect(page.locator('.account-name')).toBeVisible();await page.getByRole('button',{name:'我的记录',exact:true}).click();const dialog=page.getByRole('dialog',{name:'我的记录',exact:true});await dialog.locator('.record-item').first().click();await expect(dialog.getByLabel('已保存的手语录像')).toBeVisible();await page.waitForTimeout(500);expect(inferred).toBe(0);
  await dialog.getByRole('button',{name:'重新识别录像',exact:true}).click();await expect(dialog.getByTestId('sign-result')).toContainText('帮助');expect(inferred).toBe(1);
});
