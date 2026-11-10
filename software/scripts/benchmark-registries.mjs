import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const registries = [
  ['npm 官方', 'https://registry.npmjs.org'],
  ['阿里 npmmirror', 'https://registry.npmmirror.com'],
  ['华为云', 'https://repo.huaweicloud.com/repository/npm'],
  ['腾讯云', 'https://mirrors.cloud.tencent.com/npm'],
];
const packageName = 'react';
const version = '19.0.0';

async function probe(name, registry, round) {
  const start = performance.now();
  try {
    const metaResponse = await fetch(`${registry}/${packageName}/${version}`, { signal: AbortSignal.timeout(10000) });
    if (!metaResponse.ok) throw new Error(`metadata HTTP ${metaResponse.status}`);
    const metadata = await metaResponse.json();
    if (metadata.name !== packageName || metadata.version !== version) throw new Error('invalid package metadata');
    const metadataMs = performance.now() - start;
    const downloadStart = performance.now();
    const tarballUrl = metadata.dist.tarball.startsWith('/') ? `${registry}${metadata.dist.tarball}` : metadata.dist.tarball;
    const response = await fetch(tarballUrl, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`tarball HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const integrity = metadata.dist.integrity;
    if (integrity?.startsWith('sha512-')) {
      if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity) throw new Error('integrity mismatch');
    } else if (createHash('sha1').update(bytes).digest('hex') !== metadata.dist.shasum) {
      throw new Error('checksum mismatch');
    }
    return { name, registry, round, ok: true, metadata_ms: Math.round(metadataMs), download_ms: Math.round(performance.now() - downloadStart), total_ms: Math.round(performance.now() - start), bytes: bytes.length, tarball_host: new URL(response.url).host };
  } catch (error) {
    return { name, registry, round, ok: false, elapsed_ms: Math.round(performance.now() - start), error: error.message };
  }
}

const results = [];
for (let round = 1; round <= 2; round++) {
  const batch = await Promise.all(registries.map(([name, registry]) => probe(name, registry, round)));
  results.push(...batch);
  batch.forEach(result => console.log(JSON.stringify(result)));
}
const ranking = registries.map(([name, registry]) => {
  const rounds = results.filter(result => result.registry === registry);
  return { name, registry, successful_rounds: rounds.filter(result => result.ok).length, average_ms: Math.round(rounds.reduce((total, result) => total + (result.total_ms ?? 30000), 0) / rounds.length) };
}).filter(result => result.successful_rounds === 2).sort((a, b) => a.average_ms - b.average_ms);
await mkdir('.runtime-logs', { recursive: true });
await writeFile('.runtime-logs/registry-benchmark.json', JSON.stringify({ measured_at: new Date().toISOString(), package: `${packageName}@${version}`, results, ranking }, null, 2));
console.log('RANKING', JSON.stringify(ranking));
if (!ranking.length) process.exitCode = 1;
