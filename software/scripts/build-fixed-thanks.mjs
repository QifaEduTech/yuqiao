import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');process.env.TEMP=process.env.TMP=resolve(root,'.runtime-logs/tmp');
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:5173/anny-review.html');await page.waitForFunction(()=>!!window.__annyPreview);
  const asset=await page.evaluate(async()=>{const {authorThanks}=await import('/web/src/annyAuthoring.ts');return authorThanks(window.__annyPreview.rig);});
  const directory=resolve(root,'shared/sign-motions/anny');await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'csl.thanks.json'),JSON.stringify(asset)+'\n');
  console.log(JSON.stringify({id:asset.id,duration:asset.duration,frames:asset.frames.length,status:asset.status}));
}finally{await browser.close();}
