import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = resolve(root, '.runtime-logs/tmp');
mkdirSync(temp, { recursive: true });
const environment = {
  ...process.env,
  TEMP: temp,
  TMP: temp,
  TMPDIR: temp,
  NPM_CONFIG_CACHE: resolve(root, '.runtime-logs/npm-cache'),
  NPM_CONFIG_LOGS_DIR: resolve(root, '.runtime-logs/npm-logs'),
  PLAYWRIGHT_BROWSERS_PATH: resolve(root, '.runtime-logs/playwright'),
  PYTHONPYCACHEPREFIX: resolve(root, '.runtime-logs/pycache'),
  PIP_CACHE_DIR: resolve(root, '.runtime-logs/pip-cache'),
  KERAS_HOME: resolve(root, '.runtime-logs/keras'),
  MPLCONFIGDIR: resolve(root, '.runtime-logs/matplotlib'),
  PYTHONIOENCODING: 'utf-8',
  HF_HOME: resolve(root, '.runtime-logs/huggingface'),
  TORCH_HOME: resolve(root, '.runtime-logs/torch'),
  XDG_CACHE_HOME: resolve(root, '.runtime-logs/cache'),
};

async function run(script, args) {
  return await new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, [resolve(root, script), ...args], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => resolveCode(code ?? 1));
  });
}

const action = process.argv[2];
const extra = process.argv.slice(3);
let exitCode = 0;
if (action === 'build') {
  exitCode = await run('scripts/render-sign-dictionary.mjs', []);
  if (!exitCode) exitCode = await run('node_modules/typescript/bin/tsc', ['--noEmit']);
  if (!exitCode) exitCode = await run('node_modules/vite/bin/vite.js', ['build', ...extra]);
} else if (action === 'dev' || action === 'preview') {
  exitCode = await run('scripts/dev-stack.mjs', [...(action === 'preview' ? ['--preview'] : []), ...extra]);
} else if (action === 'test') {
  exitCode = await run('node_modules/@playwright/test/cli.js', ['test', ...extra]);
} else if (action === 'server') {
  exitCode = await run('server/index.mjs', extra);
} else if (action==='sign-training-check') {
  exitCode=await new Promise((resolveCode,reject)=>{
    const python=resolve(root,'.venv-anny/Scripts/python.exe');
    const child=spawn(python,['-B',resolve(root,'scripts/check-sign-training.py')],{cwd:root,env:environment,stdio:'inherit',windowsHide:true});
    child.on('error',reject);child.on('exit',code=>resolveCode(code??1));
  });
} else if (['sign-check','realtime-check','sample-quality','sample-quality-check','temporal-check','temporal-evaluate','thumb-evaluate','thumb-check','thumb-multijoint-check','training-features-check','training-readiness','training-pilot'].includes(action)) {
  exitCode = await new Promise((resolveCode, reject) => {
    const python = resolve(root, process.platform === 'win32' ? '.venv-sign/Scripts/python.exe' : '.venv-sign/bin/python');
    const script={'sign-check':'check-sign-runtime.py','realtime-check':'check-realtime-runtime.py','sample-quality':'audit-sample-quality.py','sample-quality-check':'check-sample-quality.py','temporal-check':'check-temporal-adapter.py','temporal-evaluate':'evaluate-temporal-adapter.py','thumb-evaluate':'evaluate-thumb-evidence.py','thumb-check':'check-thumb-evidence.py','thumb-multijoint-check':'check-thumb-multijoint.py','training-features-check':'check-training-features.py','training-readiness':'check-training-readiness.py','training-pilot':'run-sign-training.py'}[action];
    const child = spawn(python, ['-B',resolve(root,'scripts',script),...extra], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', code => resolveCode(code ?? 1));
  });
} else {
  console.error('Use dev, build, preview or test.');
  exitCode = 1;
}
process.exitCode = exitCode;
