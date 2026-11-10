import {test,expect,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {testWav} from './helpers/localSpeech';

async function trackCamera(page:Page){
  await page.route('**/api/tts/status',r=>r.fulfill({json:{available:true,voice:'测试音色'}}));
  await page.route('**/api/tts/synthesize',r=>{const b=r.request().postDataJSON();return r.fulfill({json:{text:b.text,revision:b.revision,mime:'audio/wav',audio:testWav(),voice:'测试音色'}});});
  await page.addInitScript(()=>{
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);(window as any).__liveStreams=[];
    navigator.mediaDevices.getUserMedia=async c=>{if(c?.audio)throw Error('Realtime must not request audio');const s=await original(c);(window as any).__liveStreams.push(s);return s;};
    Object.defineProperty(window,'MediaRecorder',{value:function(){throw Error('Realtime must not record video');}});
  });
}
async function fakeSession(page:Page){
  const counts={starts:0,stops:0};
  await page.route('**/api/sign/realtime/sessions',r=>{if(r.request().method()==='DELETE'){counts.stops++;return r.fulfill({json:{ok:true}});}counts.starts++;expect(r.request().postDataJSON().target).toBe('auto');return r.fulfill({status:201,json:{session:'test-session',target:'auto',helpEngine:'video-tcn',supportedActions:[{text:'谢谢',signId:'csl.thanks'},{text:'帮助',signId:'csl.ref.bmcx.1900'},{text:'需要',signId:'csl.ref.bmcx.1874'},{text:'我',signId:'csl.me'}],protocol:2,frameIntervalMs:30,maxImageEdge:640}});});
  return counts;
}
const start=(page:Page)=>page.getByRole('button',{name:'开启摄像头并实时识别',exact:true}).click();

