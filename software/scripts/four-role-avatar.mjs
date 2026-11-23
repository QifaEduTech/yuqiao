import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const reportPath = resolve(root, 'outputs/four-role/03_AI应用工程师/workflow.json');

async function main() {
  const { values } = parseArgs({ options: {
    url: { type: 'string', default: 'http://127.0.0.1:5174' },
    text: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help || !values.text?.trim()) {
    console.log('用法：node scripts/four-role-avatar.mjs --text "我需要帮助" [--url http://127.0.0.1:5174]');
    return;
  }
  const base = new URL(values.url);
  if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) {
    throw Error('请指定语桥本机服务地址。');
  }
  const health = await fetch(new URL('/api/health', base), { redirect: 'error', signal: AbortSignal.timeout(5000) });
  const service = await health.json();
  if (!health.ok || service.service !== 'yuqiao' || !Array.isArray(service.origins)) {
    throw Error('该地址未提供语桥后端。请核对启动器显示的地址或后端端口。');
  }
  const origin = service.origins.includes(base.origin) ? base.origin : service.origins[0];
  if (typeof origin !== 'string' || !origin) throw Error('语桥后端未配置允许的页面来源。');
  const input = values.text.trim();
  const response = await fetch(new URL('/api/sign/resolve', base), {
    method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-yuqiao-request': '1' },
    body: JSON.stringify({ text: input, mode: 'playback' }), redirect: 'error', signal: AbortSignal.timeout(105000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(`动作匹配请求失败（HTTP ${response.status}）：${result.error?.message ?? result.message ?? result.detail ?? '请核对语桥后端地址和模型服务'}`);
  if (!result || typeof result.status !== 'string' || !('preview' in result)) {
    throw Error('该服务未返回语桥的动作匹配结果。');
  }
  const catalog = JSON.parse(await readFile(resolve(root, 'shared/sign-motion-catalog.json'), 'utf8'));
  const names = new Map(catalog.entries.map(({ id, label }) => [id, label]));
  const previews = result.preview?.kind === 'sequence' ? result.preview.steps : result.preview ? [result.preview] : [];
  const steps = previews.map(({ id, version, label }) => ({ id, version, text: names.get(id) ?? label ?? id }));
  const report = { status: steps.length ? '已匹配动作' : '未生成播放计划', input, steps,
    responseStatus: result.status, reason: result.reason ?? null, missing: result.missing ?? [],
    scope: '实际后端接口响应，播放器表现由首页现场核对', checkedAt: new Date().toISOString() };
  await mkdir(dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(report, null, 2));
  await rename(temporary, reportPath);
  console.log(JSON.stringify({ ...report, report: reportPath }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
