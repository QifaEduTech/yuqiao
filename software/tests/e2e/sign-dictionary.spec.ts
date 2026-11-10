import {test,expect} from '@playwright/test';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
test('十条分页、搜索重置与对应学习动作入口',async({page})=>{
 await page.goto('/sign-dictionary.html');await expect(page.locator('tbody tr')).toHaveCount(10);await expect(page.getByRole('columnheader')).toHaveCount(3);
 await page.getByRole('button',{name:'下一页',exact:false}).click();await expect(page.locator('#dictionary-page')).toContainText('第 2');await page.getByLabel('查找词语').fill('你好');await expect(page.locator('#dictionary-page')).toContainText('第 1');await page.locator('tr[data-id="csl.hello"]').getByRole('link',{name:'学习这个动作'}).click();await expect(page.getByLabel('选择学习动作')).toHaveValue('csl.hello');
});
test('本地HTML打开时学习链接指向本机Web',async({page})=>{
 await page.goto(pathToFileURL(resolve('web/sign-dictionary.html')).href);await expect(page.locator('tr[data-id="csl.hello"]').getByRole('link',{name:'学习这个动作'})).toHaveAttribute('href','http://127.0.0.1:5173/learning.html?motion=csl.hello');
});
