import {test,expect} from '@playwright/test';
import {registerForVideo,recordVideo,saveRecordedVideo} from './helpers/videoPipeline';
test('普通学习保存不附训练标签，历史也不再混入训练登记表',async({page})=>{
 let annotated=false;page.on('request',r=>{if(r.url().includes('/api/records/video')&&r.headers()['x-yuqiao-sample'])annotated=true;});
 await page.goto('/learning.html');await registerForVideo(page);await expect(page.getByLabel('样本类别')).toHaveCount(0);await recordVideo(page);await saveRecordedVideo(page);expect(annotated).toBe(false);
 const records=(await(await page.request.get('/api/records')).json()).records;expect((await(await page.request.get('/api/records/'+records[0].id+'/sample')).json()).sample).toBeNull();
 await page.getByRole('button',{name:'查看我的记录',exact:true}).click();await page.locator('.record-item').first().click();await expect(page.getByRole('region',{name:'试采样本登记表'})).toHaveCount(0);
});
test('学习与训练有独立入口',async({page})=>{await page.goto('/learning.html');await page.getByRole('link',{name:'动作训练',exact:true}).click();await expect(page).toHaveURL(/training.html/);await expect(page.getByText('训练教程：按这六步操作')).toBeVisible();});
