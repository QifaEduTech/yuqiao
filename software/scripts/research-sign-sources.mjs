import { mkdir, writeFile } from 'node:fs/promises';

// Read public project metadata only; never download executable code or weights.
const folder = '.runtime-logs/sign-research';
await mkdir(folder, { recursive: true });
const mode = process.argv[2];
const targets = process.argv.slice(3);
for (let offset = 0; offset < targets.length; offset += 3) {
  await Promise.all(targets.slice(offset, offset + 3).map(async (target) => {
    const url = mode === 'search'
      ? `https://api.github.com/search/repositories?q=${encodeURIComponent(target)}&sort=stars&per_page=7`
      : mode === 'repo' ? `https://api.github.com/repos/${target}` : target;
    const key = `${mode}-${target}`.replace(/[^a-zA-Z0-9\u4e00-\u9fff.-]/g, '_').slice(0, 180);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Yuqiao-public-model-research', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.text();
      await writeFile(`${folder}/${key}.json`, JSON.stringify({ checkedAt: new Date().toISOString(), url, finalUrl: response.url, status: response.status, body }, null, 2));
      if (mode === 'search') {
        const data = JSON.parse(body);
        console.log(JSON.stringify({ target, status: response.status, total: data.total_count, message: data.message, items: data.items?.map(r => ({ repo: r.full_name, description: r.description?.slice(0, 400), stars: r.stargazers_count, license: r.license?.spdx_id })) }));
      } else if (mode === 'repo') {
        const data = JSON.parse(body);
        console.log(JSON.stringify({ target, status: response.status, branch: data.default_branch, license: data.license?.spdx_id, description: data.description, stars: data.stargazers_count, message: data.message }));
      } else if (mode === 'npy-header') {
        const data = JSON.parse(body);
        const bytes = Buffer.from(data.content || '', 'base64');
        const isNpy = bytes.subarray(0, 6).equals(Buffer.from([147, 78, 85, 77, 80, 89]));
        console.log(JSON.stringify({ target, status: response.status, declaredSize: data.size, decodedBytes: bytes.length, isNpy, header: isNpy ? bytes.subarray(6, 128).toString('latin1') : null }));
      } else if (mode === 'tree') {
        const data = JSON.parse(body);
        console.log(JSON.stringify({ target, status: response.status, sha: data.sha, truncated: data.truncated, files: data.tree?.filter(x => /readme|license|copying|\.pt$|\.onnx$|\.task$|\.tflite$|class|label|\.yaml$|datasheet/i.test(x.path)).map(x => ({ path: x.path, size: x.size })) }));
      } else if (mode === 'contents') {
        const data = JSON.parse(body);
        const decoded = data.encoding === 'base64' ? Buffer.from(data.content, 'base64').toString('utf8') : body;
        await writeFile(`${folder}/${key}.txt`, decoded);
        console.log(JSON.stringify({ target, status: response.status, body: decoded.slice(0, 26000) }));
      } else console.log(JSON.stringify({ target, status: response.status, body: body.slice(0, 26000) }));
    } catch (error) { console.log(JSON.stringify({ target, error: error.message })); }
  }));
}
