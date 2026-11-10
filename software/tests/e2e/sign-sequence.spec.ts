import {test,expect} from '@playwright/test';

test('我爱你从首页进入连续预览，统一暂停、定位与词典顺序',async({page,request})=>{
 const catalog=await(await request.get('/api/sign/catalog')).json();expect(catalog.entries).toHaveLength(4);
 await page.goto('/');await page.getByLabel('输入要表达的中文').fill('我爱你');await page.getByRole('button',{name:'提交文字',exact:true}).click();
 const link=page.getByRole('link',{name:'预览“我爱你”动作',exact:true});await expect(link).toBeVisible();
 const href=(await link.getAttribute('href'))!;await page.goto(href);
 await expect(page.getByTestId('motion-play')).toBeEnabled({timeout:30000});await expect(page.getByLabel('连续动作顺序')).toContainText('我 → 爱 → 你');
 await page.getByRole('slider',{name:'动作进度'}).evaluate(el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,'1.5');el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.getByTestId('motion-play').click();await expect(page.getByTestId('sequence-current')).toContainText('当前片段：爱');
 await page.getByRole('button',{name:'暂停动作',exact:true}).click();await page.waitForTimeout(150);const paused=await page.getByRole('slider',{name:'动作进度'}).inputValue();await page.waitForTimeout(150);expect(await page.getByRole('slider',{name:'动作进度'}).inputValue()).toBe(paused);
 await page.goto('/sign-dictionary.html');const row=page.locator('tr[data-word="我爱你"]');await expect(row).toContainText('我 → 爱 → 你');await expect(row.getByRole('link',{name:'预览“我爱你”'})).toHaveAttribute('href',href);
});
