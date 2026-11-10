import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const repository = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';
const base = `https://hf-mirror.com/${repository}/resolve/main`;
const files = JSON.parse(await readFile('docs/assets/speech-model-source.json', 'utf8')).files;
const chosen = ['model.int8.onnx', 'tokens.txt', 'LICENSE', 'test_wavs/zh.wav'];
const directory = 'models/sensevoice-small-int8';
await mkdir(`${directory}/test_wavs`, { recursive: true });
await mkdir('.runtime-logs/asr-setup/onnx-parts', { recursive: true });
for (const name of chosen) {
  const meta = files.find(file => file.path === name);
  if (!meta) throw new Error(`Missing manifest: ${name}`);
  const verify = data => meta.lfs ? createHash('sha256').update(data).digest('hex') === meta.lfs.oid : createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex') === meta.oid;
  try { const existing = await readFile(`${directory}/${name}`); if (verify(existing)) { console.log(`${name} already verified`); continue; } } catch {}
  let data;
  if (meta.size < 1_000_000) {
    const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`File HTTP ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
  } else {
    const head = await fetch(`${base}/${name}`, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
    if (!head.ok) throw new Error(`Model metadata HTTP ${head.status}`);
    const downloadUrl = head.url;
    const chunkSize = 4 * 1024 * 1024, count = Math.ceil(meta.size / chunkSize);
    let next = 0, completed = 0;
    async function worker() {
      while (next < count) {
        const index = next++, start = index * chunkSize, end = Math.min(start + chunkSize, meta.size) - 1;
        const part = `.runtime-logs/asr-setup/onnx-parts/${index}.part`;
        try { if ((await stat(part)).size === end - start + 1) { completed++; continue; } } catch {}
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await fetch(downloadUrl, { headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(30000) });
            if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${meta.size}`) throw new Error(`Range HTTP ${response.status}`);
            const content = Buffer.from(await response.arrayBuffer());
            if (content.length !== end - start + 1) throw new Error('Incomplete chunk');
            await writeFile(part, content); completed++;
            if (completed % 8 === 0 || completed === count) console.log(`Chinese model ${Math.round(completed / count * 100)}%`);
            break;
          } catch (error) { if (attempt === 2) throw error; }
        }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    const buffers = [];
    for (let index = 0; index < count; index++) buffers.push(await readFile(`.runtime-logs/asr-setup/onnx-parts/${index}.part`));
    data = Buffer.concat(buffers);
  }
  if (data.length !== meta.size || !verify(data)) throw new Error(`Integrity failed: ${name}`);
  await writeFile(`${directory}/${name}`, data);
  console.log(`Verified ${name} (${data.length} bytes)`);
}
await writeFile('models/speech-manifest.json', JSON.stringify({ name: 'SenseVoice Small INT8', model_dir: directory, model: 'model.int8.onnx', tokens: 'tokens.txt' }, null, 2));
await writeFile('docs/assets/speech-model-source.json', JSON.stringify({ source: `https://huggingface.co/${repository}`, mirror: 'https://hf-mirror.com', files: files.filter(file => chosen.includes(file.path)), acquired: '2026-10-11', use: 'local Chinese ASR; not sign recognition' }, null, 2));
console.log('Local Chinese ASR model ready.');
