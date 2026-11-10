import {test,expect} from '@playwright/test';
import {testWav} from './helpers/localSpeech';
test('本地候选立即播报，完成事件不复读；停止拒绝迟到结果',async({page})=>{
 const requests:string[]=[];
 await page.route('**/api/tts/status',r=>r.fulfill({json:{available:true,voice:'测试音色'}}));
 await page.route('**/api/tts/synthesize',r=>{const b=r.request().postDataJSON();requests.push(b.text);return r.fulfill({json:{...b,audio:testWav(),mime:'audio/wav',voice:'测试音色'}});});
 await page.addInitScript(()=>{
  (window as any).__localInput={candidate:null,complete:null};(window as any).__audioPlays=0;
  const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(this.tagName==='AUDIO'){(window as any).__audioPlays++;this.dispatchEvent(new Event('play'));return Promise.resolve();}return play.call(this);};
  (window as any).Worker=class {onmessage:any;onerror:any;terminated=false;id=0;start:number|null=null;constructor(){(window as any).__worker=this;}terminate(){this.terminated=true;}postMessage(d:any){if(d.type==='init'){setTimeout(()=>this.onmessage?.({data:{type:'ready',recognitionReady:true}}),1);return;}d.image.close();const input=(window as any).__localInput;if(this.start===null)this.start=d.timestamp;let event=null;if(input.complete){const word=input.complete;input.complete=null;input.candidate=null;event={id:++this.id,text:word,signId:word==='谢谢'?'csl.thanks':'csl.ref.bmcx.1900',startMs:Math.floor(this.start!),endMs:Math.round(d.timestamp)};this.start=d.timestamp+1;}const result={type:'frame',seq:d.seq,processingMs:1,handTracking:{width:640,height:480,mirrored:true,hands:[]},shoulders:[],recognition:{candidate:input.candidate,event,eventState:event?'emitted':'collecting',reason:input.candidate?'target':'no_hands'}};(window as any).__lastFrame=result;setTimeout(()=>{if(!this.terminated)this.onmessage?.({data:result});},2);}};
 });
 await page.goto('/android-offline.html?tab=live');await page.getByRole('button',{name:'开启本地手语试用'}).click();await expect(page.getByTestId('local-tracking')).toHaveAttribute('data-phase','running');
 await page.evaluate(()=>(window as any).__localInput.candidate='谢谢');await expect(page.getByTestId('local-candidate')).toHaveText('谢谢');await expect.poll(()=>requests.length).toBe(1);await page.waitForTimeout(220);expect(requests).toEqual(['谢谢']);
 await page.evaluate(()=>(window as any).__localInput.complete='谢谢');await expect(page.getByTestId('local-words')).toHaveText('谢谢');expect(requests).toHaveLength(1);
 await page.getByTestId('realtime-auto-audio').evaluate(el=>el.dispatchEvent(new Event('ended')));await page.evaluate(()=>(window as any).__localInput.candidate='帮助');await expect.poll(()=>requests.length).toBe(2);
 await page.getByRole('button',{name:'停止本地试用'}).click();await page.evaluate(()=>(window as any).__worker.onmessage({data:(window as any).__lastFrame}));await expect(page.getByTestId('local-candidate')).toHaveText('等待动作');await expect(page.getByTestId('realtime-auto-audio')).toHaveCount(0);expect(requests).toEqual(['谢谢','帮助']);
});
