import {test,expect,type Page} from '@playwright/test';
import {testWav} from './helpers/localSpeech';

const result={
 kind:'recorded-sign-paragraph',status:'recognized',
 paragraph:{
  id:1,words:['我','发烧','我','需要','医生','帮助'],
  wordCount:6,text:'我发烧我需要医生帮助。',startMs:0,endMs:900,partial:false,endReason:'manual'
 }
};
const sentence='我发烧了，我需要医生帮助。';
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
async function record(page:Page){
 await button(page,'开启摄像头').click();
 const preview=page.getByLabel('摄像头预览');
 await expect(preview).toBeVisible();
 await preview.evaluate(el=>{
  (window as Window & {recordedTracks?:MediaStreamTrack[]}).recordedTracks=(el as HTMLVideoElement).srcObject instanceof MediaStream
   ? ((el as HTMLVideoElement).srcObject as MediaStream).getTracks() : [];
 });
 await button(page,'开始录制').click();
 await expect(page.getByRole('status').filter({hasText:'录制中 · 1 秒'})).toBeVisible();
 await button(page,'结束录制').click();
 await expect(page.getByLabel('回看本段录像')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as Window & {recordedTracks?:MediaStreamTrack[]}).recordedTracks?.map(t=>t.readyState))).toEqual(['ended']);
}

for (const {name, words, output} of [
 {name:'仅识别医生',words:['医生'],output:'医生，我发烧了，我需要帮助'},
 {name:'只识别到好',words:['好'],output:'谢谢'},
 {name:'无手部画面',words:[],output:'谢谢'}
]) {
 test(`医院互助录像演示自动输出：${name}`,async({page})=>{
  let requests=0;
  await page.route('**/api/sign/paragraph',route=>{
   requests++;
   return route.fulfill({json:{
    ...result,status:words.length?'recognized':'no_hands',
    paragraph:words.length?{...result.paragraph,words,wordCount:words.length,text:words.join('')+'。'}:null
   }});
  });
  await page.goto('/realtime.html?demo=hospital');
  await expect(page.getByRole('heading',{name:'医院互助录像演示'})).toBeVisible();
  await record(page);
  await expect(page.getByTestId('hospital-demo-output')).toHaveText(output);
  await expect(button(page,'确认识别')).toHaveCount(0);
  expect(requests).toBe(1);
 });
}

for(const entry of ['/realtime.html','/camera','/android.html?tab=live']){
 test(`${entry} 录制和回看期间不分析，确认后一次返回整段文字`,async({page})=>{
  let analysis=0,live=0;
  const spoken:string[]=[];
  await page.route('**/api/sign/realtime/**',r=>{live++;return r.abort();});
  await page.route('**/api/sign/paragraph',r=>{
   analysis++;
   expect(r.request().method()).toBe('POST');
   expect(r.request().headers()['content-type']).toMatch(/^video\/(webm|mp4)$/);
   expect(r.request().postDataBuffer()?.length??0).toBeGreaterThan(32);
   return r.fulfill({json:result});
  });
  await page.route('**/api/tts/status',r=>r.fulfill({json:{available:true}}));
  await page.route('**/api/tts/synthesize',r=>{
   const b=r.request().postDataJSON();spoken.push(b.text);
   return r.fulfill({json:{...b,mime:'audio/wav',audio:testWav(),voice:'模拟音色'}});
  });
  await page.goto(entry);
  await expect(button(page,'开启摄像头')).toBeVisible();
  await expect(page.getByLabel('摄像头预览')).toHaveCount(0);
  await record(page);
  expect(analysis).toBe(0);expect(live).toBe(0);
  await expect(page.getByTestId('paragraph-final')).toHaveCount(0);
  await button(page,'确认识别').click();
  await expect(page.getByTestId('paragraph-final')).toHaveText(sentence);
  expect(analysis).toBe(1);expect(live).toBe(0);expect(spoken).toEqual([]);
  await button(page,'朗读整段').click();
  await expect.poll(()=>spoken).toEqual([sentence]);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}

test('取消分析后旧结果不显示，下一次录像可重新确认',async({page})=>{
 let release:(()=>void)|undefined,requests=0;
 await page.route('**/api/sign/paragraph',async r=>{
  requests++;
  if(requests===1)await new Promise<void>(resolve=>{release=resolve;});
  await r.fulfill({json:result}).catch(()=>{});
 });
 await page.goto('/realtime.html');
 await record(page);
 await button(page,'确认识别').click();
 await expect.poll(()=>!!release).toBe(true);
 await button(page,'取消分析').click();
 release!();
 await expect(button(page,'开启摄像头')).toBeVisible();
 await expect(page.getByTestId('paragraph-final')).toHaveCount(0);
 await record(page);
 await button(page,'确认识别').click();
 await expect(page.getByTestId('paragraph-final')).toHaveText(sentence);
 expect(requests).toBe(2);
});

test('保留未确认录像供回看，未识别到手部时不输出句子',async({page})=>{
 await page.route('**/api/sign/paragraph',r=>r.fulfill({json:{...result,status:'no_hands',paragraph:null}}));
 await page.goto('/realtime.html');
 await record(page);
 await button(page,'确认识别').click();
 await expect(page.getByRole('alert')).toContainText('没有检测到清晰的手部画面');
 await expect(page.getByLabel('回看本段录像')).toBeVisible();
 await expect(page.getByTestId('paragraph-final')).toHaveCount(0);
});

test('浏览器实际录制的视频可由本机模型解码，空白画面不会出词',async({page})=>{
 await page.goto('/realtime.html');
 await record(page);
 const analyzed=page.waitForResponse(r=>r.url().endsWith('/api/sign/paragraph'));
 await button(page,'确认识别').click();
 const response=await analyzed;
 expect(response.status()).toBe(200);
 expect(await response.json()).toMatchObject({kind:'recorded-sign-paragraph',status:'no_hands',paragraph:null});
 await expect(page.getByRole('alert')).toContainText('没有检测到清晰的手部画面');
});

test('整段录像漏识“需要”时直接显示完整求助句',async({page})=>{
 const words=['我','帮助','医生','我','发烧'];
 await page.route('**/api/sign/paragraph',r=>r.fulfill({json:{
  ...result,paragraph:{...result.paragraph,words,wordCount:words.length,text:words.join('')+'。',partial:true}
 }}));
 await page.goto('/realtime.html');
 await record(page);
 await button(page,'确认识别').click();
 await expect(page.getByTestId('paragraph-final')).toHaveText(sentence);
 await expect(page.getByText('按上下文补出「需要」')).toBeVisible();
 await expect(page.getByText('结果待核对')).toHaveCount(0);
 await expect(page.getByText('查看原始识别')).toHaveCount(0);
 await expect(button(page,'确认识别')).toHaveCount(0);
});
