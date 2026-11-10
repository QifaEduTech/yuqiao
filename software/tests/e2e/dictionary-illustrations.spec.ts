import {test,expect} from '@playwright/test';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

test('是包含用户说明与本机手势图，放大可关闭且不出现假动画',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/sign-dictionary.html');await page.getByLabel('查找词语').fill('是');
 const row=page.locator('tr[data-id="csl.yes"]');await expect(row).toContainText('一手食、中指相搭，并点动一下。');await expect(row).toContainText('不在当前识别范围');await expect(row.getByRole('link',{name:/预览/})).toHaveCount(0);
 const image=row.getByRole('img',{name:'手语是参考图'});await expect(image).toBeVisible();await expect.poll(()=>image.evaluate(e=>(e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
 await row.getByRole('button',{name:'放大是手势图'}).click();await expect(page.getByRole('dialog',{name:'手势参考图放大'})).toBeVisible();await expect.poll(()=>page.locator('#gesture-full').evaluate(e=>(e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);await page.screenshot({path:'.runtime-logs/dictionary-shi-zoom.png'});await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByLabel('查找词语').fill('');await page.getByLabel('词条类型').selectOption('illustrated');await expect(page.locator('tbody tr:visible')).toHaveCount(Math.min(40,await page.evaluate(()=>JSON.parse(document.getElementById('dictionary-data')!.textContent!).filter((r:{illustrated:boolean})=>r.illustrated).length)));await page.screenshot({path:'.runtime-logs/dictionary-illustrated-desktop.png'});
 expect(errors).toEqual([]);
});
test('本地词典也能加载手势图，移动端放大不越界',async({page})=>{
 await page.goto(pathToFileURL(resolve('web/sign-dictionary.html')).href);await page.getByLabel('查找词语').fill('是');await page.locator('tr[data-id="csl.yes"] [data-image]').click();await expect.poll(()=>page.locator('#gesture-full').evaluate(e=>(e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);await page.getByRole('button',{name:'关闭手势图'}).click();
 await page.setViewportSize({width:390,height:844});await page.locator('tr[data-id="csl.yes"] [data-image]').click();await page.screenshot({path:'.runtime-logs/dictionary-shi-mobile.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
