import {chromium} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve('.runtime-logs/dictionary-full/verification');await mkdir(out,{recursive:true});process.env.TEMP=process.env.TMP=resolve('.runtime-logs/tmp');
const dictionary=JSON.parse(await readFile('shared/sign-dictionary.json','utf8'));
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const result={total:dictionary.entries.length,checks:[],errors:[]};function check(name,pass){result.checks.push({name,pass:!!pass});if(!pass)throw Error(name);}
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>result.errors.push(e.message));await page.goto('http://127.0.0.1:5173/sign-dictionary.html',{waitUntil:'networkidle',timeout:60000});
 check('Full source inventory loaded',await page.evaluate(()=>JSON.parse(document.querySelector('#dictionary-data').textContent).length)>5000);
 check('DOM bounded to one page',await page.locator('tbody tr').count()===40);
 await page.locator('#dictionary-next').click();check('Second page usable',(await page.locator('#dictionary-page').textContent()).includes('第 2 /'));
 await page.getByLabel('查找词语').fill('是');const shi=page.locator('tr[data-id="csl.yes"]');check('User-provided 是 preserved',(await shi.innerText()).includes('一手食、中指相搭，并点动一下。'));
 await shi.locator('[data-image]').click();await page.locator('#gesture-full').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#gesture-full').naturalWidth>0);check('Image zoom works after search',true);await page.keyboard.press('Escape');
 await page.getByLabel('查找词语').fill('');await page.getByLabel('词条类型').selectOption('recognized');check('Recognition remains four words',await page.locator('tbody tr').count()===4);await page.getByLabel('词条类型').selectOption('animated');check('Animations remain eight',await page.locator('tbody tr').count()===8);
 await page.getByLabel('词条类型').selectOption('all');await page.getByLabel('查找词语').fill('主席');check('Source missing picture explicit',(await page.locator('tbody').innerText()).includes('原站暂无手势图'));
 await page.getByLabel('查找词语').fill('');await page.screenshot({path:resolve(out,'desktop.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(out,'mobile.png')});check('Mobile does not overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 check('No runtime errors',result.errors.length===0);
}finally{await browser.close();await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
