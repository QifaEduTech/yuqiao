import {test,expect,type Page} from '@playwright/test';
import {registerForVideo,recordVideo,saveAndRecognizeVideo} from './helpers/videoPipeline';
async function setup(page:Page){await page.route('**/api/sign/status',r=>r.fulfill({json:{available:true}}));await page.goto('/learning.html');await registerForVideo(page);}
test('左侧示范播放与选词不改变右侧识别候选，学习无语音',async({page})=>{
 await page.route('**/api/sign/experiments',r=>r.fulfill({json:{status:'candidate',candidate:'帮助'}}));await setup(page);await page.getByLabel('选择学习动作').selectOption('csl.me');await expect(page.getByTestId('learning-motion-play')).toBeEnabled({timeout:30000});await page.getByTestId('learning-motion-play').click();await expect(page.getByTestId('avatar')).toHaveAttribute('data-playing','true');await page.getByRole('button',{name:'暂停动作',exact:true}).click();
 await recordVideo(page);await saveAndRecognizeVideo(page);await expect(page.getByTestId('sign-result')).toContainText('识别候选：帮助');await expect(page.getByLabel('选择学习动作')).toHaveValue('csl.me');await expect(page.getByLabel('本次播报文字')).toHaveCount(0);
});
test('多动作和冲突不强选词，无结束边界不冒充完整动作',async({page})=>{
 let result:any={status:'uncertain',candidate:null,reason:'multiple_actions_detected'};await page.route('**/api/sign/experiments',r=>r.fulfill({json:result}));await setup(page);await recordVideo(page);await saveAndRecognizeVideo(page);await expect(page.getByTestId('sign-result')).toContainText('本段可能包含多个动作');await expect(page.getByTestId('sign-result')).not.toContainText('识别候选：');
 result={status:'uncertain',candidate:null,reason:'conflicting_evidence'};await page.getByRole('button',{name:'重试识别'}).click();await expect(page.getByTestId('sign-result')).toContainText('本段动作证据存在冲突');
 result={status:'candidate',candidate:'需要',end_boundary_observed:false};await page.getByRole('button',{name:'重试识别'}).click();await expect(page.getByTestId('sign-result')).toContainText('识别候选：需要');await expect(page.getByTestId('sign-result')).toContainText('未观察到结束边界');await expect(page.getByLabel('本次播报文字')).toHaveCount(0);
});
