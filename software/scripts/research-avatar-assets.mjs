import { mkdir, writeFile } from 'node:fs/promises';
const sources = [
  ['livetalking-readme', 'https://api.github.com/repos/lipku/LiveTalking/contents/README.md'],
  ['livetalking-license', 'https://api.github.com/repos/lipku/LiveTalking/license'],
  ['musetalk-readme', 'https://api.github.com/repos/TMElyralab/MuseTalk/contents/README.md'],
  ['musetalk-license', 'https://api.github.com/repos/TMElyralab/MuseTalk/license'],
  ['echomimic-readme', 'https://api.github.com/repos/antgroup/echomimic_v2/contents/README.md'],
  ['mimicmotion-readme', 'https://api.github.com/repos/Tencent/MimicMotion/contents/README.md'],
  ['liveportrait-readme', 'https://api.github.com/repos/KwaiVGI/LivePortrait/contents/readme.md'],
];
await mkdir('.runtime-logs/asset-research', { recursive: true });
const results = await Promise.all(sources.map(async ([name, url]) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Yuqiao-local-development' } });
    let body = await response.text();
    try { const json = JSON.parse(body); if (json.encoding === 'base64') body = Buffer.from(json.content, 'base64').toString('utf8'); } catch {}
    await writeFile(`.runtime-logs/asset-research/${name}.txt`, body);
    return { name, url, status: response.status, relevant: body.split('\n').filter(line => /licen|\.mp4|\.webm|youtu|demo|project|gpu|vram|commercial|copyright|权|直播|hand|pose/i.test(line)).join('\n').slice(0, 8500) };
  } catch (error) { return { name, url, error: error.message }; }
}));
results.forEach(result => console.log(JSON.stringify(result)));
