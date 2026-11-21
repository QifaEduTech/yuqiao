import {test,expect,type Page,type Browser} from '@playwright/test';
import {resolveExpression} from '../../shared/sign-expression.mjs';

async function submit(page:Page,text:string){await page.getByLabel('输入要表达的中文').fill(text);await page.getByRole('button',{name:'提交文字',exact:true}).click();}
async function openPair(page:Page,browser:Browser){
 const context=await browser.newContext({storageState:await page.context().storageState()});const display=await context.newPage();
 await page.goto('/');await display.goto('/avatar');
 for(const p of [page,display])await expect(p.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:60000});
 await expect(display.locator('.display-status')).toHaveCount(0);return {context,display};
}
async function motion(page:Page,text:string){await expect(page.getByTestId('avatar')).toHaveAttribute('data-motion-id',resolveExpression(text).preview!.id,{timeout:30000});await expect(page.getByTestId('avatar')).toHaveAttribute('data-playing','true');}
async function stopped(page:Page){await expect(page.getByTestId('avatar')).toHaveAttribute('data-motion-id','');await expect(page.getByTestId('avatar')).toHaveAttribute('data-playing','false');}

test('常见就医原话由实际接口完整拼接，两端同步；编辑、重新提交、切换及清空停止旧动作',async({page,browser})=>{
 test.setTimeout(120000);const {context,display}=await openPair(page,browser);
 try{
  await expect(page.getByTestId('hospital-scene-panel')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'播放整段',exact:true})).toHaveCount(0);
  await expect(page.getByTestId('avatar')).toHaveCount(1);
  const oldPage=await page.request.get('/hospital-scene.html',{maxRedirects:0});expect(oldPage.status()).toBe(302);expect(oldPage.headers().location).toBe('/');
  for(const text of ['我想挂号','请帮帮我','我没有过敏','挂号在哪里？','我想请医生帮忙','请志愿者帮我挂号','请问门诊在哪里？']){
   await submit(page,text);await motion(page,text);await motion(display,text);await expect(page.getByLabel('输入要表达的中文')).toHaveValue(text);await expect(page.locator('.home-motion-title strong')).toHaveText(text);
   if(text==='我想请医生帮忙')await page.screenshot({path:'.runtime-logs/free-expression-desktop.png',fullPage:true});
   await page.getByLabel('输入要表达的中文').fill(text+' ');await stopped(page);await stopped(display);
  }
  await submit(page,'我想挂号');await motion(display,'我想挂号');await page.getByRole('button',{name:'提交文字',exact:true}).click();await motion(display,'我想挂号');
  await page.getByRole('button',{name:'语音输入',exact:true}).click();await stopped(page);await stopped(display);
  await page.getByRole('button',{name:'文字输入',exact:true}).click();await submit(page,'请帮帮我');await motion(display,'请帮帮我');
  await page.getByRole('button',{name:'清空本次交流',exact:true}).click();await stopped(page);await stopped(display);await expect(page.getByLabel('输入要表达的中文')).toHaveValue('');
  await submit(page,'我想挂号');await motion(page,'我想挂号');await page.getByRole('button',{name:'暂停动作',exact:true}).click();await expect(display.getByTestId('avatar')).toHaveAttribute('data-playing','false');
  await page.screenshot({path:'.runtime-logs/direct-input-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'收起导航',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.runtime-logs/direct-input-mobile.png',fullPage:true});
 }finally{await context.close();}
});

