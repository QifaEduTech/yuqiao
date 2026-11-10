import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {ModelRegistry,passRate} from '../../server/model-registry.mjs';

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function model(dir, weights) {
  await mkdir(dir, {recursive: true});
  const path = join(dir, 'weights.npz');
  await writeFile(path, weights);
  const modelPath = join(dir, 'model.json');
  await writeFile(modelPath, JSON.stringify({protocol: 'self-service-body178-v1', sha256: sha(weights)}));
  return {modelPath, weightsPath: path};
}

function report(tp, fn, fp, tn, recall) {
  return {counts: {tp, fn, fp, tn}, recall, precision: 0.95, falsePositiveRate: 0};
}

test('通过率按真实计数计算，不看启用标记', () => {
  assert.equal(passRate(report(18, 2, 0, 20)), 0.95);
  assert.equal(passRate({counts: {tp: 0, fn: 0, fp: 0, tn: 0}}), null);
});

test('全局库保留所有版本，同一个词取通过率最高的一个', async (t) => {
  const parent = resolve('.runtime-logs/registry-tests');
  await mkdir(parent, {recursive: true});
  const root = await mkdtemp(join(parent, 'case-'));
  t.after(async () => { assert.ok(root.startsWith(parent + sep)); await rm(root, {recursive: true, force: true}); });

  const registry = new ModelRegistry({dataDir: root});
  const first = await model(join(root, 'src-a'), Buffer.from('weights-a'));
  const second = await model(join(root, 'src-b'), Buffer.from('weights-b'));

  registry.publish({signId: 'csl.demo', text: '演示词', owner: 'user-a', version: 'v1', ...first, report: report(16, 4, 2, 18), createdAt: 1000});
  registry.publish({signId: 'csl.demo', text: '演示词', owner: 'user-b', version: 'v2', ...second, report: report(19, 1, 1, 19), createdAt: 2000});

  assert.equal(registry.entries().length, 2, '两个版本都要保留，不释放资源');
  const best = registry.best();
  assert.equal(best.length, 1);
  assert.equal(best[0].version, 'v2', '通过率更高的版本生效');
  assert.equal(best[0].text, '演示词');

  const again = registry.publish({signId: 'csl.demo', text: '演示词', owner: 'user-b', version: 'v2', ...second, report: report(19, 1, 1, 19)});
  assert.equal(again.skipped, true, '同一份权重重复加入不产生副本');

  const summary = registry.summary();
  assert.deepEqual(Object.keys(summary[0]).sort(), ['createdAt', 'precision', 'recall', 'score', 'signId', 'text', 'version']);
});

test('权重对不上、文件缺失的版本不参与生效', async (t) => {
  const parent = resolve('.runtime-logs/registry-tests');
  await mkdir(parent, {recursive: true});
  const root = await mkdtemp(join(parent, 'case-'));
  t.after(async () => { assert.ok(root.startsWith(parent + sep)); await rm(root, {recursive: true, force: true}); });

  const registry = new ModelRegistry({dataDir: root});
  const good = await model(join(root, 'src-good'), Buffer.from('weights-good'));
  registry.publish({signId: 'csl.a', text: '甲', owner: 'u1', version: 'ok', ...good, report: report(19, 1, 0, 20)});
  assert.equal(registry.best().length, 1);

  const broken = await model(join(root, 'src-broken'), Buffer.from('weights-broken'));
  await writeFile(broken.modelPath, JSON.stringify({protocol: 'self-service-body178-v1', sha256: sha(Buffer.from('other'))}));
  assert.throws(() => registry.publish({signId: 'csl.b', text: '乙', owner: 'u1', version: 'bad', ...broken, report: report(19, 1, 0, 20)}), /权重校验失败/);

  assert.throws(() => registry.publish({signId: 'csl.c', text: '丙', owner: 'u1', version: 'gone', modelPath: join(root, 'nope', 'model.json'), weightsPath: join(root, 'nope', 'weights.npz'), report: report(19, 1, 0, 20)}), /不存在/);
});
