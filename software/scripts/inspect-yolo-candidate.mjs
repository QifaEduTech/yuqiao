import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Official author-linked release asset. Inspect archive only; do not execute models.
const url = 'https://github.com/user-attachments/files/18121619/yolov8n.zip';
const folder = '.runtime-logs/sign-research';
await mkdir(folder, { recursive: true });
const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const cap = 64 * 1024 * 1024;
if (Number(response.headers.get('content-length')) > cap) throw new Error('Archive exceeds 64 MiB research limit');
const chunks = [];
let size = 0;
for await (const chunk of response.body) {
  size += chunk.length;
  if (size > cap) throw new Error('Archive exceeds 64 MiB research limit');
  chunks.push(chunk);
}
const archive = Buffer.concat(chunks);
if (archive[0] !== 0x50 || archive[1] !== 0x4b) throw new Error('Not a ZIP archive');
await writeFile(`${folder}/yolo-slr-author-release.zip`, archive);
const manifest = { url, finalUrl: response.url, checkedAt: new Date().toISOString(), size, sha256: createHash('sha256').update(archive).digest('hex'), executed: false };
await writeFile(`${folder}/yolo-slr-author-release.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
