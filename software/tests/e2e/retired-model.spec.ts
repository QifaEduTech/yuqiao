import {test,expect} from '@playwright/test';
test('旧模型页面只显示退役说明，不能再录制或提交',async({page})=>{
 await page.goto('/continuous-review.html');
 await expect(page.getByRole('heading',{name:'该模型已停用并删除'})).toBeVisible();
 await expect(page.getByRole('button')).toHaveCount(0);
 await page.getByRole('link',{name:'进入手语学习 · 单动作练习'}).click();
 await expect(page.getByRole('heading',{name:'识别结果',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'开始动作识别实验',exact:true})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'进入整段视频独立测试 →'})).toHaveCount(0);
});
