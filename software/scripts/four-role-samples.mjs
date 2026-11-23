import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitJointTrainingPool } from '../server/joint-dataset-split.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const reportPath = resolve(root, 'outputs/four-role/01_大模型工程师/observation.json');

async function sourceDigest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

async function sampleFromSelection(directory, entry, labels, index) {
  const id = index + 1;
  const label = entry.word === '背景' ? 0 : labels.findIndex(({ text }) => text === entry.word) + 1;
  if ((!label && entry.word !== '背景') || !['train', 'test'].includes(entry.split)) {
    throw Error(`样本 ${id} 的词语或分区无效。`);
  }
  const selected = JSON.parse(await readFile(resolve(directory, entry.selection), 'utf8'));
  const start = selected.startSeconds;
  const end = selected.endSecondsInclusive;
  if (selected.schema !== 'mediapipe-demo-selection-v1' || !Number.isFinite(start) ||
      !Number.isFinite(end) || start < 0 || end - start < 0.5 || end > 30.25 || typeof selected.source !== 'string') {
    throw Error(`样本 ${id} 的选段记录无效。请先用 MediaPipe 工具标记完整动作。`);
  }
  const sourceHash = await sourceDigest(resolve(dirname(resolve(directory, entry.selection)), selected.source));
  if (sourceHash !== selected.sourceSha256) throw Error(`样本 ${id} 的原片与选段记录不匹配。`);
  const group = typeof entry.group === 'string' ? entry.group.trim() : '';
  if (entry.realGroupConfirmed === true && !group) throw Error(`样本 ${id} 缺少已确认的拍摄组。`);
  return { id, word: entry.word, label, start, end, sourceHash, split: entry.split,
    group, realGroupConfirmed: entry.realGroupConfirmed === true };
}

async function run(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const labels = Array.isArray(manifest.words) ? manifest.words.map(text => ({ text })) : [];
  const words = labels.map(({ text }) => text);
  if (!labels.length || labels.length > 64 || words.some(word => typeof word !== 'string' || !word.trim() || word.trim() !== word || word === '背景') ||
      new Set(words).size !== labels.length || !Array.isArray(manifest.samples) || !manifest.samples.length || manifest.samples.length > 3000) {
    throw Error('清单需要 1—64 个不同的动作词和 1—3000 条样本。');
  }
  const policy = JSON.parse(await readFile(resolve(root, 'shared/unified-training.json'), 'utf8'));
  const samples = [];
  for (const [index, entry] of manifest.samples.entries()) {
    samples.push(await sampleFromSelection(dirname(manifestPath), entry, labels, index));
  }
  const report = { status: '分区已检查', scope: '选段与分区演示', samples, checkedAt: new Date().toISOString() };
  try {
    const plan = splitJointTrainingPool(samples, labels, policy);
    report.samples = plan.samples;
    report.summary = plan.summary;
  } catch (error) {
    if (error.status !== 400) throw error;
    report.status = '分区未通过';
    report.reason = error.message;
  }
  await mkdir(dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(report, null, 2));
  await rename(temporary, reportPath);
  console.log(JSON.stringify({ status: report.status, reason: report.reason, summary: report.summary, report: reportPath }, null, 2));
  if (report.reason) process.exitCode = 2;
}

const [manifest] = process.argv.slice(2);
if (!manifest || manifest === '--help') {
  console.log('用法：node scripts/four-role-samples.mjs <样本清单.json>');
} else {
  run(resolve(manifest)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
