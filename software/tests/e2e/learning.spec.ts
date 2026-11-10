import {test,expect} from '@playwright/test';
import {registerForVideo,recordVideo,saveAndRecognizeVideo} from './helpers/videoPipeline';

test('学习页匿名可录制，登录保存后仍不识别，点击开始才识别且不重复保存',async({page})=>{
  await page.route('**/api/sign/status',r=>r.fulfill({json:{available:true}}));let recognized=0,saves=0;
  await page.route('**/api/sign/experiments',r=>{recognized++;return r.fulfill({json:{status:'candidate',candidate:'谢谢'}});});
  page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/records/video'))saves++;});
  await page.goto('/learning.html');await recordVideo(page);await page.getByRole('button',{name:'下一步：确认并保存'}).click();await page.getByRole('button',{name:'登录并保存录像'}).click();await expect(page.getByRole('dialog',{name:'欢迎回来'})).toBeVisible();expect(saves).toBe(0);expect(recognized).toBe(0);
  await page.getByRole('button',{name:'关闭登录窗口'}).click();await registerForVideo(page);expect(saves).toBe(0);
  await page.getByRole('button',{name:'确认保存录像'}).dblclick();await expect(page.getByRole('button',{name:'开始识别',exact:true})).toBeVisible();await page.waitForTimeout(500);expect(saves).toBe(1);expect(recognized).toBe(0);await expect(page.locator('#video-result')).toHaveCount(0);
  await page.getByRole('button',{name:'开始识别',exact:true}).click();await expect(page.getByTestId('sign-result')).toContainText('识别候选：谢谢');expect(saves).toBe(1);expect(recognized).toBe(1);
  await page.getByRole('button',{name:'退出登录'}).click();await expect(page.getByTestId('sign-result')).toHaveCount(0);await expect(page.getByLabel('本段手语录像预览')).toHaveCount(0);
});

test('未知词不作为四词候选，清空后迟到响应不恢复',async({page})=>{
  await page.route('**/api/sign/status',r=>r.fulfill({json:{available:true}}));let release:undefined|(()=>void),count=0;
  await page.route('**/api/sign/experiments',async r=>{if(++count===1)await new Promise<void>(resolve=>{release=resolve;});await r.fulfill({json:{status:'candidate',candidate:'没关系'}}).catch(()=>{});});
  await page.goto('/learning.html');await registerForVideo(page);await recordVideo(page);await saveAndRecognizeVideo(page);await expect.poll(()=>!!release).toBe(true);
  await page.getByRole('button',{name:'清空本次练习'}).click();release!();await page.waitForTimeout(100);await expect(page.getByTestId('sign-result')).toHaveCount(0);
  await recordVideo(page);await saveAndRecognizeVideo(page);await expect(page.getByTestId('sign-result')).toContainText('本次没有可靠候选');await expect(page.getByLabel('本次播报文字')).toHaveCount(0);
});

test('离开学习页停止摄像头，返回首页不自动开启设备',async({page})=>{
  await page.addInitScript(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);(window as any).__streams=[];navigator.mediaDevices.getUserMedia=async options=>{const s=await original(options);(window as any).__streams.push(s);return s;};});
  await page.goto('/learning.html');await page.getByRole('button',{name:'开启摄像头'}).click();await expect(page.getByLabel('摄像头实时预览')).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));expect(await page.evaluate(()=>(window as any).__streams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
  await page.getByRole('link',{name:'返回交流首页'}).click();await expect(page.getByRole('heading',{name:'让交流，自然发生。'})).toBeVisible();expect(await page.evaluate(()=>(window as any).__streams.length)).toBe(0);
});
