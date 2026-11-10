import {prepareMysqlFixture} from './mysql-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from '../../server/database.mjs';
import { createApp } from '../../server/app.mjs';
import {CaptchaStore} from '../../server/captcha.mjs';

const origin = 'http://127.0.0.1:5173';
async function fixture(t) {
  const parent = resolve('.runtime-logs/server-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'case-'));
  const cleanupMysql=await prepareMysqlFixture(root);
  const server = await createApp({ dataDir: root, publicDir: resolve('web/public'), origins: [origin],captchaService:new CaptchaStore({makeCode:()=> 'AB3DE'}) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolveClose => server.close(resolveClose));
    assert.ok(resolve(root).startsWith(parent + sep));
    await cleanupMysql();await rm(root, { recursive: true, force: true });
  });
  async function request(path, { cookie, json, raw, headers = {}, method = 'GET' } = {}) {
    if(path==='/api/auth/login'){
      const challenge=await request('/api/auth/captcha',{method:'POST',cookie});const value=await challenge.json();
      cookie=[cookie,challenge.headers.get('set-cookie').split(';')[0]].filter(Boolean).join('; ');json={...json,captchaId:value.id,captchaCode:'ab3de'};
    }
    return fetch(base + path, { method, headers: { Origin: origin, 'X-Yuqiao-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: json ? JSON.stringify(json) : raw });
  }
  async function register(name) {
    const response = await request('/api/auth/register', { method: 'POST', json: { username: name, password: 'test-passphrase-2026' } });
    assert.equal(response.status, 201);
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
    return setCookie.split(';')[0];
  }
  return { request, register, root };
}

test('注册、大小写重复保护、哈希存储、登录和注销', async t => {
  const { request, register, root } = await fixture(t);
  const cookie = await register('Alice');
  const me = await (await request('/api/auth/me', { cookie })).json();
  assert.equal(me.user.username, 'Alice');
  assert.equal((await request('/api/auth/register', { method: 'POST', json: { username: 'ALICE', password: 'other-password' } })).status, 409);
  assert.equal((await request('/api/auth/login', { method: 'POST', json: { username: 'Alice', password: 'wrong-password' } })).status, 401);
  const db = new DatabaseSync(join(root, 'app.sqlite'));
  const row = db.prepare('SELECT * FROM users').get();
  assert.notEqual(row.password_hash, 'test-passphrase-2026'); assert.equal(row.password_hash.length, 128); assert.equal(row.salt.length, 32);
  const session = db.prepare('SELECT token_hash FROM sessions').get();
  assert.notEqual(session.token_hash, cookie.split('=')[1]); db.close();
  await request('/api/auth/logout', { method: 'POST', cookie });
  assert.equal((await request('/api/records', { cookie })).status, 401);
  const login = await request('/api/auth/login', { method: 'POST', json: { username: 'alice', password: 'test-passphrase-2026' } });
  assert.equal(login.status, 200);
});

test('文字持久保存，另一账号不能读取或删除', async t => {
  const { request, register, root } = await fixture(t);
  const alice = await register('Alice'); const bob = await register('Bob');
  const saved = await request('/api/records/text', { method: 'POST', cookie: alice, json: { text: '请稍等一下。' } });
  assert.equal(saved.status, 201);
  const { record } = await saved.json();
  const list = await (await request('/api/records', { cookie: alice })).json();
  assert.equal(list.records[0].text, '请稍等一下。');
  assert.equal((await (await request('/api/records', { cookie: bob })).json()).records.length, 0);
  assert.equal((await request(`/api/records/${record.id}`, { method: 'DELETE', cookie: bob })).status, 404);
  const secondConnection = new DatabaseSync(join(root, 'app.sqlite'));
  assert.equal(secondConnection.prepare('SELECT text FROM records WHERE id=?').get(record.id).text, '请稍等一下。'); secondConnection.close();
  assert.equal((await request(`/api/records/${record.id}`, { method: 'DELETE', cookie: alice })).status, 200);
  assert.equal((await (await request('/api/records', { cookie: alice })).json()).records.length, 0);
});

test('录像访问鉴权、范围播放、删除文件及非法上传拒绝', async t => {
  const { request, register, root } = await fixture(t);
  const alice = await register('Alice'); const bob = await register('Bob');
  // Small binary fixture only tests transport validation; browser tests record actual video.
  const bytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100, 1)]);
  const upload = await request('/api/records/video?duration=1&text=test', { method: 'POST', cookie: alice, raw: bytes, headers: { 'Content-Type': 'video/webm' } });
  assert.equal(upload.status, 201);
  const { record } = await upload.json();
  const path = `/api/records/${record.id}/media`;
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, { cookie: bob })).status, 404);
  const range = await request(path, { cookie: alice, headers: { Range: 'bytes=0-3' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 0-3/104'); assert.equal((await range.arrayBuffer()).byteLength, 4);
  assert.equal((await request(path, { cookie: alice, headers: { Range: 'bytes=200-300' } })).status, 416);
  assert.equal((await request('/api/records/video?duration=1', { method: 'POST', cookie: alice, raw: Buffer.alloc(100), headers: { 'Content-Type': 'video/webm' } })).status, 415);
  assert.equal((await request('/api/records/video?duration=1', { method: 'POST', cookie: alice, raw: '<script></script>', headers: { 'Content-Type': 'text/html' } })).status, 415);
  const files = await readdir(join(root, 'media')); assert.equal(files.length, 1);
  assert.deepEqual(await readFile(join(root, 'media', files[0])), bytes);
  await request(`/api/records/${record.id}`, { method: 'DELETE', cookie: alice });
  assert.equal((await readdir(join(root, 'media'))).length, 0);
  assert.equal((await request(path,{cookie:alice})).status,404);
});

test('跨站写入和未经登录的保存被拒绝', async t => {
  const { request, register } = await fixture(t);
  const cookie = await register('Alice');
  assert.equal((await request('/api/records/text', { method: 'POST', json: { text: 'hello' } })).status, 401);
  assert.equal((await request('/api/records/text', { method: 'POST', cookie, json: { text: 'hello' }, headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await request('/api/records/text', { method: 'POST', cookie, json: { text: 'hello' }, headers: { 'X-Yuqiao-Request': '' } })).status, 403);
  assert.equal((await request('/api/records/text', { method: 'POST', cookie, json: { text: '' } })).status, 400);
});
