import {test,expect} from '@playwright/test';
import {createServer,type Server} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
let server:Server,origin:string;
test.beforeAll(async()=>{
 const root=resolve('web/android-app');
 server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+decodeURIComponent(new URL(req.url!,'http://local').pathname));if(!path.startsWith(root+sep))throw Error('outside package');const bytes=await readFile(path);const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm'};res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'});res.end(bytes);}catch{res.writeHead(404);res.end();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+(server.address() as any).port;
});
test.afterAll(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
test('独立安装包资源可加载数字人及连续示范，不请求电脑API或外网',async({page})=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});const forbidden:string[]=[];const failures:string[]=[];
 await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http')&&(!u.startsWith(origin+'/')||new URL(u).pathname.startsWith('/api/'))){forbidden.push(u);return r.abort();}return r.continue();});page.on('response',r=>{if(r.status()>=400)failures.push(r.url());});
 await page.goto(origin+'/app/android-offline.html');await expect(page.getByText('动作示范可离线',{exact:true})).toBeVisible();await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:30000});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'我需要帮助',exact:true}).click();await expect(page.getByTestId('avatar')).toHaveAttribute('data-motion-id',/csl.sequence_/,{timeout:20000});await expect(page.getByLabel('本次原话')).toContainText('我需要帮助');
 await expect.poll(()=>page.getByTestId('avatar').evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThan(230);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'.runtime-logs/android-offline-home.png',fullPage:true});
 await page.getByLabel('输入文字，播放已有动作').fill('不要跳过这句未知内容');await page.getByRole('button',{name:'播放手语',exact:true}).click();await expect(page.getByRole('alert')).toContainText('不能完整表达');await expect(page.getByTestId('avatar')).toHaveAttribute('data-motion-id','');
 const nav=page.getByRole('navigation',{name:'移动端导航'});await nav.getByRole('button',{name:'学习',exact:true}).click();await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','true');await page.getByLabel('查找动作').fill('需要');await page.getByRole('button',{name:'需要',exact:true}).click();await expect(page.getByTestId('avatar')).toHaveAttribute('data-motion-id','csl.ref.bmcx.1874');
 await nav.getByRole('button',{name:'识别',exact:true}).click();await expect(page.getByText('摄像头尚未开启')).toBeVisible();await expect(page.locator('canvas')).toHaveCount(0);await page.screenshot({path:'.runtime-logs/android-offline-recognition.png',fullPage:true});
 expect(forbidden).toEqual([]);expect(failures).toEqual([]);
});
test('独立模型包校验不连接后端',async({page})=>{await page.goto(origin+'/model-check.html');await page.getByRole('button',{name:'检查模型文件与计算结果'}).click();await expect(page.locator('#result')).toHaveAttribute('data-result','passed',{timeout:20000});const r=await page.evaluate(()=>(window as any).__modelCheck);expect(r.syntheticCases).toBe(14);expect(r.maxAbsoluteError).toBeLessThan(2e-5);expect(r.cameraRecognitionReady).toBe(false);await writeFile('.runtime-logs/android-offline-model-result.json',JSON.stringify(r,null,2));});

