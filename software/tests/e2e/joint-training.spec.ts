import {test,expect} from '@playwright/test';

test('原四词可建资料卡，移除后归档可恢复；缺资料不虚报开始训练',async({page})=>{
 await page.goto('/training.html');await expect(page.getByRole('button',{name:'开始统一训练',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'创建任务',exact:true}).click();await page.getByLabel('搜索词典词语').fill('谢谢');await page.getByLabel('词典词语',{exact:true}).selectOption('csl.thanks');await page.getByRole('button',{name:'创建这张任务卡片',exact:true}).click();
 await page.getByRole('button',{name:'打开任务：谢谢',exact:true}).click();await expect(page.getByRole('button',{name:'移除这个任务文件夹',exact:true})).toBeVisible();page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'移除这个任务文件夹',exact:true}).click();
 await expect(page.getByRole('button',{name:'打开任务：谢谢',exact:true})).toHaveCount(0);await page.getByText('已归档任务（1）',{exact:true}).click();await page.getByRole('button',{name:'恢复任务',exact:true}).click();await expect(page.getByRole('button',{name:'打开任务：谢谢',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'开始统一训练',exact:true}).click();await expect(page.getByRole('alert')).toContainText('还没有准备好的动作');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/joint-training-mobile.png',fullPage:true});
});
test('已有动作批量建立且不重复，不会启动训练',async({page})=>{
 await page.goto('/training.html');await page.getByRole('button',{name:'添加已有动作任务',exact:true}).click();await expect(page.locator('.training-task-card')).toHaveCount(34);await page.getByRole('button',{name:'添加已有动作任务',exact:true}).click();await expect(page.locator('.training-task-card')).toHaveCount(34);
 const state=await(await page.request.get('/api/training/state')).json();expect(state.jobs.some((j:any)=>j.status==='running')).toBe(false);expect(state.limits.maxActions).toBe(64);
 await page.screenshot({path:'.runtime-logs/joint-training-desktop.png',fullPage:true});
});
