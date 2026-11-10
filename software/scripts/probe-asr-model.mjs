const sources = [
  'https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/assets/288366523',
  'https://hf-mirror.com/api/models/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/main?recursive=true',
  'https://api.github.com/repos/FunAudioLLM/SenseVoice/license',
];
await Promise.all(sources.map(async url => {
  const start = performance.now();
  try {
    const isMetadata = url.includes('/tree/') || url.endsWith('/license');
    const response = await fetch(url, { method: isMetadata ? 'GET' : 'HEAD', headers: { Accept: url.includes('/releases/assets/') ? 'application/octet-stream' : 'application/json', 'User-Agent': 'Yuqiao' }, signal: AbortSignal.timeout(15000) });
    const metadata = isMetadata ? await response.json() : null;
    console.log(JSON.stringify({ source: url, status: response.status, type: response.headers.get('content-type'), size: response.headers.get('content-length'), ms: Math.round(performance.now() - start), metadata: url.endsWith('/license') ? metadata.license : metadata }));
    if (url.includes('/tree/') && Array.isArray(metadata)) { const { writeFile } = await import('node:fs/promises'); await writeFile('.runtime-logs/asr-setup/hf-files.json', JSON.stringify(metadata, null, 2)); }
  }
  catch (error) { console.log(JSON.stringify({ source: url, error: error.message })); }
}));
