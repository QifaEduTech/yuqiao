import {test,expect} from '@playwright/test';
import {registerForVideo,recordVideo,saveRecordedVideo} from './helpers/videoPipeline';

test('误判复盘展示原片/骨架/分数，定位和关闭可用，未登录不读取私有报告',async({page})=>{
  await page.goto('/learning.html?helpReview=28.9');await expect(page.getByRole('dialog',{name:'静止双掌误判复盘'})).toContainText('请先登录');await page.getByRole('button',{name:'关闭复盘'}).click();
  await registerForVideo(page);await recordVideo(page);await saveRecordedVideo(page);
  const record=(await(await page.request.get('/api/records')).json()).records[0];
  await page.route('**/api/sign/help-model-review',r=>r.fulfill({json:{sampleNumber:'28.9',label:'静止双掌',mediaUrl:`/api/records/${record.id}/media`,modelVersion:'v1',motionGuard:'bilateral-motion-v1',rawCandidateSeen:true,guardedCandidateSeen:false,duration:2,annotatedRange:[0,2],threshold:.5,fullClipScore:.838682,frozenFrameScore:.90728,frozenFrameTime:.5,shuffledScore:.89078,frames:Array.from({length:21},(_,i)=>({t:i/10,score:.84,candidate:null,rawCandidate:'帮助',motionSupported:false,eventState:'collecting',tracking:{width:640,height:360,mirrored:true,hands:[{side:'Left',points:Array.from({length:21},()=>[.3,.5])}]}}))}}));
  await page.getByRole('button',{name:'查看静止双掌误判'}).click();const dialog=page.getByRole('dialog',{name:'静止双掌误判复盘'});
  await expect(page.getByTestId('review-full-score')).toHaveText('0.839');await expect(dialog).toContainText('不是新拍摄');await expect(page.getByTestId('review-motion-result')).toContainText('已拦截');
  const video=page.getByLabel('静止双掌原始录像');await expect(video).toBeVisible();expect(await video.evaluate(el=>getComputedStyle(el).transform)).toBe('none');
  await page.getByRole('button',{name:/定位到静态诊断所用帧/}).click();await expect.poll(()=>video.evaluate(el=>(el as HTMLVideoElement).currentTime)).toBeCloseTo(.5,1);
  await page.screenshot({path:'.runtime-logs/help-review-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.runtime-logs/help-review-mobile.png',fullPage:true});await page.getByRole('button',{name:'关闭复盘'}).click();await expect(dialog).not.toBeVisible();await expect(video).toHaveCount(0);
});

test('复盘失效显示错误，不展示旧录像',async({page})=>{
  await page.goto('/learning.html');await registerForVideo(page);
  await page.route('**/api/sign/help-model-review',r=>r.fulfill({status:409,json:{error:'录像登记已变化，需要重新生成复盘。'}}));
  await page.getByRole('button',{name:'查看静止双掌误判'}).click();await expect(page.getByRole('alert')).toContainText('登记已变化');await expect(page.getByLabel('静止双掌原始录像')).toHaveCount(0);
});
