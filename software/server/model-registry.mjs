// 全局模型库：训练达标的模型自动加入，所有账号共用。
// 同一个词出现多个版本时，按独立测试的“通过率”选优；版本只增不删。
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
const safe = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'model';

export function passRate(report) {
  const counts = report?.counts;
  if (!counts) return null;
  const total = counts.tp + counts.fn + counts.fp + counts.tn;
  if (!(total > 0)) return null;
  return (counts.tp + counts.tn) / total;
}

function rank(entry) {
  return [entry.score ?? -1, entry.recall ?? -1, entry.createdAt ?? 0];
}

function better(a, b) {
  const left = rank(a), right = rank(b);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] > right[i]) return true;
    if (left[i] < right[i]) return false;
  }
  return false;
}

export class ModelRegistry {
  constructor({dataDir}) {
    this.base = resolve(dataDir, 'model-registry');
    this.hashes = new Map();
  }

  hashOf(file) {
    const stat = statSync(file);
    const key = `${file}|${stat.size}|${stat.mtimeMs}`;
    let value = this.hashes.get(key);
    if (!value) {
      value = digest(readFileSync(file));
      this.hashes.set(key, value);
    }
    return value;
  }

  entries() {
    if (!existsSync(this.base)) return [];
    const list = [];
    for (const sign of readdirSync(this.base, {withFileTypes: true})) {
      if (!sign.isDirectory()) continue;
      const signDir = resolve(this.base, sign.name);
      for (const version of readdirSync(signDir, {withFileTypes: true})) {
        if (!version.isDirectory()) continue;
        const dir = resolve(signDir, version.name);
        const metaFile = resolve(dir, 'meta.json');
        const modelPath = resolve(dir, 'model.json');
        const weightsPath = resolve(dir, 'weights.npz');
        if (!existsSync(metaFile) || !existsSync(modelPath) || !existsSync(weightsPath)) continue;
        try {
          const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
          if (!meta?.signId || !meta?.text || !meta?.sha256) continue;
          if (this.hashOf(weightsPath) !== meta.sha256) continue;
          list.push({...meta, modelPath, weightsPath});
        } catch {
          // 损坏或写了一半的版本跳过，不影响其它模型。
        }
      }
    }
    return list;
  }

  best() {
    const winners = new Map();
    for (const entry of this.entries()) {
      const current = winners.get(entry.signId);
      if (!current || better(entry, current)) winners.set(entry.signId, entry);
    }
    return [...winners.values()];
  }

  publish({signId, text, owner = null, version, modelPath, weightsPath, report = null, createdAt = Date.now(), source = 'training'}) {
    if (!signId || !text || !version) throw Object.assign(Error('模型信息不完整。'), {status: 400});
    if (!existsSync(modelPath) || !existsSync(weightsPath)) throw Object.assign(Error('模型文件不存在。'), {status: 404});
    const weights = readFileSync(weightsPath);
    const sha256 = digest(weights);
    const model = JSON.parse(readFileSync(modelPath, 'utf8'));
    if (model?.sha256 !== sha256) throw Object.assign(Error('模型权重校验失败，未加入全局模型。'), {status: 409});
    if (this.entries().some((entry) => entry.signId === signId && entry.sha256 === sha256)) return {skipped: true, signId, sha256};

    const dir = resolve(this.base, safe(signId), safe(version));
    mkdirSync(dir, {recursive: true});
    copyFileSync(modelPath, resolve(dir, 'model.json'));
    copyFileSync(weightsPath, resolve(dir, 'weights.npz'));
    const meta = {
      signId,
      text,
      version,
      owner: owner ? digest(String(owner)).slice(0, 16) : null,
      createdAt,
      source,
      sha256,
      score: passRate(report),
      recall: report?.recall ?? null,
      precision: report?.precision ?? null,
      falsePositiveRate: report?.falsePositiveRate ?? null,
      counts: report?.counts ?? null
    };
    const file = resolve(dir, 'meta.json'), temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(meta, null, 1));
    renameSync(temp, file);
    return meta;
  }

  // 给界面看的公开信息：不暴露训练者身份。
  summary() {
    return this.best().map((entry) => ({
      signId: entry.signId,
      text: entry.text,
      version: entry.version,
      score: entry.score ?? null,
      recall: entry.recall ?? null,
      precision: entry.precision ?? null,
      createdAt: entry.createdAt ?? null
    }));
  }
}