test('缺词显示具体内容并停止两端，数量与时长提示可区分，手机不溢出',async({page,browser})=>{
 test.setTimeout(90000);const {context,display}=await openPair(page,browser);
 try{
  await submit(page,'我想挂号');await motion(display,'我想挂号');
  await page.route('**/api/sign/resolve',route=>{const text=route.request().postDataJSON().text;return text==='我需要轮椅'?route.fulfill({json:{status:'unsupported',preview:null,reason:'unknown_content',missing:['轮椅']}}):route.continue();});
  await submit(page,'我需要轮椅');await expect(page.getByTestId('input-feedback')).toContainText('还缺少「轮椅」');await expect(page.getByLabel('输入要表达的中文')).toHaveValue('我需要轮椅');await stopped(page);await stopped(display);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/text-sign-missing-mobile.png',fullPage:true});
  await submit(page,'你'.repeat(11));await expect(page.getByTestId('input-feedback')).toContainText('最多10个动作');
  await submit(page,'对不起'.repeat(8));await expect(page.getByTestId('input-feedback')).toContainText('超过30秒');await stopped(display);
 }finally{await context.close();}
});

test('显示指令响应延迟时清除仍立即送达，旧响应不能恢复动作',async({page,browser})=>{
 test.setTimeout(90000);const {context,display}=await openPair(page,browser);let release:undefined|(()=>void),held=false;
 await page.route('**/api/display/command',async route=>{
  const body=route.request().postDataJSON();
  if(body.preview&&!held){held=true;const response=await route.fetch();await new Promise<void>(done=>{release=done;});await route.fulfill({response}).catch(()=>{});}
  else await route.continue();
 });
 try{
  await submit(page,'我想挂号');await motion(display,'我想挂号');await expect.poll(()=>!!release).toBe(true);
  await page.getByLabel('输入要表达的中文').fill('请帮帮我');await stopped(page);await stopped(display);
  release!();await submit(page,'请帮帮我');await motion(page,'请帮帮我');await motion(display,'请帮帮我');
 }finally{release?.();await context.close();}
});

test('旧文字匹配迟到不覆盖新输入和新动作',async({page,browser})=>{
 test.setTimeout(90000);const {context,display}=await openPair(page,browser);let release:undefined|(()=>void);
 await page.route('**/api/sign/resolve',async route=>{
  if(route.request().postDataJSON().text==='旧请求'){await new Promise<void>(done=>{release=done;});await route.fulfill({json:resolveExpression('我想挂号')}).catch(()=>{});}else await route.continue();
 });
 try{
  await submit(page,'旧请求');await expect.poll(()=>!!release).toBe(true);await submit(page,'请帮帮我');await motion(display,'请帮帮我');release!();
  await expect(page.getByLabel('输入要表达的中文')).toHaveValue('请帮帮我');await motion(page,'请帮帮我');await motion(display,'请帮帮我');
 }finally{release?.();await context.close();}
});

test('语音核对后两端播放，编辑立即停止，重新确认与转文字只保留最新内容',async({page,browser})=>{
 test.setTimeout(90000);const {context,display}=await openPair(page,browser);
 await page.route('**/api/speech/transcriptions',route=>route.fulfill({json:{status:'transcribed',text:'我想挂号',requires_confirmation:true,processing_ms:1}}));
 try{
  await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.getByRole('button',{name:'开始录音',exact:true}).click();await expect(page.locator('.voice-input > strong')).toContainText(/正在录音 00:0[1-9]/);await page.getByRole('button',{name:'结束录音',exact:true}).click();
  await expect(page.getByLabel('语音识别文字')).toHaveValue('我想挂号');await stopped(display);await page.getByRole('button',{name:'确认这段文字',exact:true}).click();await motion(page,'我想挂号');await motion(display,'我想挂号');
  await page.getByLabel('语音识别文字').fill('请帮帮我');await stopped(page);await stopped(display);await page.getByRole('button',{name:'确认这段文字',exact:true}).click();await motion(page,'请帮帮我');await motion(display,'请帮帮我');
  await page.getByRole('button',{name:'转入文字输入',exact:true}).click();await stopped(page);await stopped(display);await expect(page.getByLabel('输入要表达的中文')).toHaveValue('请帮帮我');await expect(page.getByLabel('录音回听')).toHaveCount(0);
 }finally{await context.close();}
});
