#!/usr/bin/env node
/**
 * Verify the local Nginx HTTP reverse proxy.
 * Run after Start-Yuqiao.cmd (default Nginx mode).
 */
import { readFileSync } from 'node:fs';
let target = process.argv.find(x => x.startsWith('--url='))?.slice(6) || process.env.NGINX_URL || '';
if (!target) {
  try {
    const marker = JSON.parse(readFileSync('.runtime-logs/nginx-runtime.json', 'utf8'));
    target = marker.httpsPort ? `https://127.0.0.1:${marker.httpsPort}` : `http://127.0.0.1:${marker.httpPort}`;
  } catch {
    target = 'http://127.0.0.1:8080';
  }
}
if (target.startsWith('https://')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const base = target.replace(/\/$/, '');
const origin = new URL(base).origin;
const failures = [];
const pass = message => console.log('PASS', message);
const fail = message => { failures.push(message); console.error('FAIL', message); };

async function status(path, options) {
  try {
    const response = await fetch(base + path, { redirect: 'manual', ...options });
    return { status: response.status, headers: response.headers, text: await response.text() };
  } catch (error) {
    fail(`${path}: ${error.message}`);
    return null;
  }
}

const health = await status('/api/health');
if (health?.status === 200) {
  try {
    const body = JSON.parse(health.text);
    if (body.service === 'yuqiao' && body.database === 'mysql') pass('/api/health service/database');
    else fail(`/api/health unexpected body: ${health.text.slice(0, 200)}`);
    if (Array.isArray(body.origins) && body.origins.includes(origin)) pass(`/api/health includes Origin ${origin}`);
    else fail(`/api/health origins does not include ${origin}`);
  } catch { fail('/api/health is not JSON'); }
} else if (health) fail(`/api/health status ${health.status}`);

for (const path of ['/', '/learning.html', '/realtime.html', '/sign-dictionary.html']) {
  const page = await status(path);
  if (page?.status === 200 && /text\/html/i.test(page.headers.get('content-type') || '')) pass(`${path} HTML`);
  else if (page) fail(`${path} status/content-type ${page.status} ${page.headers.get('content-type')}`);
}

const badOrigin = await status('/api/auth/login', {
  method: 'POST',
  headers: { Origin: 'http://127.0.0.1:9999', 'X-Yuqiao-Request': '1', 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'proxy-check', password: 'not-a-real-password', captchaId: 'x', captchaCode: 'x' }),
});
if (badOrigin?.status === 403) pass('foreign Origin rejected with 403');
else if (badOrigin) fail(`foreign Origin expected 403, got ${badOrigin.status}`);

const missingHeader = await status('/api/auth/login', {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'proxy-check', password: 'not-a-real-password', captchaId: 'x', captchaCode: 'x' }),
});
if (missingHeader?.status === 403) pass('missing X-Yuqiao-Request rejected with 403');
else if (missingHeader) fail(`missing X-Yuqiao-Request expected 403, got ${missingHeader.status}`);

const allowed = await status('/api/auth/login', {
  method: 'POST',
  headers: { Origin: origin, 'X-Yuqiao-Request': '1', 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'proxy-check', password: 'not-a-real-password', captchaId: 'x', captchaCode: 'x' }),
});
if (allowed && allowed.status !== 403) pass(`allowed Origin passes proxy/origin gate (HTTP ${allowed.status})`);
else if (allowed) fail('allowed Origin was rejected with 403');

if (failures.length) {
  console.error(`\n${failures.length} proxy check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Nginx proxy checks passed.');
