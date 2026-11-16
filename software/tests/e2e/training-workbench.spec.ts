import {test,expect} from '@playwright/test';
import {registerForVideo} from './helpers/videoPipeline';
test('学习左侧示范，右侧练习，不再显示训练样本登记',async({page})=>{
 await page.goto('/learning.html?motion=csl.me');await expect(page.getByRole('region',{name:'固定动作预览'})).toBeVisible();await expect(page.getByLabel('选择学习动作')).toHaveValue('csl.me');await expect(page.getByLabel('样本类别',{exact:true})).toHaveCount(0);
 const left=await page.getByRole('region',{name:'固定动作预览'}).boundingBox(),right=await page.getByLabel('学习摄像头取景区域').boundingBox();expect(left!.x).toBeLessThan(right!.x);
 await page.screenshot({path:'.runtime-logs/learning-split.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('词典每页10条，仅分类筛选，学习链接加载指定动作',async({page})=>{
 await page.goto('/sign-dictionary.html');await expect(page.locator('tbody tr')).toHaveCount(10);await expect(page.getByLabel('词条类型')).toHaveCount(0);await expect(page.getByRole('columnheader',{name:'状态与来源'})).toHaveCount(0);await expect(page.locator('#dictionary-page')).toContainText('每页 10 条');
 await page.getByRole('button',{name:'下一页',exact:false}).click();await expect(page.locator('#dictionary-page')).toContainText('第 2');await page.getByRole('searchbox',{name:'查找词语'}).fill('谢谢');await expect(page.locator('#dictionary-page')).toContainText('第 1');await page.locator('tr[data-id="csl.thanks"]').getByRole('link',{name:'学习这个动作'}).click();await expect(page.getByLabel('选择学习动作')).toHaveValue('csl.thanks');
});
test('简洁录制：开始、结束、确认保存，自动轮次且无需旧词检查',async({page})=>{
 test.setTimeout(60000);await page.goto('/training.html');await registerForVideo(page);await page.getByRole('button',{name:'创建任务',exact:true}).click();await page.getByLabel('搜索词典词语',{exact:true}).fill('请');await page.getByLabel('词典词语',{exact:true}).selectOption('csl.ref.bmcx.1932');await page.getByRole('button',{name:'创建这张任务卡片'}).click();await page.getByRole('button',{name:'打开任务：请'}).click();
 await page.getByRole('button',{name:'用来学习：不是这个词，点击录制'}).click();await expect(page.locator('.training-round')).toHaveCount(0);await expect(page.getByTestId('avatar')).toHaveCount(0);await expect(page.getByText('补充检查以前会的词',{exact:true})).toHaveCount(0);
 await page.screenshot({path:'.runtime-logs/training-minimal-desktop.png',fullPage:true});const jobs:string[]=[];page.on('request',r=>{if(r.url().endsWith('/jobs')&&r.method()==='POST')jobs.push(r.postDataJSON().kind);});
 await page.getByRole('button',{name:'开始录制',exact:true}).click();await page.getByRole('button',{name:'结束录制'}).waitFor();await page.waitForTimeout(1000);await page.getByRole('button',{name:'结束录制'}).click();await page.getByRole('button',{name:'确认保存'}).click();await expect(page.getByRole('status')).toContainText('已放入');await expect(page.getByRole('button',{name:'用来学习：不是这个词，点击录制'})).toContainText('1 / 3条');
 const response=await page.request.get('/api/training/state');const state=await response.json();expect(state.actions[0].samples[0]).toMatchObject({groupSource:'automatic',realGroupConfirmed:false,split:'train',label:0});expect(state.actions[0].samples[0].group).toMatch(/^自动第/);expect(jobs).toEqual([]);
 await expect(page.getByRole('button',{name:'开始训练',exact:true})).toBeDisabled();await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/training-minimal-mobile.png',fullPage:true});
});
