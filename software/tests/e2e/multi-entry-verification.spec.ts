import {test,expect} from '@playwright/test';
import {testWav} from './helpers/localSpeech';
import {resolveInputPreview} from '../../shared/sign-preview.mjs';

// Use the catalog's real preview assets; isolate text planning latency from
// display transport. SSE, authentication and command APIs remain real.
test.beforeEach(async({page})=>{
  await page.route('**/api/sign/resolve',r=>r.fulfill({json:resolveInputPreview(r.request().postDataJSON().text)}));
});

// Isolated test account/database. Camera frames and speech below are simulated;
// these checks do not measure recognition accuracy or physical speaker output.
test('取消配对后同账号直接联动，多个显示端同步、重复去重及重连不补播',async({page,browser})=>{
 test.setTimeout(90000);await page.goto('/');await expect(page.getByRole('button',{name:/显示端配对/})).toHaveCount(0);
 const auth=await page.context().storageState(),first=await browser.newContext({storageState:auth}),second=await browser.newContext({storageState:auth});
 try{
  const display=await first.newPage(),other=await second.newPage();
  await display.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const r=await original(input,init);if(!String(input).includes('/api/display/stream')||!r.ok||!r.body)return r;let buffer='';const decoder=new TextDecoder(),encoder=new TextEncoder();const dup=new TransformStream({transform(chunk,c){buffer+=decoder.decode(chunk,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);c.enqueue(encoder.encode(block+'\n\n'+(block.startsWith('event: command')?block+'\n\n':'')));}}});return new Response(r.body.pipeThrough(dup),{status:r.status,headers:r.headers});};});
  await display.goto('http://127.0.0.1:5183/avatar');await other.goto('http://127.0.0.1:5183/avatar');await expect(display.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:60000});await expect(other.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:60000});await expect(display.locator('.display-status')).toHaveCount(0);await expect(other.locator('.display-status')).toHaveCount(0);
  await expect(display.getByTestId('display-pair-code')).toHaveCount(0);await expect(display.locator('.display-pair-card')).toHaveCount(0);await display.keyboard.press('Escape');await expect(display.getByRole('button')).toHaveCount(0);
  const sent=page.waitForRequest(r=>r.url().endsWith('/api/display/command')&&r.method()==='POST');await page.locator('textarea').fill('谢谢');await page.getByRole('button',{name:'提交文字',exact:true}).click();const command=await sent;
  for(const target of [display,other]){await expect(target.getByTestId('avatar')).toHaveAttribute('data-motion-id','csl.thanks');await expect(target.locator('.display-page')).toHaveAttribute('data-command-count','1');}
  const duplicate=await page.request.post('/api/display/command',{headers:command.headers(),data:command.postDataJSON()});expect((await duplicate.json()).duplicate).toBe(true);await expect(display.locator('.display-page')).toHaveAttribute('data-command-count','1');
  await page.getByRole('button',{name:'暂停动作',exact:true}).click();await expect(display.getByTestId('avatar')).toHaveAttribute('data-playing','false');await expect(other.getByTestId('avatar')).toHaveAttribute('data-playing','false');await page.getByRole('button',{name:'重播动作',exact:true}).click();await expect(other.getByTestId('avatar')).toHaveAttribute('data-playing','true');
  await page.screenshot({path:'.runtime-logs/display-direct-normal.png',fullPage:true});await display.screenshot({path:'.runtime-logs/display-direct-avatar.png',fullPage:true});
  await display.close();await other.close();await page.locator('textarea').fill('帮助');await page.getByRole('button',{name:'提交文字',exact:true}).click();await expect(page.getByText(/数字人端未连接，动作只在本页播放/)).toBeVisible();
  const reconnected=await first.newPage();await reconnected.goto('http://127.0.0.1:5183/avatar');await expect(reconnected.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:60000});await expect(reconnected.getByTestId('avatar')).toHaveAttribute('data-motion-id','');
  await page.locator('textarea').fill('谢谢');await page.getByRole('button',{name:'提交文字',exact:true}).click();await expect(reconnected.getByTestId('avatar')).toHaveAttribute('data-motion-id','csl.thanks');
 }finally{await first.close();await second.close();}
});

