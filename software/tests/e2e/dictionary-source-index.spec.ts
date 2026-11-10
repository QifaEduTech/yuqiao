import {test,expect} from '@playwright/test';
test('词典只展示分类与解释，来源留存但不在列表显示',async({page,request})=>{
 const external:string[]=[];page.on('request',r=>{if(!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))external.push(r.url());});
 await page.goto('/sign-dictionary.html');await expect(page.locator('tbody tr')).toHaveCount(10);await expect(page.getByLabel('词条类型')).toHaveCount(0);
 await page.getByLabel('词条分类').selectOption('社交');await page.getByLabel('查找词语').fill('联系');const row=page.locator('tr[data-id="csl.ref.bmcx.95"]');await expect(row).toContainText('互相连环');await expect(row).toContainText('暂无示范');await expect(row.locator('details')).toHaveCount(0);
 expect(external).toEqual([]);const catalog=await(await request.get('/api/sign/catalog')).json();expect(catalog.entries.map((e:{text:string})=>e.text)).toEqual(['谢谢','帮助','需要','我']);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
