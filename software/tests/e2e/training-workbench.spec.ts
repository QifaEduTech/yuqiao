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
test('独立训练任务创建、无数据训练拒绝、账号数据与教程可见',async({page})=>{
 test.setTimeout(60000);
 await page.goto('/training.html');await registerForVideo(page);await page.getByLabel('搜索词典词语',{exact:true}).fill('请');await page.getByLabel('词典词语',{exact:true}).selectOption('csl.ref.bmcx.1932');await page.getByLabel('动作说明',{exact:true}).fill('双手掌心向上向旁移');await page.getByRole('button',{name:'创建动作任务'}).click();await expect(page.getByRole('heading',{name:/请 待采集/})).toBeVisible();await expect(page.getByRole('button',{name:'开始训练',exact:true})).toBeDisabled();await expect(page.getByText('内置已完成动作',{exact:true})).toBeVisible();await expect(page.getByText('训练教程：按这六步操作')).toBeVisible();
 await page.screenshot({path:'.runtime-logs/training-workbench.png',fullPage:true});
 await page.getByRole('button',{name:'开启训练摄像头'}).click();await page.getByRole('button',{name:'开始录制',exact:true}).click();await page.waitForTimeout(1200);await page.getByRole('button',{name:'结束录制'}).click();await page.getByRole('button',{name:'保存原片',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('原片已保存');await page.getByLabel('实际内容',{exact:true}).selectOption('0');await page.getByLabel('真实拍摄轮次',{exact:true}).fill('合成摄像头第一轮');await page.getByLabel('已按实际拍摄条件确认轮次，同一轮保持同一个名称').check();await page.getByLabel('已回看，动作标签与起止范围正确').check();await page.getByRole('button',{name:'确认加入数据分区'}).click();await expect(page.getByRole('cell',{name:'合成摄像头第一轮'})).toBeVisible();
 await page.getByRole('button',{name:'检查样本质量'}).click();await expect(page.locator('.training-job')).toContainText('质量检查完成',{timeout:30000});await expect(page.locator('.training-job')).toContainText('尚未训练');await expect(page.getByRole('button',{name:'启用 / 回退到此版本'})).toHaveCount(0);
});
