import {test,expect} from '@playwright/test';

test('任务内只有训练集和测试集，旧检查资料归训练视图，默认录当前动作',async({page})=>{
 const samples=[{recordId:'old-learning',split:'train',label:1,start:0,end:2,group:'旧组'}, {recordId:'old-validation',split:'validation',label:0,start:0,end:2,group:'旧检查组'}, {recordId:'old-test',split:'test',label:1,start:0,end:2,group:'测试组'}];
 await page.route('**/api/training/state',r=>r.fulfill({json:{runtimeMode:'unified-tcn',busy:false,jobs:[],actions:[{id:'one',text:'谢谢',samples,state:'collecting',activeVersion:null}]}}));
 await page.route('**/api/training/sources',r=>r.fulfill({json:{sources:[]}}));
 await page.goto('/training.html');await expect(page.getByRole('button',{name:'打开任务：谢谢',exact:true})).toContainText('训练集2条');await page.getByRole('button',{name:'打开任务：谢谢',exact:true}).click();
 await expect(page.locator('.training-folder')).toHaveCount(2);await expect(page.getByRole('button',{name:'训练集，点击录制',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'测试集，点击录制',exact:true})).toBeVisible();
 await expect(page.locator('main')).not.toContainText(/用来学习|练习后检查|最后考试|\/ 3条/);
 await page.getByRole('button',{name:'训练集，点击录制',exact:true}).click();await expect(page.locator('.training-file')).toHaveCount(2);await expect(page.getByText('当前录制：谢谢',{exact:true})).toBeVisible();
 await page.getByText('添加其他动作或背景',{exact:true}).click();await page.getByRole('checkbox',{name:'这条视频不是“谢谢”，用于检查误识别'}).check();await expect(page.getByText('当前录制：其他动作或背景',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'测试集，点击录制',exact:true}).click();await expect(page.locator('.training-file')).toHaveCount(1);await expect(page.getByText('当前录制：谢谢',{exact:true})).toBeVisible();
 await page.screenshot({path:'.runtime-logs/two-datasets-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/two-datasets-mobile.png',fullPage:true});
});
