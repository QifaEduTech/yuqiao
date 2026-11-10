import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {once} from 'node:events';
import {CaptchaStore,generateCaptchaCode,renderCaptcha} from '../../server/captcha.mjs';
import {createApp} from '../../server/app.mjs';
test('随机5位始终混合数字和英文；返回PNG而非明文答案',()=>{
 for(let i=0;i<300;i++){const code=generateCaptchaCode();assert.match(code,/^[A-Z0-9]{5}$/);assert.match(code,/[A-Z]/);assert.match(code,/[0-9]/);}
 const store=new CaptchaStore({makeCode:()=> 'AB3DE'}),value=store.issue('client');
 assert.deepEqual(Object.keys(value).sort(),['expiresAt','id','image']);assert.ok(!JSON.stringify(value).includes('AB3DE'));
 const png=Buffer.from(value.image.split(',')[1],'base64');assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),180);assert.equal(png.readUInt32BE(20),60);
 assert.ok(!png.includes(Buffer.from('AB3DE')));assert.equal(store.entries.get(value.id).digest.length,32);
});
test('忽略大小写，每次只用一次，错答也失效，绑定浏览器',()=>{
 const s=new CaptchaStore({makeCode:()=> 'AB3DE'});let c=s.issue('x');
 assert.equal(s.consume(c.id,'aB3dE',c.id),true);assert.equal(s.consume(c.id,'AB3DE',c.id),false);
 c=s.issue('x');assert.equal(s.consume(c.id,'ZZ999',c.id),false);assert.equal(s.consume(c.id,'AB3DE',c.id),false);
 c=s.issue('x');assert.equal(s.consume(c.id,'AB3DE','another-browser'),false);assert.equal(s.consume(c.id,'ab3de',c.id),true);
});
test('刷新淘汰旧验证码、到期拒绝、限流与容量有界',()=>{
 let now=100;const s=new CaptchaStore({now:()=>now,makeCode:()=> 'AB3DE',ttlMs:100,maxEntries:1,rateLimit:3});
 const old=s.issue('x'),fresh=s.issue('x',old.id);assert.equal(s.consume(old.id,'AB3DE',old.id),false);
 assert.throws(()=>s.issue('other'),e=>e.status===429);now=201;assert.equal(s.consume(fresh.id,'AB3DE',fresh.id),false);
 const third=s.issue('x');assert.throws(()=>s.issue('x',third.id),e=>e.status===429);now=61000;assert.ok(s.issue('x'));assert.equal(s.entries.size,1);s.close();assert.equal(s.entries.size,0);
});
test('真实登录API不能跳过验证码，错答无会话，正确验证码仍需正确密码',async t=>{
 const parent=resolve('.runtime-logs/captcha-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'case-'));
 const origin='http://127.0.0.1:5173',server=await createApp({dataDir:root,publicDir:resolve('web/public'),origins:[origin],captchaService:new CaptchaStore({makeCode:()=> 'AB3DE'})});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(root.startsWith(parent+sep));await rm(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 const post=(path,body,cookie='',source=origin)=>fetch(base+path,{method:'POST',headers:{Origin:source,'X-Yuqiao-Request':'1','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
 const user={username:'captcha_user',password:'test-password-2026'};assert.equal((await post('/api/auth/register',user)).status,201);
 assert.equal((await post('/api/auth/login',user)).status,400);
 assert.equal((await post('/api/auth/captcha',{},'','https://other.invalid')).status,403);
 async function challenge(){const r=await post('/api/auth/captcha',{});assert.match(r.headers.get('cache-control'),/no-store/);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);return {body:await r.json(),cookie:r.headers.get('set-cookie').split(';')[0]};}
 let c=await challenge();let r=await post('/api/auth/login',{...user,captchaId:c.body.id,captchaCode:'ZZ999'},c.cookie);assert.equal(r.status,400);assert.equal(r.headers.get('set-cookie'),null);
 r=await post('/api/auth/login',{...user,captchaId:c.body.id,captchaCode:'AB3DE'},c.cookie);assert.equal(r.status,400);
 c=await challenge();r=await post('/api/auth/login',{...user,password:'wrong-password-2026',captchaId:c.body.id,captchaCode:'ab3de'},c.cookie);assert.equal(r.status,401);
 c=await challenge();r=await post('/api/auth/login',{...user,captchaId:c.body.id,captchaCode:'aB3dE'},c.cookie);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/yuqiao_session=/);
 r=await post('/api/auth/login',{...user,captchaId:c.body.id,captchaCode:'ab3de'},c.cookie);assert.equal(r.status,400);
});
