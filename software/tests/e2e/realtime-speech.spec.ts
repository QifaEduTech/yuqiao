import {test,expect,type Page} from '@playwright/test';
import {testWav as wav} from './helpers/localSpeech';

test.afterEach(async({page})=>{const stop=page.getByRole('button',{name:'停止实时识别',exact:true});if(await stop.count())await stop.click();});


const actions=[{text:'谢谢',signId:'csl.thanks'},{text:'帮助',signId:'csl.ref.bmcx.1900'},{text:'需要',signId:'csl.ref.bmcx.1874'},{text:'我',signId:'csl.me'}];
async function setup(page:Page,{mockVoice=true,available=true,blockPlayback=false,deferReady=false}={}){
  await page.addInitScript(({mockVoice,blockPlayback})=>{
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{if(c?.audio)throw Error('microphone forbidden');return original(c);};
    (window as any).__speechPlays=[];(window as any).__speechPauses=0;
    if(mockVoice){const play=HTMLMediaElement.prototype.play,pause=HTMLMediaElement.prototype.pause;
      HTMLMediaElement.prototype.play=function(){if(this.tagName==='AUDIO'){if(blockPlayback)return Promise.reject(new DOMException('blocked','NotAllowedError'));(window as any).__speechPlays.push(this.src);this.dispatchEvent(new Event('play'));return Promise.resolve();}return play.call(this);};
      HTMLMediaElement.prototype.pause=function(){if(this.tagName==='AUDIO')(window as any).__speechPauses++;return pause.call(this);};
    }
  },{mockVoice,blockPlayback});
  const requests:{text:string;revision:number}[]=[];let release:undefined|(()=>void),releaseStatus:undefined|(()=>void),delay=false;
  if(mockVoice){
    await page.route('**/api/tts/status',async r=>{if(deferReady)await new Promise<void>(resolve=>{releaseStatus=resolve;});await r.fulfill({json:{available,voice:'本机测试音色'}}).catch(()=>{});});
    await page.route('**/api/tts/synthesize',async r=>{const body=r.request().postDataJSON();expect(body.confirmed).toBe(true);requests.push(body);if(delay)await new Promise<void>(resolve=>{release=resolve;});await r.fulfill({json:{text:body.text,revision:body.revision,mime:'audio/wav',audio:wav(),voice:'本机测试音色'}}).catch(()=>{});});
  }
  let id=0,lastEnd=-1,candidate:string|null=null,repeat=false,lastEvent:any=null;const words:string[]=[];
  await page.route('**/api/sign/realtime/sessions',r=>{if(r.request().method()==='DELETE')return r.fulfill({json:{ok:true}});id=0;lastEnd=-1;return r.fulfill({json:{session:'speech-session',target:'auto',helpEngine:'video-tcn',supportedActions:actions,protocol:2,frameIntervalMs:30,maxImageEdge:640}});});
  await page.route('**/api/sign/realtime/frames',r=>{
    const seq=Number(r.request().headers()['x-yuqiao-frame-seq']),t=Math.round(Number(r.request().headers()['x-yuqiao-capture-ms'])),word=words.shift();
    const event=repeat?lastEvent:word?{id:++id,text:word,signId:actions.find(a=>a.text===word)!.signId,startMs:lastEnd+1,endMs:t}:null;
    if(word){lastEvent=event;lastEnd=t;}
    return r.fulfill({json:{seq,status:event?'waiting':candidate?'candidate':'observing',candidate:event?null:candidate,reason:candidate?'target':'no_hands',processingMs:3,samples:30,handSamples:30,event,eventState:event?'emitted':'collecting'}});
  });
  await page.goto('/realtime.html');await page.getByRole('button',{name:'开启摄像头并实时识别',exact:true}).click();await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-phase','running');
  if(mockVoice&&!deferReady)await expect(page.getByTestId('realtime-auto-audio')).toHaveAttribute('data-ready',available?'ready':'unavailable');
  return {requests,releaseStatus:()=>releaseStatus?.(),hasStatus:()=>!!releaseStatus,complete:(word:string)=>words.push(word),emit:async(word:string)=>{candidate=word;await expect(page.getByTestId('realtime-candidate')).toHaveText(word);await page.waitForTimeout(60);const before=id;candidate=null;words.push(word);await expect.poll(()=>id).toBe(before+1);await expect(page.getByTestId('realtime-words')).toContainText(word);},candidate:(v:string|null)=>{candidate=v;},delay:()=>{delay=true;},release:()=>release?.(),hasRelease:()=>!!release,repeat:()=>{repeat=true;}};
}

