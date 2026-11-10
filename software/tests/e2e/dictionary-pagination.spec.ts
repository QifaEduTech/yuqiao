import {test,expect} from '@playwright/test';
test('分页查阅只渲染当前页，搜索和图片放大可继续使用',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/sign-dictionary.html');
 await page.evaluate(`(()=>{const template=dictionaryData.find(x=>x.word==='是');for(let i=0;i<85;i++)dictionaryData.push({...template,word:'分页测试'+i,html:template.html.replaceAll('是','分页测试'+i)});filterRows();})()`);
 await expect(page.locator('tbody tr')).toHaveCount(40);await page.getByRole('button',{name:'下一页 →',exact:true}).click();await expect(page.locator('#dictionary-page')).toContainText('第 2 /');await expect(page.locator('tbody tr')).toHaveCount(40);
 await page.getByLabel('查找词语').fill('分页测试84');await expect(page.locator('tbody tr')).toHaveCount(1);await page.getByRole('button',{name:'放大分页测试84手势图'}).click();await expect(page.getByRole('dialog',{name:'手势参考图放大'})).toBeVisible();await expect.poll(()=>page.locator('#gesture-full').evaluate(e=>(e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);await page.keyboard.press('Escape');
 await page.getByLabel('查找词语').fill('没有这个词');await expect(page.locator('#dictionary-empty')).toBeVisible();expect(errors).toEqual([]);
});