test('同一会话自动识别谢谢需要帮助交替与重复，无动作或模型选择框',async({page})=>{
  await trackCamera(page);const counts=await fakeSession(page);let word:string|null=null,emit=false,id=0,lastEnd=-1;
  await page.route('**/api/sign/realtime/frames',r=>{
    const seq=Number(r.request().headers()['x-yuqiao-frame-seq']),time=Math.round(Number(r.request().headers()['x-yuqiao-capture-ms']));
    const event=emit&&word?{id:++id,text:word,signId:word==='我'?'csl.me':word==='谢谢'?'csl.thanks':word==='需要'?'csl.ref.bmcx.1874':'csl.ref.bmcx.1900',startMs:lastEnd+1,endMs:time}:null;
    if(event){emit=false;word=null;lastEnd=time;}
    return r.fulfill({json:{seq,status:word?'candidate':'waiting',candidate:word,helpEngine:'video-tcn',reason:word?'target':'no_hands',processingMs:5,samples:30,handSamples:word?30:0,event,eventState:event?'emitted':'collecting'}});
  });
  await page.goto('/realtime.html');await expect(page.getByRole('combobox')).toHaveCount(0);await expect(page.getByLabel('当前自动识别范围')).toContainText('谢谢');await expect(page.getByLabel('当前自动识别范围')).toContainText('帮助');await start(page);
  const words:string[]=[];
  for(const next of ['谢谢','我','需要','帮助','我','谢谢','帮助','帮助']){word=next;await expect(page.getByTestId('realtime-candidate')).toHaveText(next);emit=true;words.push(next);await expect(page.getByTestId('realtime-words')).toHaveText(words.join('，'));}
  expect(counts.starts).toBe(1);await page.screenshot({path:'.runtime-logs/realtime-auto-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/realtime-auto-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'停止实时识别'}).click();await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');
});

test('短暂竞争继续观察，可恢复稳定候选而不要求重做',async({page})=>{
  await trackCamera(page);await fakeSession(page);let stable=false;
  await page.route('**/api/sign/realtime/frames',r=>r.fulfill({json:{seq:Number(r.request().headers()['x-yuqiao-frame-seq']),status:stable?'candidate':'observing',candidate:stable?'谢谢':null,reason:stable?'target':'candidate_transition',processingMs:5,samples:30,handSamples:30,event:null,eventState:stable?'ready_to_finish':'collecting'}}));
  await page.goto('/realtime.html');await start(page);await expect(page.getByTestId('realtime-status')).toContainText('继续完成当前动作');
  await expect(page.getByTestId('realtime-status')).not.toContainText('重试');stable=true;
  await expect(page.getByTestId('realtime-candidate')).toHaveText('谢谢');await expect(page.getByTestId('realtime-status')).toContainText('做动作的手');
  await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');
});

test('竞争证据只提示重做，不猜词或追加文字',async({page})=>{
  await trackCamera(page);await fakeSession(page);
  await page.route('**/api/sign/realtime/frames',r=>r.fulfill({json:{seq:Number(r.request().headers()['x-yuqiao-frame-seq']),status:'uncertain',candidate:null,helpEngine:'video-tcn',reason:'ambiguous_actions',processingMs:5,samples:30,handSamples:30,event:null,eventState:'reset_required'}}));
  await page.goto('/realtime.html');await start(page);await expect(page.getByTestId('realtime-status')).toContainText('竞争证据');await expect(page.getByTestId('realtime-candidate')).toHaveText('等待动作');await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');
});

test('顺序切换提示继续完成，按顺序记入谢谢和帮助',async({page})=>{
  await trackCamera(page);await fakeSession(page);let stage='switch',id=0,lastEnd=-1;
  await page.route('**/api/sign/realtime/frames',r=>{
    const seq=Number(r.request().headers()['x-yuqiao-frame-seq']),time=Math.round(Number(r.request().headers()['x-yuqiao-capture-ms']));
    const word=stage==='thanks'?'谢谢':stage==='help'?'帮助':null,event=word?{id:++id,text:word,signId:word==='谢谢'?'csl.thanks':'csl.ref.bmcx.1900',startMs:lastEnd+1,endMs:time}:null;
    if(event){lastEnd=time;stage='idle';}
    return r.fulfill({json:{seq,status:'observing',candidate:null,reason:stage==='switch'?'action_transition':'collecting',processingMs:5,samples:30,handSamples:30,event,eventState:event?'emitted':'collecting',...(event?{status:'waiting'}:{})}});
  });
  await page.goto('/realtime.html');await start(page);await expect(page.getByTestId('realtime-status')).toContainText('衔接');await expect(page.getByTestId('realtime-status')).not.toContainText('重试');
  stage='thanks';await expect(page.getByTestId('realtime-words')).toHaveText('谢谢');stage='help';await expect(page.getByTestId('realtime-words')).toHaveText('谢谢，帮助');await expect(page.locator('#realtime-sentence')).toHaveCount(0);
});

test('帮助模型高分但双手运动未通过时不出候选或文字',async({page})=>{
  await trackCamera(page);await fakeSession(page);
  await page.route('**/api/sign/realtime/frames',r=>r.fulfill({json:{seq:Number(r.request().headers()['x-yuqiao-frame-seq']),status:'observing',candidate:null,helpEngine:'video-tcn',modelVersion:'v1',helpScore:.91,motionSupported:false,motionGuard:'bilateral-motion-v1',reason:'motion_required',processingMs:5,samples:60,handSamples:60,event:null,eventState:'collecting'}}));
  await page.goto('/realtime.html');await start(page);
  await expect(page.getByTestId('help-model-score')).toContainText('0.910');await expect(page.getByTestId('help-model-score')).toContainText('未通过');
  await expect(page.getByTestId('realtime-picture-status')).toContainText('尚未确认有效动作');await expect(page.getByTestId('realtime-candidate')).toHaveText('等待动作');await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');
});

test('不用选择即可识别帮助，候选与事件分开显示，停止清空',async({page})=>{
  await trackCamera(page);await fakeSession(page);let mode='empty';
  await page.route('**/api/sign/realtime/frames',r=>{
    const seq=Number(r.request().headers()['x-yuqiao-frame-seq']),time=Math.round(Number(r.request().headers()['x-yuqiao-capture-ms']));const event=mode==='emit'?{id:1,text:'帮助',signId:'csl.ref.bmcx.1900',startMs:0,endMs:time}:null;if(event)mode='empty';
    return r.fulfill({json:{seq,helpEngine:'video-tcn',helpScore:mode==='candidate'?.84:null,status:mode==='candidate'?'candidate':'waiting',candidate:mode==='candidate'?'帮助':null,reason:'no_hands',processingMs:5,samples:0,handSamples:0,event,eventState:event?'emitted':'collecting'}});
  });
  await page.goto('/realtime.html');await expect(page.getByRole('heading',{name:'做什么，就识别什么'})).toBeVisible();await start(page);
  await expect(page.getByRole('combobox')).toHaveCount(0);await expect(page.getByTestId('realtime-candidate')).toHaveText('等待动作');await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');
  mode='candidate';await expect(page.getByTestId('realtime-candidate')).toHaveText('帮助');await expect(page.getByTestId('realtime-picture-status')).toContainText('候选：帮助');
  mode='emit';await expect(page.getByTestId('realtime-words')).toHaveText('帮助');await expect(page.getByTestId('realtime-picture-status')).toContainText('帮助');
  await page.screenshot({path:'.runtime-logs/help-realtime-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'停止实时识别'}).click();await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');await expect(page.getByTestId('realtime-candidate')).toHaveText('等待动作');
});

test('自动会话拒绝未支持词和旧单目标启动回应',async({page})=>{
  await trackCamera(page);await fakeSession(page);
  await page.route('**/api/sign/realtime/frames',r=>r.fulfill({json:{seq:Number(r.request().headers()['x-yuqiao-frame-seq']),status:'candidate',candidate:'你好',reason:'target',processingMs:5,samples:30,handSamples:30,event:null,eventState:'collecting'}}));
  await page.goto('/realtime.html');await start(page);await expect(page.getByRole('alert')).toContainText('不匹配');
  await page.unroute('**/api/sign/realtime/sessions');await page.route('**/api/sign/realtime/sessions',r=>r.fulfill({json:{session:'old',protocol:2,frameIntervalMs:30,maxImageEdge:640,helpEngine:'video-tcn',target:'thanks',targetText:'谢谢',targetSignId:'csl.thanks'}}));
  await start(page);await expect(page.getByRole('alert')).toContainText('版本不匹配');
});

test('缺少拇指弯动时画面与状态说明原因，不显示谢谢候选',async({page})=>{
  await trackCamera(page);await fakeSession(page);
  await page.route('**/api/sign/realtime/frames',r=>r.fulfill({json:{seq:Number(r.request().headers()['x-yuqiao-frame-seq']),status:'observing',candidate:null,reason:'motion_required',processingMs:5,samples:30,handSamples:30,event:null,eventState:'collecting',handTracking:{width:640,height:360,mirrored:true,hands:[{side:'Left',points:Array.from({length:21},()=>[.3,.5])}]}}}));
  await page.goto('/realtime.html');await start(page);
  await expect(page.getByTestId('realtime-status')).toContainText('完整动作');
  await expect(page.getByTestId('realtime-picture-status')).toContainText('尚未确认有效动作');
  await expect(page.getByTestId('realtime-candidate')).toHaveText('等待动作');
  await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');
  await expect(page.getByTestId('realtime-skeleton')).toBeVisible();
});

test('骨架按已镜像坐标叠加，开关不停止识别，无手/停止清除',async({page})=>{
  await trackCamera(page);await fakeSession(page);let visible=true,frames=0;
  await page.route('**/api/sign/realtime/frames',r=>{
    frames++;const seq=Number(r.request().headers()['x-yuqiao-frame-seq']);
    return r.fulfill({json:{seq,status:visible?'candidate':'waiting',candidate:visible?'谢谢':null,reason:visible?'target':'no_hands',processingMs:5,samples:30,handSamples:visible?30:0,event:null,eventState:'collecting',handTracking:{width:640,height:360,mirrored:true,hands:visible?['Left','Right'].map((side,h)=>({side,points:Array.from({length:21},(_,i)=>[.2+h*.4+i*.003,.35+i*.008])})):[]}}});
  });
  await page.goto('/realtime.html');await start(page);
  const overlay=page.getByTestId('realtime-skeleton');await expect(overlay).toBeVisible();await expect(overlay.locator('circle')).toHaveCount(42);
  await expect(overlay.locator('circle').first()).toHaveAttribute('cx','128');
  expect(await overlay.evaluate(el=>getComputedStyle(el).transform)).toBe('none');
  await expect(page.getByTestId('realtime-picture-status')).toContainText('候选：谢谢');
  await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');
  await page.screenshot({path:'.runtime-logs/realtime-skeleton-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await expect(overlay).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const fits=await overlay.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement!.getBoundingClientRect();return Math.abs(a.width-b.width)<2&&Math.abs(a.height-b.height)<2;});expect(fits).toBe(true);
  await page.screenshot({path:'.runtime-logs/realtime-skeleton-mobile.png',fullPage:true});
  await page.getByRole('checkbox',{name:'显示手部骨架'}).uncheck();await expect(overlay).toHaveCount(0);const before=frames;await expect.poll(()=>frames).toBeGreaterThan(before);
  await page.getByRole('checkbox',{name:'显示手部骨架'}).check();await expect(overlay).toBeVisible();visible=false;await expect(overlay).toHaveCount(0);
  await page.getByRole('button',{name:'停止实时识别'}).click();await expect(page.getByTestId('realtime-picture-status')).toHaveCount(0);
});

test('骨架过期消失，停止后的迟到骨架不恢复',async({page})=>{
  await trackCamera(page);await fakeSession(page);let release:undefined|(()=>void);
  await page.route('**/api/sign/realtime/frames',async r=>{
    const seq=Number(r.request().headers()['x-yuqiao-frame-seq']);if(seq>=2)await new Promise<void>(resolve=>{release=resolve;});
    await r.fulfill({json:{seq,status:'observing',candidate:null,reason:'collecting',processingMs:5,samples:1,handSamples:1,event:null,eventState:'collecting',handTracking:{width:640,height:360,mirrored:true,hands:[{side:'Left',points:Array.from({length:21},()=>[.2,.5])}]}}}).catch(()=>{});
  });
  await page.goto('/realtime.html');await start(page);await expect(page.getByTestId('realtime-skeleton')).toBeVisible();await expect.poll(()=>!!release).toBe(true);
  await expect(page.getByTestId('realtime-skeleton')).toHaveCount(0,{timeout:2000});
  await page.getByRole('button',{name:'停止实时识别'}).click();release!();await page.waitForTimeout(200);await expect(page.getByTestId('realtime-skeleton')).toHaveCount(0);
});

test('完成事件只追加一次，重复动作保留，停止清空且迟到事件无效',async({page})=>{
  await trackCamera(page);await fakeSession(page);let mode='candidate',id=0,previousEnd=-1,release:undefined|(()=>void);
  await page.route('**/api/sign/realtime/frames',async r=>{
    const seq=Number(r.request().headers()['x-yuqiao-frame-seq']),time=Math.round(Number(r.request().headers()['x-yuqiao-capture-ms']));
    const emit=mode==='emit'||mode==='late';const late=mode==='late';
    const event=emit?{id:++id,signId:'csl.thanks',text:'谢谢',startMs:previousEnd+1,endMs:time}:null;
    if(emit){previousEnd=time;mode='idle';}
    if(late)await new Promise<void>(resolve=>{release=resolve;});
    await r.fulfill({json:{seq,status:emit?'waiting':mode==='candidate'?'candidate':'waiting',candidate:!emit&&mode==='candidate'?'谢谢':null,reason:emit?'no_hands':'target',processingMs:5,samples:30,handSamples:30,event,eventState:emit?'emitted':'collecting'}}).catch(()=>{});
  });
  await page.goto('/realtime.html');await start(page);await expect(page.getByTestId('realtime-candidate')).toHaveText('谢谢');
  await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');
  mode='emit';await expect(page.getByTestId('realtime-words')).toHaveText('谢谢');await page.waitForTimeout(350);await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 1 次动作');
  mode='emit';await expect(page.getByTestId('realtime-words')).toHaveText('谢谢，谢谢');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.runtime-logs/realtime-events-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1040});await page.screenshot({path:'.runtime-logs/realtime-events-desktop.png',fullPage:true});
  mode='late';await expect.poll(()=>!!release).toBe(true);await page.getByRole('button',{name:'停止实时识别'}).click();release!();await page.waitForTimeout(250);
  await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');
});

test('拒绝重复事件编号，旧结果不能继续追加',async({page})=>{
  await trackCamera(page);await fakeSession(page);let event:any=null;
  await page.route('**/api/sign/realtime/frames',r=>{
    const seq=Number(r.request().headers()['x-yuqiao-frame-seq']),time=Math.round(Number(r.request().headers()['x-yuqiao-capture-ms']));
    if(seq>=3&&!event)event={id:1,signId:'csl.thanks',text:'谢谢',startMs:0,endMs:time};
    return r.fulfill({json:{seq,status:'waiting',candidate:null,reason:'no_hands',processingMs:5,samples:0,handSamples:0,event,eventState:event?'emitted':'waiting'}});
  });
  await page.goto('/realtime.html');await start(page);await expect(page.getByRole('alert')).toContainText('不匹配');
  await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');
});

test('实际持续取帧与本机推理，无手不出词、无需登录录制保存，停止释放摄像头与进程',async({page,request})=>{
  test.setTimeout(60000);const status=await(await request.get('/api/sign/realtime/status')).json();test.skip(!status.available,'本机模型未安装');await trackCamera(page);let forbidden=0;const errors:string[]=[];
  page.on('request',r=>{if(r.method()==='POST'&&(/\/api\/records|\/api\/tts|\/api\/sign\/experiments/.test(r.url())))forbidden++;});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/realtime.html');await expect(page.getByLabel('实时手语摄像头')).not.toBeVisible();await start(page);
  const state=page.getByTestId('realtime-status');await expect(state).toHaveAttribute('data-phase','running',{timeout:35000});await expect.poll(async()=>Number(await state.getAttribute('data-frames')),{timeout:15000}).toBeGreaterThanOrEqual(30);await expect(page.getByTestId('realtime-candidate')).toHaveText('等待动作');
  const measurement={source:'Playwright synthetic camera with no hands; not a real-user accuracy test',frames:Number(await state.getAttribute('data-frames')),fps:Number(await state.getAttribute('data-fps')),lastRoundTripMs:Number(await state.getAttribute('data-latency-ms')),forbiddenRequests:forbidden};
  expect(measurement.fps).toBeGreaterThan(0);expect(forbidden).toBe(0);await writeFile('.runtime-logs/realtime-browser-check.json',JSON.stringify(measurement,null,2));
  await page.screenshot({path:'.runtime-logs/realtime-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/realtime-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'停止实时识别'}).click();await expect(state).toHaveAttribute('data-phase','idle');expect(await page.evaluate(()=>(window as any).__liveStreams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);await expect.poll(async()=>(await(await request.get('/api/sign/realtime/status')).json()).busy).toBe(false);expect(errors).toEqual([]);
});

test('一帧一请求没有排队，临时候选不累计成句，停止后迟到帧不能恢复结果',async({page})=>{
  await trackCamera(page);const counts=await fakeSession(page);let requests=0,inFlight=0,maximum=0,release:undefined|(()=>void);
  await page.route('**/api/sign/realtime/frames',async r=>{
    requests++;maximum=Math.max(maximum,++inFlight);const seq=Number(r.request().headers()['x-yuqiao-frame-seq']);expect(r.request().headers()['content-type']).toBe('image/jpeg');expect(r.request().postDataBuffer()![0]).toBe(255);
    if(requests===3)await new Promise<void>(resolve=>{release=resolve;});else await new Promise(resolve=>setTimeout(resolve,180));
    inFlight--;await r.fulfill({json:{seq,status:'candidate',candidate:'谢谢',reason:'target',processingMs:20,samples:30,handSamples:30,frames:seq,event:null,eventState:'collecting'}}).catch(()=>{});
  });
  await page.goto('/realtime.html');await start(page);await expect(page.getByTestId('realtime-candidate')).toHaveText('谢谢');await expect.poll(()=>!!release).toBe(true);expect(maximum).toBe(1);expect(requests).toBe(3);
  await page.getByRole('button',{name:'停止实时识别'}).click();release!();await page.waitForTimeout(250);await expect(page.getByTestId('realtime-candidate')).toHaveText('等待动作');expect(requests).toBe(3);await expect.poll(()=>counts.stops).toBe(1);
});

test('切到后台或离开时停止会话，不接受范围外候选',async({page})=>{
  await trackCamera(page);const counts=await fakeSession(page);let wrong=false;
  await page.route('**/api/sign/realtime/frames',r=>r.fulfill({json:{seq:Number(r.request().headers()['x-yuqiao-frame-seq']),status:'candidate',candidate:wrong?'你好':'谢谢',reason:'target',processingMs:5,samples:30,handSamples:30,frames:1,event:null,eventState:'collecting'}}));
  await page.goto('/realtime.html');await start(page);await expect(page.getByTestId('realtime-candidate')).toHaveText('谢谢');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-phase','idle');await expect.poll(()=>counts.stops).toBe(1);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});});wrong=true;await start(page);await expect(page.getByRole('alert')).toContainText('不匹配');await expect(page.getByTestId('realtime-candidate')).toHaveText('等待动作');await expect.poll(()=>counts.stops).toBe(2);
});

test('取消设备授权等待后不恢复摄像头，不启动服务器会话',async({page})=>{
  await trackCamera(page);const counts=await fakeSession(page);await page.addInitScript(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const s=await original(c);(window as any).__lateCamera=s;await new Promise<void>(resolve=>{(window as any).__releaseCamera=resolve;});return s;};});
  await page.goto('/realtime.html');await start(page);await page.waitForFunction(()=>!!(window as any).__releaseCamera);await page.getByRole('button',{name:'停止实时识别'}).click();await page.evaluate(()=>(window as any).__releaseCamera());
  await expect.poll(()=>page.evaluate(()=>(window as any).__lateCamera.getTracks().every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);expect(counts.starts).toBe(0);await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-phase','idle');
});

test('设备拒绝与会话占用给出可重试错误，断连停止取流',async({page})=>{
  await trackCamera(page);await page.goto('/realtime.html');await page.evaluate(()=>{(window as any).__originalCamera=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});await start(page);await expect(page.getByRole('alert')).toContainText('权限');
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=(window as any).__originalCamera;});await page.route('**/api/sign/realtime/sessions',r=>r.fulfill({status:429,json:{error:'另一个窗口正在使用实时识别，请先停止。'}}));await start(page);await expect(page.getByRole('alert')).toContainText('另一个窗口');expect(await page.evaluate(()=>(window as any).__liveStreams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
  await page.unroute('**/api/sign/realtime/sessions');await fakeSession(page);await page.route('**/api/sign/realtime/frames',r=>r.abort());await start(page);await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-phase','error');expect(await page.evaluate(()=>(window as any).__liveStreams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
});


test('我显示模型与姿态检查的差异，不把高分诊断当候选且停止清空',async({page})=>{
  await trackCamera(page);await fakeSession(page);
  await page.route('**/api/sign/realtime/frames',r=>r.fulfill({json:{seq:Number(r.request().headers()['x-yuqiao-frame-seq']),status:'observing',candidate:null,reason:'motion_required',processingMs:8,samples:30,handSamples:30,event:null,eventState:'collecting',meCheck:{bodyVisible:true,chestReferenced:true,frameSupported:false,stableSupported:false,modelScore:.98,hands:[{indexAngle:83,indexAngle2d:95,indexExtended:false,otherFingersFolded:true,towardChest:false,nearBody:true,chestCosine:-.2,shoulderCosine:.7,tipDistance:.3}]}}}));
  await page.goto('/realtime.html');await start(page);
  const panel=page.getByTestId('me-check');await expect(panel).toContainText('食指姿态未符合');await expect(panel).toContainText('指向胸前未符合');await expect(panel).toContainText('模型已有支持');await expect(page.getByTestId('realtime-candidate')).toHaveText('等待动作');await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');
  await page.getByRole('button',{name:'停止实时识别'}).click();await expect(panel).not.toContainText('0.980');await expect(panel).toContainText('开启识别后');
});
