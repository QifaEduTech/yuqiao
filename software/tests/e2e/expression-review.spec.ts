import {test,expect,type Page} from '@playwright/test';
import {mockExpressionForUi} from './expression-fixture';
test.beforeEach(async({page})=>mockExpressionForUi(page));
async function submit(page:Page,text:string){await page.getByLabel('输入要表达的中文').fill(text);await page.getByRole('button',{name:'提交文字',exact:true}).click();}
const avatar=(page:Page)=>page.getByTestId('avatar');
const playing=(page:Page)=>expect(avatar(page)).toHaveAttribute('data-playing','true',{timeout:30000});

test('隐藏匹配、拟表达及模型信息，原话保留，桌面和手机正常',async({page})=>{
 await page.goto('/');await submit(page,'你好呀，真的很感谢你');await playing(page);await page.getByRole('button',{name:'暂停动作',exact:true}).click();
 await expect(page.locator('.motion-match-card,.expression-engine,[data-testid="expression-plan"]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'确认表达并准备播放'})).toHaveCount(0);
 await expect(page.locator('.home-motion-title strong')).toHaveText('你好呀，真的很感谢你');await expect(page.locator('body')).not.toContainText('你好 → 谢谢 → 你');
 await page.screenshot({path:'.runtime-logs/autoplay-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/autoplay-mobile.png',fullPage:true});
});
test('不能完整表达时只提示修改，不播放认识的部分',async({page})=>{
 await page.goto('/');await submit(page,'你好呀，我不爱你');await expect(page.getByRole('status')).toContainText('暂时无法完整表达');await expect(page.getByTestId('home-motion-play')).toHaveCount(0);await expect(page.getByLabel('输入要表达的中文')).toHaveValue('你好呀，我不爱你');
});
