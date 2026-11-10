import {test,expect,type Page} from '@playwright/test';
import {mockExpressionForUi} from './expression-fixture';
test.beforeEach(async({page})=>mockExpressionForUi(page));
async function submit(page:Page,text:string){await page.getByLabel('输入要表达的中文').fill(text);await page.getByRole('button',{name:'提交文字',exact:true}).click();}
const avatar=(page:Page)=>page.getByTestId('avatar');
const playing=(page:Page)=>expect(avatar(page)).toHaveAttribute('data-playing','true',{timeout:30000});

test('一次提交连续播完整段，只显示原话与通用播放状态',async({page})=>{
 await page.goto('/');await submit(page,'你好，我爱你');await playing(page);
 await expect(page.getByRole('slider',{name:'首页动作进度'})).toHaveAttribute('max','11.6');
 await page.getByRole('combobox',{name:'首页动作速度'}).selectOption('1.5');await expect(page.getByTestId('home-motion-current')).toHaveText('本段播放结束',{timeout:12000});
 await expect(page.getByLabel('输入要表达的中文')).toHaveValue('你好，我爱你');await expect(page.getByRole('region',{name:'当前内容'})).toContainText('你好，我爱你');
});
test('资源迟到不能播放已清空的旧句子',async({page})=>{
 let release:()=>void;await page.route('**/shared/sign-motions/anny/csl.love.json*',async r=>{if(r.request().resourceType()!=='fetch')return r.continue();await new Promise<void>(done=>{release=done});await r.continue().catch(()=>{});});
 await page.goto('/');await submit(page,'你好我爱你');await expect.poll(()=>!!release).toBe(true);await page.getByRole('button',{name:'清空本次交流'}).click();release!();await page.waitForTimeout(250);await expect(avatar(page)).toHaveAttribute('data-playing','false');await expect(page.getByTestId('home-motion-play')).toHaveCount(0);
});
