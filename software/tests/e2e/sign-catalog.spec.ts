import {test,expect} from '@playwright/test';
test('文字入口沿统一四词清单匹配，已知词缺动作也不假播放',async({page,request})=>{
 const catalog=await(await request.get('/api/sign/catalog')).json();
 expect(catalog.entries.map((e:{text:string})=>e.text)).toEqual(['谢谢','帮助','需要','我']);
 await page.goto('/');
 await page.locator('.examples').getByRole('button',{name:'再见',exact:true}).click();
 await page.getByRole('button',{name:'提交文字',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('已匹配“再见”');
 await expect(page.getByRole('status')).toContainText('当前动作待核对');
 await page.getByLabel('输入要表达的中文').fill('没关系');
 await page.getByRole('button',{name:'提交文字',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('超出范围');
});
