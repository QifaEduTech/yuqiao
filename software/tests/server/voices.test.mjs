import {prepareMysqlFixture} from './mysql-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from '../../server/database.mjs';
import { createApp } from '../../server/app.mjs';

const origin = 'http://127.0.0.1:5173';

/** Build a real 16 kHz mono PCM WAV of the requested length; the API validates the header. */
function pcmWav(seconds) {
  const samples = Math.round(seconds * 16000);
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0, 'ascii'); data.writeUInt32LE(36 + samples * 2, 4);
  data.write('WAVE', 8, 'ascii'); data.write('fmt ', 12, 'ascii');
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36, 'ascii'); data.writeUInt32LE(samples * 2, 40);
  return data;
}

/** Stand-in for GPT-SoVITS so these tests never load the model or touch the GPU. */
const stubVoiceService = {
  calls: [],
  installed() { return true; },
  status() { return { available: true, ready: true, busy: false, engine: 'stub', mode: 'zero-shot', trained: false, device: 'cuda', note: 'stub' }; },
  async synthesize({ text, refAudioPath, promptText }) {
    this.calls.push({ text, refAudioPath, promptText });
    return { audio: pcmWav(1).toString('base64'), mime: 'audio/wav', sample_rate: 32000, duration: 1, processing_ms: 1 };
  },
  close() {},
};

async function fixture(t) {
  const parent = resolve('.runtime-logs/server-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'voice-'));
  stubVoiceService.calls = [];
  const cleanupMysql=await prepareMysqlFixture(root);
  const server = await createApp({ dataDir: root, publicDir: resolve('web/public'), origins: [origin], voiceService: stubVoiceService });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(close => server.close(close));
    assert.ok(resolve(root).startsWith(parent + sep));
    await cleanupMysql();await rm(root, { recursive: true, force: true });
  });
  async function request(path, { cookie, json, raw, headers = {}, method = 'GET' } = {}) {
    return fetch(base + path, { method, headers: { Origin: origin, 'X-Yuqiao-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: json ? JSON.stringify(json) : raw });
  }
  async function register(name) {
    const response = await request('/api/auth/register', { method: 'POST', json: { username: name, password: 'test-passphrase-2026' } });
    assert.equal(response.status, 201);
    return response.headers.get('set-cookie').split(';')[0];
  }
  const addVoice = (cookie, name, seconds = 5) => request(`/api/voices?name=${encodeURIComponent(name)}&text=${encodeURIComponent('今天的天气很不错。')}`, {
    method: 'POST', cookie, headers: { 'Content-Type': 'audio/wav' }, raw: pcmWav(seconds),
  });
  const patch = (cookie, id, body) => request(`/api/voices/${id}`, { method: 'PATCH', cookie, json: body });
  const synth = (cookie, body) => request('/api/tts/synthesize', { method: 'POST', cookie, json: { confirmed: true, revision: 0, voice: 'personal', ...body } });
  return { request, register, addVoice, patch, synth, root };
}

test('新录音为待确认，未确认不能用于合成', async t => {
  const { register, addVoice, synth, request } = await fixture(t);
  const cookie = await register('voicepending');
  const created = await addVoice(cookie, '第一段');
  assert.equal(created.status, 201);
  const voice = (await created.json()).voice;
  assert.equal(voice.status, 'pending');
  assert.equal(voice.name, '第一段');

  const denied = await synth(cookie, { text: '这一段不该被合成。', voice_id: voice.id, voice_revision: 1 });
  assert.equal(denied.status, 409);
  assert.match((await denied.json()).error, /还没有确认/);
  assert.equal(stubVoiceService.calls.length, 0, '未确认不能触达合成引擎');

  const list = await (await request('/api/voices', { cookie })).json();
  assert.equal(list.active_id, null, '未确认不作为启用音色');
});

test('确认后即成为启用音色；第二个确认时不自动抢占', async t => {
  const { register, addVoice, patch, request } = await fixture(t);
  const cookie = await register('voiceorder');
  const first = (await (await addVoice(cookie, '甲')).json()).voice;
  const second = (await (await addVoice(cookie, '乙')).json()).voice;

  const confirmedFirst = await patch(cookie, first.id, { status: 'confirmed' });
  assert.equal((await confirmedFirst.json()).active_id, first.id, '第一个确认的音色应自动启用');

  const confirmedSecond = await patch(cookie, second.id, { status: 'confirmed' });
  assert.equal((await confirmedSecond.json()).active_id, first.id, '之后确认的音色不应抢占');

  const list = await (await request('/api/voices', { cookie })).json();
  assert.equal(list.active_id, first.id);
  assert.equal(list.voices.length, 2);
});

test('任何已确认的自有音色都能试听，不必是当前启用的那个', async t => {
  const { register, addVoice, patch, synth } = await fixture(t);
  const cookie = await register('voicepreview');
  const first = (await (await addVoice(cookie, '甲')).json()).voice;
  const second = (await (await addVoice(cookie, '乙')).json()).voice;
  await patch(cookie, first.id, { status: 'confirmed' });
  await patch(cookie, second.id, { status: 'confirmed' });

  // Regression: the settings page must be able to preview a voice before deciding to activate it.
  const preview = await synth(cookie, { text: '试听第二个音色。', voice_id: second.id, voice_revision: 1 });
  assert.equal(preview.status, 200, await preview.clone().text());
  const body = await preview.json();
  assert.equal(body.voice_id, second.id);
  assert.equal(body.voice_name, '乙');
  assert.equal(body.mime, 'audio/wav');
});

test('音色属于账号：别人的音色不能试听也不能启用', async t => {
  const { register, addVoice, patch, synth, request } = await fixture(t);
  const owner = await register('voiceowner');
  const intruder = await register('voiceintruder');
  const mine = (await (await addVoice(owner, '我的')).json()).voice;
  await patch(owner, mine.id, { status: 'confirmed' });

  const stolen = await synth(intruder, { text: '偷用别人的音色。', voice_id: mine.id, voice_revision: 1 });
  assert.equal(stolen.status, 409);
  assert.match((await stolen.json()).error, /找不到这个音色/);
  assert.equal((await request(`/api/voices/${mine.id}/activate`, { method: 'POST', cookie: intruder })).status, 404);

  const stolenPatch = await patch(intruder, mine.id, { name: '改成我的' });
  assert.equal(stolenPatch.status, 404);
  assert.equal((await (await request('/api/voices', { cookie: intruder })).json()).voices.length, 0);
});

test('改名与备注可保存，未确认的不能设为当前使用', async t => {
  const { register, addVoice, patch, request } = await fixture(t);
  const cookie = await register('voicemeta');
  const voice = (await (await addVoice(cookie, '原名')).json()).voice;

  const activate = await request(`/api/voices/${voice.id}/activate`, { method: 'POST', cookie });
  assert.equal(activate.status, 409);
  assert.match((await activate.json()).error, /还没有确认/);

  const edited = await patch(cookie, voice.id, { name: '新名字', note: '会议室录的，有回音' });
  const body = await edited.json();
  assert.equal(body.voice.name, '新名字');
  assert.equal(body.voice.note, '会议室录的，有回音');
  assert.equal(body.voice.status, 'pending', '改名不应顺带确认');
});

test('删除启用中的音色会清空启用状态，且不静默提升其他音色', async t => {
  const { register, addVoice, patch, request } = await fixture(t);
  const cookie = await register('voicedelete');
  const first = (await (await addVoice(cookie, '甲')).json()).voice;
  const second = (await (await addVoice(cookie, '乙')).json()).voice;
  await patch(cookie, first.id, { status: 'confirmed' });
  await patch(cookie, second.id, { status: 'confirmed' });
  assert.equal((await (await request('/api/voices', { cookie })).json()).active_id, first.id);

  const removed = await request(`/api/voices/${first.id}`, { method: 'DELETE', cookie });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).active_id, null, '删除启用音色后应清空，不自动换成乙');

  const list = await (await request('/api/voices', { cookie })).json();
  assert.equal(list.voices.length, 1);
  assert.equal(list.active_id, null);
});

