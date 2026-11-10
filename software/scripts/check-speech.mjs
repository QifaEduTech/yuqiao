import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SpeechService } from '../server/speech.mjs';
const service = new SpeechService(resolve('.'));
try {
  const started = performance.now();
  const bytes = await readFile('models/sensevoice-small-int8/test_wavs/zh.wav');
  const result = await service.transcribe(bytes);
  console.log(JSON.stringify({ ...result, total_ms: Math.round(performance.now() - started), source: 'upstream public Chinese fixture' }));
  if (result.status !== 'transcribed' || !/[\u4e00-\u9fff]/.test(result.text)) throw new Error('Chinese fixture was not transcribed');
  const silence = Buffer.alloc(32044);
  silence.write('RIFF', 0); silence.writeUInt32LE(32036, 4); silence.write('WAVEfmt ', 8);
  silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
  silence.writeUInt32LE(16000, 24); silence.writeUInt32LE(32000, 28); silence.writeUInt16LE(2, 32); silence.writeUInt16LE(16, 34);
  silence.write('data', 36); silence.writeUInt32LE(32000, 40);
  const empty = await service.transcribe(silence);
  console.log(JSON.stringify({ silence: empty }));
  if (empty.status !== 'no_speech' || empty.text) throw new Error('Silence produced a transcript');
  await writeFile('.runtime-logs/asr-setup/verification.json', JSON.stringify({ chinese_fixture: result, silence: empty, measured_at: new Date().toISOString() }, null, 2));
} finally { service.close(); }