const audio=(page:Page)=>page.getByTestId('realtime-auto-audio');
const plays=(page:Page)=>page.evaluate(()=>(window as any).__speechPlays.length);
const endAudio=(page:Page)=>audio(page).evaluate(el=>el.dispatchEvent(new Event('ended')));

test('没有连句面板，候选立即播报且最终确认不复读',async({page})=>{
  const s=await setup(page);await expect(page.getByRole('heading',{name:'把动作连成话'})).toHaveCount(0);await expect(page.getByRole('group',{name:'播报方式'})).toHaveCount(0);await expect(page.locator('#realtime-sentence')).toHaveCount(0);await expect(page.getByRole('button',{name:/本句并播报|重播本段|快捷整句/})).toHaveCount(0);
  s.candidate('谢谢');await expect.poll(()=>plays(page)).toBe(1);await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');await s.emit('谢谢');await page.waitForTimeout(150);expect(s.requests.map(x=>x.text)).toEqual(['谢谢']);await expect(audio(page)).toBeHidden();
  await endAudio(page);s.candidate(null);await s.emit('帮助');await expect.poll(()=>plays(page)).toBe(2);expect(s.requests.map(x=>x.text)).toEqual(['谢谢','帮助']);await expect(page.getByTestId('realtime-words')).toHaveText('谢谢，帮助');
  await page.screenshot({path:'.runtime-logs/realtime-auto-only-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/realtime-auto-only-mobile.png',fullPage:true});
});

test('自动语音串行，重复动作分别播报，停止清队列与音频',async({page})=>{
  const s=await setup(page);await s.emit('谢谢');await expect.poll(()=>plays(page)).toBe(1);s.candidate(null);await page.waitForTimeout(750);await s.emit('谢谢');await s.emit('需要');expect(s.requests).toHaveLength(1);await endAudio(page);await expect.poll(()=>plays(page)).toBe(2);expect(s.requests.map(x=>x.text)).toEqual(['谢谢','谢谢']);
  await page.getByRole('button',{name:'停止实时识别',exact:true}).click();await endAudio(page);await page.waitForTimeout(150);expect(s.requests).toHaveLength(2);await expect(audio(page)).not.toHaveAttribute('src',/.+/);await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');
});

test('停止后迟到的语音不能播放，后台切换同样取消队列',async({page})=>{
  const s=await setup(page);s.delay();await s.emit('谢谢');await expect.poll(s.hasRelease).toBe(true);await s.emit('帮助');await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});s.release();await page.waitForTimeout(150);expect(await plays(page)).toBe(0);expect(s.requests).toHaveLength(1);await expect(audio(page)).not.toHaveAttribute('src',/.+/);
});

test('重复完成事件拒绝，不重复播报',async({page})=>{
  const s=await setup(page);await s.emit('谢谢');await expect.poll(()=>plays(page)).toBe(1);s.repeat();await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-phase','error');expect(s.requests).toHaveLength(1);await expect(audio(page)).not.toHaveAttribute('src',/.+/);
});

test('仅在浏览器拦截播放时显示应急播放器',async({page})=>{
  const s=await setup(page,{blockPlayback:true});await s.emit('谢谢');await expect(audio(page)).toBeVisible();await expect(page.getByRole('status').filter({hasText:'浏览器暂停'})).toBeVisible();await expect(page.getByRole('heading',{name:'把动作连成话'})).toHaveCount(0);
});

test('音色未就绪时等待，准备完成后只播一次；停止时不补播',async({page})=>{
  const s=await setup(page,{deferReady:true});await expect.poll(s.hasStatus).toBe(true);await s.emit('谢谢');expect(s.requests).toHaveLength(0);s.releaseStatus();await expect.poll(()=>plays(page)).toBe(1);expect(s.requests.map(x=>x.text)).toEqual(['谢谢']);
});

test('音色等待期间停止后，服务就绪也不能恢复旧播报',async({page})=>{
  const s=await setup(page,{deferReady:true});await expect.poll(s.hasStatus).toBe(true);await s.emit('谢谢');await page.getByRole('button',{name:'停止实时识别',exact:true}).click();s.releaseStatus();await page.waitForTimeout(150);expect(s.requests).toHaveLength(0);expect(await plays(page)).toBe(0);
});

