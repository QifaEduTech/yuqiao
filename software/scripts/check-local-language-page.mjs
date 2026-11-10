import {chromium} from '@playwright/test';
import {resolve} from 'node:path';
process.env.TEMP=process.env.TMP=resolve('.runtime-logs/tmp');
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1040}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/?v=submit-autoplay');
 await page.getByLabel('输入要表达的中文').fill('哈喽，多谢你了');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/sign/resolve')&&r.request().method()==='POST',{timeout:100000});
 await page.getByRole('button',{name:'提交文字',exact:true}).click();
 const result=await(await response).json();if(result.preview?.steps.map(s=>s.id).join('|')!=='csl.hello|csl.thanks|csl.you'||result.expression!==undefined||result.engine!==undefined)throw Error(JSON.stringify(result));
 await page.waitForFunction(()=>document.querySelector('[data-testid="avatar"]')?.getAttribute('data-playing')==='true');
 if(await page.locator('.motion-match-card,.expression-engine,[data-testid="expression-plan"]').count())throw Error('Planning details visible on homepage');
 await page.getByRole('button',{name:'暂停动作',exact:true}).click();
 await page.screenshot({path:'.runtime-logs/ollama/live-model-page.png',fullPage:true});
 await page.getByRole('button',{name:'清空本次交流',exact:true}).click();
 if(await page.getByTestId('home-motion-play').count())throw Error('Clear did not cancel playback');
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({liveBackend:true,actions:result.preview.steps.map(s=>s.id),submitAutoplayPauseClear:'passed',planningDetailsHidden:true,pageErrors:errors}));
}finally{await browser.close();}
