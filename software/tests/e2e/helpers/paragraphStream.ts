import {expect,type Page} from '@playwright/test';
import {testWav} from './localSpeech';

const known=[{text:'谢谢',signId:'csl.thanks'},{text:'帮助',signId:'csl.ref.bmcx.1900'},{text:'需要',signId:'csl.ref.bmcx.1874'},{text:'我',signId:'csl.me'},{text:'挂号',signId:'synthetic.registration'},{text:'没有',signId:'synthetic.no'},...['你','医院','哪里','过敏'].map((text,i)=>({text,signId:'synthetic.extension'+i}))];
export async function setupParagraph(page:Page,{available=true,blockPlayback=false,delayVoice=false,deferReady=false,wrongAudio=false,failSynthesis=false,entry='realtime',automatic=false}={}){
  await page.addInitScript(({blockPlayback})=>{
    (window as any).__paragraphPlays=0;(window as any).__paragraphBlockPlayback=blockPlayback;
    const play=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){if(this.tagName==='AUDIO'){if((window as any).__paragraphBlockPlayback)return Promise.reject(new DOMException('blocked','NotAllowedError'));(window as any).__paragraphPlays++;this.dispatchEvent(new Event('play'));return Promise.resolve();}return play.call(this);};
  },{blockPlayback});
  const speech:string[]=[],events:string[]=[];let releaseVoice:undefined|(()=>void),releaseStatus:undefined|(()=>void),candidate:string|null=null,queue:string[]=[],words:string[]=[],id=0,floor=-1,paragraphId=0,paragraphStart=0,finalize=false,partial=false,tamper=false;
  let handsPresent=true,quietSince:number|null=null,manualFinishes=0;
  await page.route('**/api/tts/status',async r=>{if(deferReady)await new Promise<void>(resolve=>{releaseStatus=resolve;});await r.fulfill({json:{available,voice:'模拟段落音色'}}).catch(()=>{});});
  await page.route('**/api/tts/synthesize',async r=>{const b=r.request().postDataJSON();expect(b.confirmed).toBe(true);speech.push(b.text);if(failSynthesis){await r.fulfill({status:503,json:{error:'模拟语音不可用'}});return;}if(delayVoice)await new Promise<void>(resolve=>{releaseVoice=resolve;});await r.fulfill({json:{text:wrongAudio?b.text+'错配':b.text,revision:b.revision,mime:'audio/wav',audio:testWav(),voice:'模拟段落音色'}}).catch(()=>{});});
  await page.route('**/api/sign/realtime/status',r=>r.fulfill({json:{available:true,labels:known.map(x=>x.text)}}));
  await page.route('**/api/sign/realtime/sessions',r=>{if(r.request().method()==='DELETE')return r.fulfill({json:{ok:true}});expect(r.request().postDataJSON().flow).toBe('paragraph');return r.fulfill({json:{session:'paragraph-test',flow:'paragraph',target:'auto',helpEngine:'unified-tcn',supportedActions:known,protocol:2,frameIntervalMs:30,maxImageEdge:640}});});
  await page.route('**/api/sign/realtime/frames',r=>{
    const h=r.request().headers(),t=Math.round(Number(h['x-yuqiao-capture-ms']));let event=null;
    if(queue.length){if(!words.length)paragraphStart=floor+1;const word=queue.shift()!;event={id:++id,text:word,signId:known.find(x=>x.text===word)!.signId,startMs:floor+1,endMs:t};floor=t;words.push(word);events.push(word);}
    const paragraph:any={state:words.length?'collecting':'empty',text:words.length?words.join('')+'。':'',words:[...words],wordCount:words.length,final:null};
    if(h['x-yuqiao-finish-paragraph']==='1')manualFinishes++;
    if(automatic){if(handsPresent||candidate)quietSince=null;else if(quietSince===null)quietSince=t;paragraph.autoEnd=words.length&&quietSince!==null?{remainingMs:Math.max(0,2000-(t-quietSince))}:null;}
    const autoFinished=automatic&&quietSince!==null&&t-quietSince>=2000;
    if((finalize||autoFinished||h['x-yuqiao-finish-paragraph']==='1')&&words.length){paragraph.final={id:++paragraphId,text:words.join('')+'。',words:[...words],wordCount:words.length,startMs:paragraphStart,endMs:floor,partial,endReason:autoFinished?'quiet':'manual'};words=[];paragraph.state='empty';paragraph.text='';paragraph.words=[];paragraph.wordCount=0;paragraph.autoEnd=null;finalize=false;quietSince=null;}
    if(tamper)paragraph.text='没有视觉依据的新内容。';
    return r.fulfill({json:{seq:Number(h['x-yuqiao-frame-seq']),status:event?'waiting':candidate?'candidate':'observing',candidate:event?null:candidate,reason:candidate?'target':automatic&&handsPresent?'motion_required':'no_hands',event,eventState:event?'emitted':candidate?'ready_to_finish':'collecting',samples:30,handSamples:30,processingMs:1,paragraph}});
  });
  await page.goto(entry==='camera'?'/camera':'/realtime.html');
  if(entry==='camera')await expect(page.locator('.camera-entry-status')).toHaveAttribute('data-phase','running');
  else{await page.getByRole('button',{name:'开启摄像头并实时识别',exact:true}).click();await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-phase','running');}
  return {speech,events,hands:(present:boolean)=>{handsPresent=present;},manualFinishes:()=>manualFinishes,emit:async(word:string)=>{const before=events.length;queue.push(word);await expect.poll(()=>events.length).toBe(before+1);},candidate:(word:string|null)=>{candidate=word;},finish:()=>{finalize=true;},partial:()=>{partial=true;},tamper:()=>{tamper=true;},release:()=>releaseVoice?.(),releaseStatus:()=>releaseStatus?.(),hasStatus:()=>!!releaseStatus};
}
