#!/usr/bin/env node
/**
 * Generate the Windows Nginx runtime configuration.
 *
 * Modes:
 *   local HTTP   : --runtime ... --port 8080
 *   LAN HTTPS    : --https --lan-ip 192.168.x.x --cert ... --key ...
 *   public tunnel: --domain yuqiao.example.com   (Nginx stays HTTP loopback;
 *                  Cloudflare Tunnel terminates HTTPS)
 *   direct HTTPS : --https --public --domain example.com --http-port 80 --https-port 443
 *
 * Nginx for Windows cannot reliably open files under a non-ASCII project path.
 * The runtime directory is therefore kept under %LOCALAPPDATA%\Yuqiao (ASCII),
 * with `runtime/web` as a junction to the real web/dist.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const argValue = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const flag = name => args.includes(name);
const runtime = resolve(
  argValue('--runtime') ||
  process.env.YUQIAO_NGINX_RUNTIME ||
  join(process.env.LOCALAPPDATA || root, 'Yuqiao', 'nginx-runtime'),
);
const httpPort = Number(argValue('--http-port') || argValue('--port') || process.env.NGINX_HTTP_PORT || 8080);
const httpsPort = Number(argValue('--https-port') || process.env.NGINX_HTTPS_PORT || 8443);
const https = flag('--https');
const publicMode = flag('--public') || flag('--hsts');
const lanIp = argValue('--lan-ip') || '';
const domain = (argValue('--domain') || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const bind = argValue('--bind') || (lanIp || publicMode ? '0.0.0.0' : '127.0.0.1');
const cert = resolve(argValue('--cert') || join(runtime, 'certs', 'yuqiao-server.crt'));
const key = resolve(argValue('--key') || join(runtime, 'certs', 'yuqiao-server.key'));
const caCert = resolve(argValue('--ca') || join(runtime, 'certs', 'yuqiao-ca.crt'));
const apiPort = Number(argValue('--api-port') || process.env.API_PORT || 5174);

if (/[^\x00-\x7f]/.test(runtime)) throw new Error(`Nginx runtime path must be ASCII: ${runtime}`);
if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) throw new Error(`Invalid HTTP port: ${httpPort}`);
if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65535) throw new Error(`Invalid HTTPS port: ${httpsPort}`);
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) throw new Error(`Invalid API port: ${apiPort}`);
if (https && (!existsSync(cert) || !existsSync(key))) throw new Error(`HTTPS certificate/key not found: ${cert} / ${key}`);
if (https && httpPort === httpsPort) throw new Error('HTTP and HTTPS ports must differ.');
if (https && publicMode && httpsPort !== 443 && httpsPort !== 8443) throw new Error('Direct public HTTPS should use 443 (or 8443 behind a router).');

const confDir = join(runtime, 'conf');
const logsDir = join(runtime, 'logs');
const tempDir = join(runtime, 'temp');
const acmeDir = join(runtime, 'acme');
const webRoot = join(runtime, 'web');
for (const dir of [confDir, logsDir, tempDir, acmeDir, join(tempDir, 'client_body'), join(tempDir, 'proxy'), join(tempDir, 'fastcgi'), join(tempDir, 'uwsgi'), join(tempDir, 'scgi')]) {
  mkdirSync(dir, { recursive: true });
}

const slash = value => value.replace(/\\/g, '/');
const quote = value => `"${slash(value).replace(/"/g, '\\"')}"`;
const originSet = new Set([
  `http://127.0.0.1:${httpPort}`,
  `http://localhost:${httpPort}`,
]);
if (lanIp) originSet.add(`http://${lanIp}:${httpPort}`);
if (https) {
  originSet.add(`https://127.0.0.1:${httpsPort}`);
  originSet.add(`https://localhost:${httpsPort}`);
  if (lanIp) originSet.add(`https://${lanIp}:${httpsPort}`);
  originSet.add(`https://yuqiao.local:${httpsPort}`);
}
if (domain) {
  originSet.add(`https://${domain}`);
  if (publicMode) originSet.add(`http://${domain}`);
}
const appOrigins = [...originSet].join(',');
const httpsAuthority = httpsPort === 443 ? 'https://$host' : `https://$host:${httpsPort}`;
const configPath = join(confDir, 'yuqiao.conf');
const envPath = join(confDir, 'env.json');

const proxyHeaders = `            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $yuqiao_forwarded_proto;
            proxy_set_header X-Forwarded-Host $host;
            proxy_connect_timeout 10s;
            proxy_send_timeout 300s;
            proxy_read_timeout 300s;
            proxy_buffering off;`;

const appLocations = `        location /api/ {
            proxy_pass http://127.0.0.1:${apiPort};
            proxy_http_version 1.1;
${proxyHeaders}
        }

        location / {
            try_files $uri $uri/ =404;
            expires -1;
        }

        location ~* \\.(?:js|mjs|css|woff2?|png|jpe?g|webp|svg|glb|gltf|wasm|mp4|webm|wav|mp3)$ {
            expires 7d;
            try_files $uri =404;
        }

`;

const caLocation = existsSync(caCert) ? `
        location = /yuqiao-ca.crt {
            alias ${quote(caCert)};
            default_type application/x-x509-ca-cert;
            add_header Cache-Control "no-store";
        }
` : '';

const rateLimit = (publicMode || domain) ? `
    limit_req_zone $binary_remote_addr zone=yuqiao_api:10m rate=20r/s;
    limit_req_zone $binary_remote_addr zone=yuqiao_auth:10m rate=3r/s;
` : '';

const authLimit = (publicMode || domain) ? `
        location /api/auth/ {
            limit_req zone=yuqiao_auth burst=8 nodelay;
            proxy_pass http://127.0.0.1:${apiPort};
            proxy_http_version 1.1;
${proxyHeaders}
        }
` : '';

const httpServer = https ? `    server {
        listen ${bind}:${httpPort};
        server_name _;
${caLocation}
        location = /api/health {
            proxy_pass http://127.0.0.1:${apiPort};
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Proto http;
            proxy_read_timeout 10s;
        }

        location ^~ /.well-known/acme-challenge/ {
            root ${quote(acmeDir)};
        }

        location / {
            return 301 ${httpsAuthority}$request_uri;
        }
    }` : `    server {
        listen ${bind}:${httpPort};
        server_name _;
        root ${quote(webRoot)};
        index index.html;

        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy strict-origin-when-cross-origin always;
        add_header X-Frame-Options SAMEORIGIN always;
${caLocation}
        location ^~ /data/ { deny all; }
        location ~ /\\.(?!well-known/) { deny all; }
        location ~* \\.(?:env|pem|key|pfx|p12|sqlite|sqlite-.*|db|sql|bak|log)$ { deny all; }
${authLimit}
${appLocations}
    }`;

const httpsServer = https ? `
    server {
        listen ${bind}:${httpsPort} ssl;
        http2 on;
        server_name ${domain || (lanIp ? '_' : 'yuqiao.local')};
        root ${quote(webRoot)};
        index index.html;

        ssl_certificate ${quote(cert)};
        ssl_certificate_key ${quote(key)};
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_session_cache shared:YuqiaoTLS:10m;
        ssl_session_timeout 10m;
        ssl_session_tickets off;

        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy strict-origin-when-cross-origin always;
        add_header X-Frame-Options SAMEORIGIN always;
        ${publicMode ? 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;' : ''}

        location ^~ /data/ { deny all; }
        location ~ /\\.(?!well-known/) { deny all; }
        location ~* \\.(?:env|pem|key|pfx|p12|sqlite|sqlite-.*|db|sql|bak|log)$ { deny all; }
${authLimit}
${appLocations}
    }
` : '';

const config = `# Generated by scripts/prepare-nginx.mjs. Do not edit by hand.
# Mode: ${https ? 'https' : 'http'}${publicMode ? ' public' : ''}${lanIp ? ' lan' : ''}${domain ? ' domain' : ''}
worker_processes 1;
error_log ${quote(join(logsDir, 'error.log'))} warn;
pid ${quote(join(logsDir, 'nginx.pid'))};

events {
    worker_connections 1024;
}

http {
    types {
        text/html html htm;
        text/css css;
        application/javascript js mjs;
        application/json json;
        application/xml xml;
        image/png png;
        image/jpeg jpg jpeg;
        image/webp webp;
        image/svg+xml svg;
        font/woff woff;
        font/woff2 woff2;
        model/gltf-binary glb;
        model/gltf+json gltf;
        application/wasm wasm;
        audio/wav wav;
        audio/mpeg mp3;
        video/mp4 mp4;
        video/webm webm;
        text/plain txt;
        application/x-x509-ca-cert crt;
    }
    default_type application/octet-stream;
    charset utf-8;
    server_tokens off;
    sendfile on;
    tcp_nopush on;
    keepalive_timeout 65;
    client_max_body_size 64m;
    client_body_temp_path ${quote(join(tempDir, 'client_body'))};
    proxy_temp_path ${quote(join(tempDir, 'proxy'))};
    fastcgi_temp_path ${quote(join(tempDir, 'fastcgi'))};
    uwsgi_temp_path ${quote(join(tempDir, 'uwsgi'))};
    scgi_temp_path ${quote(join(tempDir, 'scgi'))};
${rateLimit}
    map $http_x_forwarded_proto $yuqiao_forwarded_proto {
        default $scheme;
        http http;
        https https;
    }

    gzip on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript application/xml image/svg+xml application/wasm;

    access_log ${quote(join(logsDir, 'access.log'))};

${httpServer}
${httpsServer}
}
`;

writeFileSync(configPath, config, 'utf8');
const env = {
  mode: https ? (publicMode ? 'public-https' : 'lan-https') : (domain ? 'public-tunnel' : 'http'),
  httpPort,
  httpsPort: https ? httpsPort : null,
  apiPort,
  lanIp: lanIp || null,
  domain: domain || null,
  bind,
  origin: `http://127.0.0.1:${httpPort}`,
  appOrigins,
  cookieSecure: https || Boolean(domain),
  runtime: slash(runtime),
  webRoot: slash(webRoot),
  config: slash(configPath),
  pid: slash(join(logsDir, 'nginx.pid')),
  errorLog: slash(join(logsDir, 'error.log')),
  caCert: existsSync(caCert) ? slash(caCert) : null,
  cert: https ? slash(cert) : null,
  key: https ? slash(key) : null,
};
writeFileSync(envPath, JSON.stringify(env, null, 2), 'utf8');
const marker = resolve(argValue('--marker') || join(root, '.runtime-logs/nginx-runtime.json'));
mkdirSync(dirname(marker), { recursive: true });
writeFileSync(marker, JSON.stringify(env, null, 2), 'utf8');
if (!existsSync(join(root, 'web', 'dist', 'index.html'))) {
  console.warn('Warning: web/dist/index.html is missing; run npm run build before starting Nginx.');
}
console.log(JSON.stringify({ config: configPath, env: envPath, ...env }, null, 2));
