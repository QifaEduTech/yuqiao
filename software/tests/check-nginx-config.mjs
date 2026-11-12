import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('prepare-nginx writes an ASCII runtime config with the required proxy rules', () => {
  const runtime = mkdtempSync(join(tmpdir(), 'yuqiao-nginx-'));
  const marker = join(runtime, 'marker.json');
  try {
    const result = spawnSync(process.execPath, [
      'scripts/prepare-nginx.mjs',
      '--runtime', runtime,
      '--port', '18080',
      '--api-port', '15174',
      '--marker', marker,
    ], { cwd: resolve('.'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!/[^\x00-\x7f]/.test(runtime), 'test runtime must be ASCII');

    const conf = readFileSync(join(runtime, 'conf', 'yuqiao.conf'), 'utf8');
    assert.match(conf, /listen 127\.0\.0\.1:18080;/);
    assert.match(conf, /proxy_pass http:\/\/127\.0\.0\.1:15174;/);
    assert.match(conf, /client_max_body_size 64m;/);
    assert.match(conf, /proxy_buffering off;/);
    assert.match(conf, /proxy_read_timeout 300s;/);
    assert.match(conf, /try_files \$uri \$uri\/ =404;/);
    assert.match(conf, /X-Content-Type-Options nosniff/);
    assert.ok(conf.includes(`root "${runtime.replace(/\\/g, '/')}/web";`));
    assert.ok(!conf.includes('项目'), 'generated config must not contain the non-ASCII project path');

    const env = JSON.parse(readFileSync(join(runtime, 'conf', 'env.json'), 'utf8'));
    assert.equal(env.httpPort, 18080);
    assert.equal(env.apiPort, 15174);
    assert.equal(env.origin, 'http://127.0.0.1:18080');
    assert.equal(env.appOrigins, 'http://127.0.0.1:18080,http://localhost:18080');
    assert.equal(JSON.parse(readFileSync(marker, 'utf8')).config, env.config);
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});
