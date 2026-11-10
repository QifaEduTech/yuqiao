import { spawn } from 'node:child_process';
import { spawnPowerShell } from '../server/powershell.mjs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const preview = args[0] === '--preview';
if (preview) args.shift();
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : preview ? 4173 : 5173;
const apiPort = Number(process.env.API_PORT || 5174);
const workspace = createHash('sha256').update(resolve(root, 'web/public')).digest('hex').slice(0, 16);
const environment = { ...process.env, API_PORT: String(apiPort), APP_ORIGINS: process.env.APP_ORIGINS || `http://127.0.0.1:${port},http://localhost:${port}`, VITE_API_TARGET: `http://127.0.0.1:${apiPort}` };
let backend, frontend, stopping = false;

async function checkBackend() {
  let response;
  try { response = await fetch(`http://127.0.0.1:${apiPort}/api/health`, { signal: AbortSignal.timeout(1200) }); }
  catch { return false; }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.service !== 'yuqiao' || result.workspace !== workspace) throw new Error(`API port ${apiPort} is occupied by a different or outdated service. Stop that service before starting this project.`);
  if (!result.origins?.includes(`http://127.0.0.1:${port}`)) throw new Error('Existing backend is configured for a different frontend port.');
  return true;
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  frontend?.kill();
  if (backend?.connected) backend.send('shutdown');
  const timeout = setTimeout(() => { backend?.kill(); process.exit(code); }, 2000);
  if (!backend || backend.exitCode !== null) { clearTimeout(timeout); process.exit(code); }
  backend?.once('exit', () => { clearTimeout(timeout); process.exit(code); });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop());
try {
  if(process.platform==='win32'&&process.env.YUQIAO_SKIP_LLM_START!=='1'){
    await new Promise(resolveStart=>{
      const helper=spawnPowerShell(['-NoProfile','-File',resolve(root,'scripts/start-local-language.ps1')],{cwd:root,env:environment,stdio:'inherit',windowsHide:true});
      helper.on('error',()=>{console.warn('Local language service unavailable; Web can still start.');resolveStart();});
      helper.on('exit',code=>{if(code)console.warn('Local language service not ready; see startup logs.');resolveStart();});
    });
  }
  if (!await checkBackend()) {
    backend = spawn(process.execPath, [resolve(root, 'server/index.mjs')], { cwd: root, env: environment, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], windowsHide: true });
    let startupError;
    backend.on('error', error => { startupError = error; });
    backend.on('exit', code => { if (frontend && !stopping) { console.error('Backend stopped; closing frontend to avoid broken login.'); stop(code || 1); } });
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (startupError) throw startupError;
      if (backend.exitCode !== null) throw new Error('Backend could not start.');
      if (await checkBackend()) { ready = true; break; }
      await delay(250);
    }
    if (!ready) throw new Error('Backend readiness timed out.');
  }
  console.log('Backend ready. Starting Web interface.');
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), ...(preview ? ['preview'] : []), '--host', '127.0.0.1', ...args], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
  frontend.on('error', error => { console.error(error.message); stop(1); });
  frontend.on('exit', code => stop(code || 0));
} catch (error) { console.error(error.message); stop(1); }
