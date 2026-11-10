import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const url = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2';
const size = 163002883;
const sha256 = '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e';
const cache = '.runtime-logs/asr-setup';
await mkdir(`${cache}/parts`, { recursive: true });
const resolved = await fetch('https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/assets/288366523', { method: 'HEAD', headers: { Accept: 'application/octet-stream', 'User-Agent': 'Yuqiao' }, signal: AbortSignal.timeout(20000) });
if (!resolved.ok || Number(resolved.headers.get('content-length')) !== size) throw new Error('Could not resolve official release asset');
const downloadUrl = resolved.url;
const chunkSize = 4 * 1024 * 1024;
const count = Math.ceil(size / chunkSize);
let next = 0, completed = 0;
async function worker() {
  while (next < count) {
    const index = next++;
    const start = index * chunkSize, end = Math.min(start + chunkSize, size) - 1;
    const path = `${cache}/parts/${index}.part`;
    try { if ((await stat(path)).size === end - start + 1) { completed++; continue; } } catch {}
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(downloadUrl, { headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(45000) });
        if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`) throw new Error(`Unexpected range ${response.status}`);
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length !== end - start + 1) throw new Error('Truncated download');
        await writeFile(path, data);
        completed++;
        if (completed % 5 === 0 || completed === count) console.log(`Model download ${Math.round(completed / count * 100)}%`);
        break;
      } catch (error) { if (attempt === 2) throw error; }
    }
  }
}
await Promise.all([worker(), worker(), worker()]);
const parts = [];
for (let index = 0; index < count; index++) parts.push(await readFile(`${cache}/parts/${index}.part`));
const archive = Buffer.concat(parts);
if (archive.length !== size || createHash('sha256').update(archive).digest('hex') !== sha256) throw new Error('Model checksum mismatch');
await writeFile(`${cache}/sensevoice-int8.tar.bz2`, archive);
await mkdir('docs/assets', { recursive: true });
await writeFile('docs/assets/speech-model-source.json', JSON.stringify({ name: 'SenseVoice Small INT8 via sherpa-onnx', source: url, sha256, bytes: size, acquired: '2026-10-11', use: 'local Chinese ASR only; not sign recognition' }, null, 2));
console.log('Model archive verified.');