test('参考录音时长与格式不合规会被拒绝', async t => {
  const { register, addVoice, request } = await fixture(t);
  const cookie = await register('voicelength');

  const tooShort = await addVoice(cookie, '太短', 1.5);
  assert.equal(tooShort.status, 422);
  assert.match((await tooShort.json()).error, /3–10 秒/);

  const tooLong = await addVoice(cookie, '太长', 12);
  assert.equal(tooLong.status, 422);

  const wrongType = await request('/api/voices?name=x&text=%E4%BD%A0%E5%A5%BD', { method: 'POST', cookie, headers: { 'Content-Type': 'audio/mpeg' }, raw: pcmWav(5) });
  assert.equal(wrongType.status, 415);

  const missingText = await request('/api/voices?name=x', { method: 'POST', cookie, headers: { 'Content-Type': 'audio/wav' }, raw: pcmWav(5) });
  assert.equal(missingText.status, 400);
  assert.match((await missingText.json()).error, /参考录音对应的中文文字/);
});

test('音色只属于创建它的账号，落库隔离', async t => {
  const { register, addVoice, patch, root } = await fixture(t);
  const cookie = await register('voiceisolation');
  const voice = (await (await addVoice(cookie, '私有')).json()).voice;
  await patch(cookie, voice.id, { status: 'confirmed' });
  const db = new DatabaseSync(join(root, 'app.sqlite'));
  const rows = db.prepare('SELECT user_id, sample_file, status FROM voices').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sample_file, `${voice.id}.wav`);
  assert.equal(rows[0].status, 'confirmed');
  db.close();
});