test('无需配对仍隔离不同账号，旧配对接口不存在',async({page,browser})=>{
 const other=await browser.newContext({storageState:{cookies:[],origins:[]}});
 try{
  const base='http://127.0.0.1:5183',headers={Origin:base,'X-Yuqiao-Request':'1'};
  expect((await other.request.get(base+'/api/display/stream')).status()).toBe(401);
  expect((await other.request.post(base+'/api/auth/register',{headers,data:{username:'direct_'+Date.now().toString(36),password:'display-test-password-2026'}})).status()).toBe(201);
  const display=await other.newPage();await display.goto(base+'/avatar');await expect(display.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:60000});await expect(display.getByTestId('display-pair-code')).toHaveCount(0);
  await page.goto('/');expect((await page.request.post('/api/display/pair',{headers,data:{code:'123456'}})).status()).toBe(404);await page.locator('textarea').fill('谢谢');await page.getByRole('button',{name:'提交文字',exact:true}).click();await expect(page.getByText(/数字人端未连接，动作只在本页播放/)).toBeVisible();await expect(display.getByTestId('avatar')).toHaveAttribute('data-motion-id','');
 }finally{await other.close();}
});

test('摄像头端自动取流，候选不播报，确认成段后整理并播报，停止释放设备',async({page})=>{
  const speech:string[]=[];let candidate:string|null=null,frames=0,finish=false;
  await page.addInitScript(()=>{
    const original=HTMLMediaElement.prototype.play;
    (window as any).__cameraPlays=0;
    HTMLMediaElement.prototype.play=function(){if(this.tagName==='AUDIO'){(window as any).__cameraPlays++;this.dispatchEvent(new Event('play'));return Promise.resolve();}return original.call(this);};
  });
  await page.route('**/api/tts/status',r=>r.fulfill({json:{available:true,voice:'模拟音色'}}));
  await page.route('**/api/tts/synthesize',r=>{const b=r.request().postDataJSON();speech.push(b.text);return r.fulfill({json:{...b,mime:'audio/wav',audio:testWav(),voice:'模拟音色'}});});
  await page.route('**/api/sign/realtime/sessions',r=>r.fulfill({json:r.request().method()==='DELETE'?{ok:true}:{session:'camera-simulated',flow:'paragraph',protocol:2,target:'auto',helpEngine:'unified-tcn',supportedActions:[{text:'谢谢',signId:'csl.thanks'},{text:'帮助',signId:'csl.ref.bmcx.1900'},{text:'需要',signId:'csl.ref.bmcx.1874'},{text:'我',signId:'csl.me'}]}}));
  await page.route('**/api/sign/realtime/frames',r=>{frames++;const final=finish?{id:1,text:'谢谢。',words:['谢谢'],wordCount:1,startMs:1,endMs:Math.round(Number(r.request().headers()['x-yuqiao-capture-ms'])),partial:false}:null;finish=false;return r.fulfill({json:{seq:Number(r.request().headers()['x-yuqiao-frame-seq']),status:candidate?'candidate':'observing',candidate,reason:candidate?'target':'no_hands',event:null,eventState:candidate?'ready_to_finish':'collecting',samples:30,handSamples:30,processingMs:1,paragraph:{state:'empty',text:'',words:[],wordCount:0,final}}});});
  await page.goto('/camera');
  await expect(page.locator('.camera-entry-status')).toHaveAttribute('data-phase','running');
  await expect.poll(()=>frames).toBeGreaterThan(2);
  candidate='谢谢';const before=frames;await expect.poll(()=>frames).toBeGreaterThan(before+5);expect(speech).toEqual([]);candidate=null;finish=true;await expect.poll(()=>speech.length).toBe(1);
  await expect.poll(()=>page.evaluate(()=>(window as any).__cameraPlays)).toBe(1);
  await expect(page.getByTestId('paragraph-final')).toHaveText('谢谢。');expect(speech).toEqual(['谢谢。']);
  await page.evaluate(()=>{(window as any).__cameraTracks=(document.querySelector('video')!.srcObject as MediaStream).getTracks();});
  await page.getByRole('button',{name:'停止摄像头'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__cameraTracks.every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
  expect(speech).toEqual(['谢谢。']);
});

test('摄像头拒绝权限时明确提示',async({page})=>{
  await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('denied','NotAllowedError'));});
  await page.goto('/camera');
  await expect(page.getByText('摄像头权限未获允许，请在地址栏检查权限。')).toBeVisible();
  await expect(page.getByRole('button',{name:'重新开启摄像头'})).toBeVisible();
});
