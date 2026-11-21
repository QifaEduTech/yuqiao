import {test,expect} from '@playwright/test';
import {testWav} from './helpers/localSpeech';

test('录像页进入独立实时模块，结束才显示和播报整段',async({page})=>{
 const vocabulary=[
  {text:'我',signId:'csl.me'},
  {text:'需要',signId:'csl.ref.bmcx.1874'},
  {text:'帮助',signId:'csl.ref.bmcx.1900'}
 ];
 const words=vocabulary.map(x=>x.text);
 let sessions=0,stops=0,frames=0,ended=false;
 const spoken:string[]=[];
 await page.route('**/api/sign/realtime/sessions',route=>{
  if(route.request().method()==='DELETE'){stops++;return route.fulfill({json:{ok:true}});}
  sessions++;
  expect(route.request().postDataJSON().flow).toBe('paragraph');
  return route.fulfill({json:{session:'live-test',protocol:2,flow:'paragraph',target:'auto',
   frameIntervalMs:30,maxImageEdge:640,helpEngine:'unified-tcn',supportedActions:vocabulary}});
 });
 await page.route('**/api/sign/realtime/frames',route=>{
  frames++;
  const headers=route.request().headers();
  const time=Math.round(Number(headers['x-yuqiao-capture-ms']));
  const finish=headers['x-yuqiao-finish-paragraph']==='1'&&!ended&&time>0;
  if(finish)ended=true;
  const paragraph=ended?{state:'empty',words:[],wordCount:0,text:'',final:finish?
   {id:1,words,wordCount:3,text:'我需要帮助。',startMs:0,endMs:time,partial:false,endReason:'manual'}:null}
   :{state:'collecting',words,wordCount:3,text:'我需要帮助。',final:null};
  return route.fulfill({json:{seq:Number(headers['x-yuqiao-frame-seq']),status:'observing',
   candidate:null,reason:'collecting',event:null,eventState:'collecting',samples:30,
   handSamples:30,processingMs:1,paragraph}});
 });
 await page.route('**/api/tts/status',r=>r.fulfill({json:{available:true}}));
 await page.route('**/api/tts/synthesize',r=>{
  const body=r.request().postDataJSON();spoken.push(body.text);
  return r.fulfill({json:{...body,mime:'audio/wav',audio:testWav(),voice:'模拟音色'}});
 });
 await page.goto('/realtime.html');
 await page.getByRole('link',{name:'改用实时识别'}).click();
 await expect(page).toHaveURL(/live-recognition\.html$/);
 expect(sessions).toBe(0);expect(frames).toBe(0);
 await page.getByRole('button',{name:'开始实时识别',exact:true}).click();
 await expect(page.getByRole('button',{name:'结束本段',exact:true})).toBeEnabled();
 expect(sessions).toBe(1);
 await expect(page.getByTestId('paragraph-final')).toHaveCount(0);
 expect(spoken).toEqual([]);
 await page.getByRole('button',{name:'结束本段',exact:true}).click();
 await expect(page.getByTestId('paragraph-final')).toHaveText('我需要帮助。');
 await expect.poll(()=>spoken).toEqual(['我需要帮助。']);
 await page.getByRole('button',{name:'停止实时识别',exact:true}).click();
 await expect.poll(()=>stops).toBe(1);
 await page.getByRole('link',{name:'改用录像识别'}).click();
 await expect(page.getByRole('button',{name:'开启摄像头',exact:true})).toBeVisible();
});

test('安卓识别内切换录像和实时，底部标签保持五个',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/android.html?tab=live');
 const nav=page.getByRole('navigation',{name:'移动端导航'});
 await page.getByRole('link',{name:'改用实时识别'}).click();
 await expect(page).toHaveURL(/android\.html\?tab=live-camera$/);
 await expect(nav.getByRole('button')).toHaveCount(5);
 await expect(nav.getByRole('button',{name:'识别',exact:true})).toHaveAttribute('aria-current','page');
 await expect(page.getByRole('button',{name:'开始实时识别',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('link',{name:'改用录像识别'}).click();
 await expect(page).toHaveURL(/android\.html\?tab=live$/);
 await expect(page.getByRole('button',{name:'开启摄像头',exact:true})).toBeVisible();
});
