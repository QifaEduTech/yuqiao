import {test,expect} from '@playwright/test';
import {validateLanguagePlan} from '../../server/local-language.mjs';
const suggestion=()=>validateLanguagePlan('哈喽，多谢你了',{units:[{source:'哈喽',actions:['csl.hello'],missing:[],note:'用你好表达问候。'},{source:'多谢你了',actions:['csl.thanks','csl.you'],missing:[],note:'用谢谢和你表达对对方的感谢。'}]});

test('匹配细节即使返回也不渲染，提交后自动播放',async({page})=>{
 await page.route('**/api/sign/resolve',r=>r.fulfill({json:suggestion()}));
 await page.goto('/');await page.getByLabel('输入要表达的中文').fill('哈喽，多谢你了');await page.getByRole('button',{name:'提交文字',exact:true}).click();
 await expect(page.locator('.expression-engine,[data-testid="expression-plan"]')).toHaveCount(0);
 await expect(page.getByTestId('avatar')).toHaveAttribute('data-playing','true',{timeout:30000});
 await page.screenshot({path:'.runtime-logs/ollama/llm-page-desktop.png',fullPage:true});
 await page.getByLabel('输入要表达的中文').fill('再见');await expect(page.getByTestId('home-motion-play')).toHaveCount(0);await expect(page.getByTestId('avatar')).toHaveAttribute('data-playing','false');
});
test('模型离线不假装规则成功，保留原话且能重试；窄屏不溢出',async({page})=>{
 let offline=true;await page.route('**/api/sign/resolve',r=>offline?r.fulfill({status:503,json:{error:'无法连接本机语言模型，请启动项目的Ollama服务后重试。'}}):r.fulfill({json:suggestion()}));
 await page.goto('/');await page.getByLabel('输入要表达的中文').fill('哈喽，多谢你了');await page.getByRole('button',{name:'提交文字',exact:true}).click();await expect(page.getByRole('status')).toContainText('无法连接本机语言模型');await expect(page.getByTestId('home-motion-play')).toHaveCount(0);await expect(page.getByLabel('输入要表达的中文')).toHaveValue('哈喽，多谢你了');
 offline=false;await page.getByRole('button',{name:'提交文字',exact:true}).click();await expect(page.getByTestId('avatar')).toHaveAttribute('data-playing','true',{timeout:30000});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/ollama/llm-page-mobile.png',fullPage:true});
});
test('模型迟到响应不能恢复已清空的原话或确认',async({page})=>{
 let release:()=>void;await page.route('**/api/sign/resolve',async r=>{await new Promise<void>(done=>{release=done});await r.fulfill({json:suggestion()}).catch(()=>{});});
 await page.goto('/');await page.getByLabel('输入要表达的中文').fill('哈喽，多谢你了');await page.getByRole('button',{name:'提交文字',exact:true}).click();await expect.poll(()=>!!release).toBe(true);
 await page.getByRole('button',{name:'清空本次交流',exact:true}).click();release!();await page.waitForTimeout(200);await expect(page.getByTestId('expression-plan')).toHaveCount(0);await expect(page.getByLabel('输入要表达的中文')).toHaveValue('');
});
