import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('.runtime-logs/asr-setup', { recursive: true });
const sources = [
  ['release', 'https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/asr-models'],
  ['license', 'https://api.github.com/repos/k2-fsa/sherpa-onnx/license'],
  ['hf-model', 'https://huggingface.co/api/models/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'],
];
for (const [name, url] of sources) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Yuqiao' }, signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    const data = name === 'release' ? { status: response.status, assets: result.assets?.filter(asset => /sense.voice/i.test(asset.name)).map(asset => ({ name: asset.name, size: asset.size, url: asset.browser_download_url, api: asset.url, digest: asset.digest })) } : result;
    await writeFile(`.runtime-logs/asr-setup/${name}.json`, JSON.stringify(data, null, 2));
    console.log(JSON.stringify({ name, data: name === 'license' ? result.license : data }));
  } catch (error) { console.log(JSON.stringify({ name, error: error.message })); }
}
const mirrors = [['阿里', 'https://mirrors.aliyun.com/pypi/simple/sherpa-onnx/'], ['清华', 'https://pypi.tuna.tsinghua.edu.cn/simple/sherpa-onnx/'], ['腾讯', 'https://mirrors.cloud.tencent.com/pypi/simple/sherpa-onnx/']];
await Promise.all(mirrors.map(async ([name, url]) => {
  const start = performance.now();
  try { const response = await fetch(url, { signal: AbortSignal.timeout(10000) }); const body = await response.text(); console.log(JSON.stringify({ mirror: name, status: response.status, elapsed_ms: Math.round(performance.now() - start), windows_python312: /cp312.*win_amd64/.test(body) })); }
  catch (error) { console.log(JSON.stringify({ mirror: name, error: error.message })); }
}));