test('真实本地骨骼模型在设备内处理测试画面，停止与后台释放摄像头',async({page})=>{
 test.setTimeout(90000);const external:string[]=[],uploads:string[]=[],errors:string[]=[],httpFailures:string[]=[];page.on('response',r=>{if(r.status()>=400)httpFailures.push(r.url());});
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,250));});page.on('request',r=>{if(r.method()!=='GET')uploads.push(r.url());if(r.url().startsWith('http')&&!r.url().startsWith(origin+'/'))external.push(r.url());});
 await page.addInitScript(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);(window as any).__cameraStreams=[];navigator.mediaDevices.getUserMedia=async constraints=>{if(constraints?.audio)throw Error('Audio must be disabled');const stream=await original(constraints);(window as any).__cameraStreams.push(stream);return stream;};});
 await page.setViewportSize({width:390,height:844});await page.goto(origin+'/app/android-offline.html');await page.getByRole('navigation',{name:'移动端导航'}).getByRole('button',{name:'识别',exact:true}).click();
 await page.getByRole('button',{name:'开启本地手语试用'}).click();const state=page.getByTestId('local-tracking');await expect(state).toHaveAttribute('data-phase','running',{timeout:50000});await expect.poll(()=>state.getAttribute('data-frames'),{timeout:20000}).not.toBe('0');
 await page.screenshot({path:'.runtime-logs/android-local-tracking.png',fullPage:true});await page.getByRole('button',{name:'停止本地试用'}).click();await expect(state).toHaveAttribute('data-phase','idle');expect(await page.evaluate(()=>(window as any).__cameraStreams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);await expect(page.getByTestId('realtime-skeleton')).toHaveCount(0);
 await page.getByRole('button',{name:'开启本地手语试用'}).click();await expect(state).toHaveAttribute('data-phase','running',{timeout:50000});await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await expect(state).toHaveAttribute('data-phase','idle');expect(await page.evaluate(()=>(window as any).__cameraStreams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
 expect(external).toEqual([]);expect(uploads).toEqual([]);await expect(page.getByTestId('local-candidate')).toHaveText('等待动作');await writeFile('.runtime-logs/android-local-tracking-result.json',JSON.stringify({realRuntime:true,syntheticCamera:true,uploads:uploads.length,externalRequests:external.length,stopAndBackgroundRelease:true,errors,httpFailures},null,2));
});
test('本地摄像头授权迟到时，切换页面后仍立即释放设备',async({page})=>{
 await page.addInitScript(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const s=await original(c);(window as any).__pendingCamera=s;return await new Promise<MediaStream>(resolve=>{(window as any).__releaseCamera=()=>resolve(s);});};});
 await page.goto(origin+'/app/android-offline.html');const nav=page.getByRole('navigation',{name:'移动端导航'});await nav.getByRole('button',{name:'识别',exact:true}).click();await page.getByRole('button',{name:'开启本地手语试用'}).click();await expect.poll(()=>page.evaluate(()=>!!(window as any).__releaseCamera)).toBe(true);await nav.getByRole('button',{name:'交流',exact:true}).click();await page.evaluate(()=>(window as any).__releaseCamera());await expect.poll(()=>page.evaluate(()=>(window as any).__pendingCamera.getTracks().every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
});
test('骨架覆盖层显示手部与肩部，停止后拒绝迟到结果',async({page})=>{
 await page.addInitScript(()=>{
  const Original=window.Worker;
  (window as any).Worker=class {
   onmessage:any;onerror:any;terminated=false;
   constructor(url:string|URL,options?:WorkerOptions){if(!String(url).includes('/local-vision/worker.js'))return new Original(url,options) as any;(window as any).__trackingWorker=this;}
   postMessage(data:any){if(data.type==='init'){setTimeout(()=>this.onmessage?.({data:{type:'ready'}}),1);return;}if(data.type==='frame'){data.image.close();const result={type:'frame',seq:data.seq,processingMs:2,recognition:{candidate:'谢谢',event:null,eventState:'collecting',reason:'target'},handTracking:{width:640,height:480,mirrored:true,hands:[{side:'Left',points:Array.from({length:21},(_,i)=>[.25+i*.008,.4+i*.004])}]},shoulders:[[.35,.45],[.65,.45]]};(window as any).__lastTracking=result;setTimeout(()=>{if(!this.terminated)this.onmessage?.({data:result});},5);}}
   terminate(){this.terminated=true;}
  };
 });
 await page.goto(origin+'/app/android-offline.html');await page.getByRole('navigation',{name:'移动端导航'}).getByRole('button',{name:'识别',exact:true}).click();await page.getByRole('button',{name:'开启本地手语试用'}).click();await expect(page.getByTestId('realtime-skeleton')).toHaveAttribute('data-hands','1');await expect(page.getByLabel('肩部位置参考')).toBeVisible();await expect(page.getByTestId('local-candidate')).toHaveText('谢谢');await expect(page.getByTestId('realtime-skeleton').locator('circle')).toHaveCount(21);
 await page.getByRole('button',{name:'停止本地试用'}).click();await page.evaluate(()=>(window as any).__trackingWorker.onmessage({data:(window as any).__lastTracking}));await expect(page.getByTestId('local-tracking')).toHaveAttribute('data-phase','idle');await expect(page.getByTestId('realtime-skeleton')).toHaveCount(0);await expect(page.getByLabel('肩部位置参考')).toHaveCount(0);await expect(page.getByTestId('local-candidate')).toHaveText('等待动作');
});
