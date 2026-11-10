import {test,expect} from '@playwright/test';
import {registerForVideo,recordVideo,saveAndRecognizeVideo} from './helpers/videoPipeline';

test('真实浏览器录像保存后手动开始，无手画面不生成汉字',async({page,request})=>{
 test.setTimeout(60000);const status=await(await request.get('/api/sign/status')).json();test.skip(!status.available,'本机动作模型尚未安装');
 await page.goto('/learning.html');await registerForVideo(page);await recordVideo(page);
 const responsePromise=page.waitForResponse('**/api/sign/experiments');await saveAndRecognizeVideo(page);const response=await responsePromise;expect(response.ok(),await response.text()).toBe(true);
 await expect(page.getByTestId('sign-result')).toContainText('本次没有可靠候选',{timeout:45000});await expect(page.getByTestId('sign-result')).toContainText('没有足够的清晰手部画面');
});

test('当前录像保存成功并手动开始后才识别，结果清除且无旧实验入口',async({page})=>{
 await page.route('**/api/sign/status',route=>route.fulfill({json:{available:true}}));let submissions=0;
 await page.route('**/api/sign/experiments',async route=>{submissions++;expect(route.request().headers()['content-type']).toBe('video/webm');expect(route.request().postDataBuffer()!.length).toBeGreaterThan(32);await route.fulfill({json:{status:'candidate',candidate:'你好'}});});
 await page.goto('/learning.html');await registerForVideo(page);await recordVideo(page);expect(submissions).toBe(0);await expect(page.getByRole('button',{name:'开始动作识别实验',exact:true})).toHaveCount(0);await saveAndRecognizeVideo(page);
 await expect(page.getByTestId('sign-result')).toContainText('识别候选：你好');await expect(page.getByTestId('sign-result')).not.toContainText('模型分数');
 await page.getByRole('button',{name:'清空本次练习'}).click();await expect(page.getByTestId('sign-result')).toHaveCount(0);expect(submissions).toBe(1);
});

test('取消迟到的动作响应，不确定候选不显示诊断详情或可播文字',async({page})=>{
 await page.route('**/api/sign/status',route=>route.fulfill({json:{available:true}}));let release:(()=>void)|undefined,count=0;
 await page.route('**/api/sign/experiments',async route=>{if(++count===1)await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({json:{status:'uncertain',candidate:null,score:.985,reason:'有手区间内可见比例33.7%',checks:[{detail:'不应展示的指标'}],diagnostic_id:'test-diagnostic'}}).catch(()=>{});});
 await page.goto('/learning.html');await registerForVideo(page);await recordVideo(page);await saveAndRecognizeVideo(page);await expect.poll(()=>Boolean(release)).toBe(true);await page.getByRole('button',{name:'取消识别',exact:true}).click();release!();await page.waitForTimeout(150);await expect(page.getByTestId('sign-result')).toHaveCount(0);
 await page.getByRole('button',{name:'重试识别',exact:true}).click();await expect(page.getByTestId('sign-result')).toContainText('本次没有可靠候选');await expect(page.getByLabel('本次播报文字')).toHaveCount(0);await expect(page.getByTestId('sign-result')).not.toContainText('test-diagnostic');await expect(page.getByTestId('sign-result')).not.toContainText('33.7%');
 await page.getByRole('link',{name:'返回交流首页',exact:true}).click();await expect(page.getByTestId('sign-result')).toHaveCount(0);
});