test('音色不可用保留动作文字，不恢复手动面板',async({page})=>{
  const s=await setup(page,{available:false});await s.emit('谢谢');await expect(page.getByTestId('realtime-words')).toHaveText('谢谢');expect(s.requests).toHaveLength(0);await expect(page.getByRole('alert')).toContainText('不可用');await expect(page.locator('textarea')).toHaveCount(0);
});

test('错配音频拒绝播放',async({page})=>{
  const s=await setup(page);await page.route('**/api/tts/synthesize',r=>{const b=r.request().postDataJSON();return r.fulfill({json:{text:'错误文字',revision:b.revision,mime:'audio/wav',audio:wav(),voice:'测试'}});});await s.emit('谢谢');await expect(page.getByRole('alert')).toContainText('不匹配');expect(await plays(page)).toBe(0);
});

test('候选短暂消失或闪回不复读，出画后再次做同词可重新播报',async({page})=>{
  const s=await setup(page);s.candidate('谢谢');await expect.poll(()=>plays(page)).toBe(1);await endAudio(page);
  s.candidate(null);await page.waitForTimeout(150);s.candidate('谢谢');await page.waitForTimeout(150);expect(s.requests).toHaveLength(1);
  s.candidate('帮助');await expect.poll(()=>plays(page)).toBe(2);await endAudio(page);s.candidate('谢谢');await page.waitForTimeout(150);expect(s.requests).toHaveLength(2);
  s.candidate(null);await page.waitForTimeout(750);s.candidate('谢谢');await expect.poll(()=>plays(page)).toBe(3);expect(s.requests.map(x=>x.text)).toEqual(['谢谢','帮助','谢谢']);
});

test('先后候选已经播过，完成事件不重复；新一轮不同动作切换正常',async({page})=>{
  const s=await setup(page);await s.emit('谢谢');await expect.poll(()=>plays(page)).toBe(1);await endAudio(page);await s.emit('帮助');await expect.poll(()=>plays(page)).toBe(2);await endAudio(page);await s.emit('谢谢');await expect.poll(()=>plays(page)).toBe(3);
  expect(s.requests.map(x=>x.text)).toEqual(['谢谢','帮助','谢谢']);await expect(page.getByTestId('realtime-words')).toHaveText('谢谢，帮助，谢谢');
});

test('出画后迟到的旧确认不会让新一轮候选闪回复读',async({page})=>{
  const s=await setup(page);s.candidate('谢谢');await expect.poll(()=>plays(page)).toBe(1);await endAudio(page);s.candidate(null);await page.waitForTimeout(750);
  s.complete('谢谢');await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 1 次动作');expect(s.requests).toHaveLength(1);
  s.candidate('谢谢');await expect.poll(()=>plays(page)).toBe(2);await endAudio(page);s.candidate('帮助');await expect.poll(()=>plays(page)).toBe(3);await endAudio(page);s.candidate('谢谢');await page.waitForTimeout(150);expect(s.requests).toHaveLength(3);
});

test('真实默认语音在候选阶段播放，不等完成事件',async({page,request})=>{
  test.skip(process.env.YUQIAO_TEST_CLOUD_TTS!=='1','真实云语音需显式启用，普通回归不调用付费API');test.setTimeout(60000);const state=await(await request.get('/api/tts/status')).json();test.skip(!state.available,'千问音色不可用');const s=await setup(page,{mockVoice:false});await expect(audio(page)).toHaveAttribute('data-ready','ready');s.candidate('我');
  await expect.poll(()=>audio(page).evaluate(el=>{const a=el as HTMLAudioElement;return Number.isFinite(a.duration)&&a.duration>0&&(!a.paused||a.ended);}),{timeout:40000}).toBe(true);await expect(audio(page)).toBeHidden();await expect(page.getByTestId('realtime-event-count')).toHaveText('当前显示 0 次动作');await expect(page.getByRole('heading',{name:'把动作连成话'})).toHaveCount(0);
});


test('我候选出现即播报，持势和最终确认不重复',async({page})=>{
  const s=await setup(page);s.candidate('我');await expect.poll(()=>plays(page)).toBe(1);await endAudio(page);
  await page.waitForTimeout(200);expect(s.requests.map(x=>x.text)).toEqual(['我']);
  await s.emit('我');await expect(page.getByTestId('realtime-words')).toHaveText('我');
  await page.waitForTimeout(200);expect(s.requests.map(x=>x.text)).toEqual(['我']);
});
