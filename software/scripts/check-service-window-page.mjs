import {chromium} from '@playwright/test';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
process.env.TEMP=process.env.TMP=resolve('.runtime-logs/tmp');
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1040}}),results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/?v=service-window');
 for(const [text,ids] of [['你好，我需要帮助',['csl.hello','csl.me','csl.ref.bmcx.1874','csl.ref.bmcx.1900']],['好，请等候',['csl.good','csl.ref.bmcx.1932','csl.ref.bmcx.1938']],['谢谢，再见',['csl.thanks','csl.goodbye']]]){
  await page.getByLabel('输入要表达的中文').fill(text);const response=page.waitForResponse(r=>r.url().endsWith('/api/sign/resolve')&&r.request().method()==='POST',{timeout:100000});
  await page.getByRole('button',{name:'提交文字',exact:true}).click();const r=await(await response).json();if(JSON.stringify(r.preview?.steps.map(s=>s.id))!==JSON.stringify(ids))throw Error(JSON.stringify(r));
  await page.waitForFunction(()=>document.querySelector('[data-testid="avatar"]')?.getAttribute('data-playing')==='true');
  await page.getByRole('combobox',{name:'首页动作速度'}).selectOption('1.5');
  await page.waitForFunction(()=>document.querySelector('[data-testid="home-motion-current"]')?.textContent==='本段播放结束',null,{timeout:20000});
  if(await page.locator('.motion-match-card').count())throw Error('Planning details should stay hidden');
  results.push({text,ids,autoplayCompleted:true});
 }
 await page.getByRole('button',{name:'重播动作',exact:true}).click();await page.waitForTimeout(3500);await page.getByRole('button',{name:'暂停动作',exact:true}).click();await page.screenshot({path:'.runtime-logs/window-motions/live-home-scene.png',fullPage:true});
 if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify({liveModel:true,results,pageErrors:errors}));
 await writeFile('.runtime-logs/window-motions/live-page.json',JSON.stringify({checkedAt:new Date().toISOString(),results,pageErrors:errors},null,2));
}finally{await browser.close();}
