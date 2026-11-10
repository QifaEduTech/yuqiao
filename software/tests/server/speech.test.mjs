import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validatePcmWav, SpeechService } from '../../server/speech.mjs';

function silentWav(seconds = 1) {
  const bytes = seconds * 32000;
  const wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(bytes, 40);
  return wav;
}

test('WAV 校验拒绝伪装格式、截断、过长和立体声音频', () => {
  assert.equal(validatePcmWav(silentWav()), 1);
  assert.throws(() => validatePcmWav(Buffer.alloc(100)), /格式无效/);
  assert.throws(() => validatePcmWav(silentWav().subarray(0, 100)), /格式无效/);
  assert.throws(() => validatePcmWav(silentWav(31)), /0.2–30/);
  const stereo = silentWav(); stereo.writeUInt16LE(2, 22);
  assert.throws(() => validatePcmWav(stereo), /单声道/);
});

test('真实本地中文样例、静音与并发保护', async t => {
  const service = new SpeechService(resolve('.'));
  if (!service.installed()) { t.skip('本地语音模型尚未安装'); return; }
  t.after(() => service.close());
  const wav = await readFile('models/sensevoice-small-int8/test_wavs/zh.wav');
  const running = service.transcribe(wav);
  await assert.rejects(service.transcribe(wav), error => error.status === 429);
  const result = await running;
  assert.equal(result.status, 'transcribed'); assert.match(result.text, /[\u4e00-\u9fff]/); assert.equal(result.requires_confirmation, true);
  const empty = await service.transcribe(silentWav());
  assert.equal(empty.status, 'no_speech'); assert.equal(empty.text, '');
});

test('识别取消后可重新启动，不会把旧结果交给新请求', async t => {
  const service = new SpeechService(resolve('.'));
  if (!service.installed()) { t.skip('本地语音模型尚未安装'); return; }
  t.after(() => service.close());
  const controller = new AbortController();
  const first = service.transcribe(silentWav(), controller.signal);
  controller.abort();
  await assert.rejects(first);
  const second = await service.transcribe(silentWav());
  assert.equal(second.status, 'no_speech');
});
