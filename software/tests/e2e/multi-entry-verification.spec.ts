import {test,expect} from '@playwright/test';
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

test('摄像头拒绝权限时明确提示',async({page})=>{
  await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('denied','NotAllowedError'));});
  await page.goto('/camera');
  await page.getByRole('button',{name:'开启摄像头',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('设备访问未获允许');
  await expect(page.getByRole('button',{name:'开启摄像头',exact:true})).toBeVisible();
});
