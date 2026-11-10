import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'.runtime-logs/appearance');
process.env.TEMP=process.env.TMP=resolve(root,'.runtime-logs/tmp');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
const errors=[],report={date:'2026-10-15',motions:[],screenshots:[],errors};
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:5173/anny-review.html');await page.waitForFunction(()=>!!window.__annyFixedMotion&&!!window.__annyPreview?.appearance.wardrobe);
  const capture=async name=>{await page.locator('.anny-viewport').screenshot({path:resolve(directory,`${name}.png`)});report.screenshots.push(`${name}.png`);};
  const entries=await page.getByLabel('选择固定动作').locator('option').evaluateAll(options=>options.map(o=>o.value));
  for(const [outfit,label] of [['tee','男性穿搭'],['vintage','女性穿搭']]){
  await page.getByRole('button',{name:'人物外观',exact:true}).click();await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'关闭人物外观'}).click();
  for(const id of entries){
    await page.getByLabel('选择固定动作').selectOption(id);await page.waitForFunction(id=>window.__annyFixedMotion.asset.id===id,id);
    const duration=await page.evaluate(()=>window.__annyFixedMotion.asset.duration),times=[.25,.5,.75].map(f=>Number((f*duration).toFixed(2)));
    for(const t of times){await page.getByRole('slider',{name:'动作进度',exact:true}).fill(String(t));await page.waitForTimeout(80);await capture(`${outfit}-${id}-${t}`);}
    report.motions.push({outfit,id,duration,sampledTimes:times});
  }
  }
  await page.getByRole('button',{name:'复位',exact:true}).click();
  await page.getByRole('button',{name:'人物外观',exact:true}).click();
  for(const name of ['男性穿搭','海蓝','束发髻','深棕'])await page.getByRole('button',{name,exact:true}).click();
  await capture('panel');await page.getByRole('button',{name:'关闭人物外观'}).click();
  for(const [name,x,z] of [['side',3,0],['back',0,-3]]){
    await page.evaluate(({x,z})=>{const {camera,controls}=window.__annyPreview;camera.position.set(x,.95,z);controls.target.set(0,.86,0);controls.update();},{x,z});await page.waitForTimeout(100);await capture(name);
  }
  await page.getByRole('button',{name:'面部特写',exact:true}).click();await page.getByRole('button',{name:'眉眼与嘴部表情',exact:true}).click();await page.waitForTimeout(180);await capture('expression');
  await page.goto('http://127.0.0.1:5173/');await page.waitForSelector('[data-ready=true]');
  await page.getByLabel('输入要表达的中文').fill('你好我爱你');await page.getByRole('button',{name:'提交文字',exact:true}).click();await page.getByTestId('home-motion-play').waitFor();
  await page.screenshot({path:resolve(directory,'home.png'),fullPage:true});
  await page.getByRole('button',{name:'全屏查看',exact:true}).click();await page.getByRole('button',{name:'人物外观',exact:true}).click();
  const bounds=await page.getByRole('dialog',{name:'人物外观'}).boundingBox();
  report.fullscreen=await page.evaluate(()=>!!document.fullscreenElement);report.fullscreenPanelBounds=bounds;
  if(!report.fullscreen||!bounds||bounds.x<0||bounds.y<0)throw Error('Fullscreen appearance panel failed');
  await page.screenshot({path:resolve(directory,'fullscreen.png')});
  await page.getByRole('button',{name:'全屏查看',exact:true}).click();await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(directory,'mobile.png'),fullPage:true});
  if(errors.length)throw Error(errors.join('\n'));
  report.scope='Both imported outfits: all eight existing clips sampled at quarter/half/three-quarter duration; screenshots are visual review aids, not exhaustive collision or sign-language validation.';
  await writeFile(resolve(root,'docs/assets/anny-appearance-check.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({motions:report.motions.length,screenshots:report.screenshots.length,fullscreen:report.fullscreen,errors}));
}finally{await browser.close();}
