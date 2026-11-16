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
test('同账号显示端投递、暂停重播、断开后未送达提示',async({page,context})=>{
  test.setTimeout(90000);
  await page.goto('/');
  const display=await context.newPage();
  await display.goto('/avatar');
  const avatar=display.getByTestId('avatar');
  await expect(avatar).toHaveAttribute('data-ready','true',{timeout:60000});
  await expect(display.locator('.display-status')).toHaveCount(0);
  await page.locator('textarea').fill('谢谢');
  await page.getByRole('button',{name:'提交文字',exact:true}).click();
  await expect(avatar).toHaveAttribute('data-motion-id','csl.thanks');
  await expect(avatar).toHaveAttribute('data-playing','true');
  await page.getByRole('button',{name:'暂停动作',exact:true}).click();
  await expect(avatar).toHaveAttribute('data-playing','false');
  await page.getByRole('button',{name:'重播动作',exact:true}).click();
  await expect(avatar).toHaveAttribute('data-playing','true');
  await display.close();
  await expect.poll(async()=>{
    const r=await context.request.post('/api/display/command',{headers:{Origin:'http://127.0.0.1:5183','X-Yuqiao-Request':'1'},data:{control:'pause'}});
    return (await r.json()).delivered;
  }).toBe(0);
  await page.locator('textarea').fill('帮助');
  await page.getByRole('button',{name:'提交文字',exact:true}).click();
  await expect(page.getByText(/数字人端未连接，动作只在本页播放/)).toBeVisible();
  const reconnected=await context.newPage();
  await reconnected.goto('/avatar');
  await expect(reconnected.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:60000});
  await expect(reconnected.getByTestId('avatar')).toHaveAttribute('data-motion-id','');
  await reconnected.close();
});

test('其他账号不会收到显示指令，未登录接口拒绝访问',async({page,browser})=>{
  test.setTimeout(90000);
  const other=await browser.newContext({storageState:{cookies:[],origins:[]}});
  try{
    const headers={Origin:'http://127.0.0.1:5183','X-Yuqiao-Request':'1'};
    expect((await other.request.get('http://127.0.0.1:5183/api/display/stream')).status()).toBe(401);
    expect((await other.request.post('http://127.0.0.1:5183/api/display/command',{headers,data:{preview:null}})).status()).toBe(401);
    const r=await other.request.post('http://127.0.0.1:5183/api/auth/register',{headers,data:{username:`display_${Date.now().toString(36)}`,password:'display-test-password-2026'}});
    expect(r.status()).toBe(201);
    const display=await other.newPage();await display.goto('http://127.0.0.1:5183/avatar');
    await expect(display.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:60000});
    await expect(display.locator('.display-status')).toHaveCount(0);
    await page.goto('/');await page.locator('textarea').fill('谢谢');
    await page.getByRole('button',{name:'提交文字',exact:true}).click();
    await expect(page.getByText(/数字人端未连接，动作只在本页播放/)).toBeVisible();
    await expect(display.getByTestId('avatar')).toHaveAttribute('data-motion-id','');
  }finally{await other.close();}
});

test('摄像头端自动取流、候选即播且持势不复读、停止释放设备',async({page})=>{
  const speech:string[]=[];let candidate:string|null=null,frames=0;
  await page.addInitScript(()=>{
    const original=HTMLMediaElement.prototype.play;
    (window as any).__cameraPlays=0;
    HTMLMediaElement.prototype.play=function(){if(this.tagName==='AUDIO'){(window as any).__cameraPlays++;this.dispatchEvent(new Event('play'));return Promise.resolve();}return original.call(this);};
  });
  await page.route('**/api/tts/status',r=>r.fulfill({json:{available:true,voice:'模拟音色'}}));
  await page.route('**/api/tts/synthesize',r=>{const b=r.request().postDataJSON();speech.push(b.text);return r.fulfill({json:{...b,mime:'audio/wav',audio:testWav(),voice:'模拟音色'}});});
  await page.route('**/api/sign/realtime/sessions',r=>r.fulfill({json:r.request().method()==='DELETE'?{ok:true}:{session:'camera-simulated',flow:'paragraph',protocol:2,target:'auto',helpEngine:'video-tcn',supportedActions:[{text:'谢谢',signId:'csl.thanks'},{text:'帮助',signId:'csl.ref.bmcx.1900'},{text:'需要',signId:'csl.ref.bmcx.1874'},{text:'我',signId:'csl.me'}]}}));
  await page.route('**/api/sign/realtime/frames',r=>{frames++;return r.fulfill({json:{seq:Number(r.request().headers()['x-yuqiao-frame-seq']),status:candidate?'candidate':'observing',candidate,reason:candidate?'target':'no_hands',event:null,eventState:candidate?'ready_to_finish':'collecting',samples:30,handSamples:30,processingMs:1,paragraph:{state:'empty',text:'',words:[],wordCount:0,final:null}}});});
  await page.goto('/camera');
  await expect(page.locator('.camera-entry-status')).toHaveAttribute('data-phase','running');
  await expect.poll(()=>frames).toBeGreaterThan(2);
  candidate='谢谢';await expect.poll(()=>speech.length).toBe(1);
  await expect.poll(()=>page.evaluate(()=>(window as any).__cameraPlays)).toBe(1);
  const before=frames;await expect.poll(()=>frames).toBeGreaterThan(before+5);expect(speech).toEqual(['谢谢']);
  await page.evaluate(()=>{(window as any).__cameraTracks=(document.querySelector('video')!.srcObject as MediaStream).getTracks();});
  await page.getByRole('button',{name:'停止摄像头'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__cameraTracks.every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
  expect(speech).toEqual(['谢谢']);
});

test('摄像头拒绝权限时明确提示',async({page})=>{
  await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('denied','NotAllowedError'));});
  await page.goto('/camera');
  await expect(page.getByText('摄像头权限未获允许，请在地址栏检查权限。')).toBeVisible();
  await expect(page.getByRole('button',{name:'重新开启摄像头'})).toBeVisible();
});
