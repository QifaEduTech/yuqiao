import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
const localPath=(relative:string)=>decodeURIComponent(new URL(relative,import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:\/)/,'').replace(/\/$/,'');
const projectRoot=localPath('./');
const frontendRoot=localPath('./web/');

export default defineConfig(({ mode }) => {
  const android = mode === 'android';
  const apiTarget = loadEnv(mode, '.', 'VITE_').VITE_API_TARGET || 'http://127.0.0.1:5174';
  const apiProxy: ProxyOptions = {
    target: apiTarget, changeOrigin: false,
    configure(proxy) {
      proxy.on('proxyReq', (proxyRequest, _request, response) => {
        response.on('close', () => { if (!response.writableEnded) proxyRequest.destroy(); });
      });
    },
  };
  return {
  base: android ? './' : '/',
  root: frontendRoot,
  publicDir: android ? false : localPath('./web/public/'),
  resolve: { alias: [
    {find:/^\/web\/src(?=\/)/,replacement:localPath('./web/src/')},
    {find:/^\/shared(?=\/)/,replacement:localPath('./shared/')},
    {find:/^\/node_modules(?=\/)/,replacement:localPath('./node_modules/')},
  ] },
  plugins: [react()],
  server: {
    watch: { ignored: ['**/local-vision/**', '**/android-app/app/**', '**/android-app/inference/**', '**/.runtime-logs/**', '**/docs/**', '**/data/**', '**/.venv*/**', '**/models/**', '**/unreal/**', '**/server/**', '**/scripts/**', '**/tests/**', '**/*.md'] },
    fs: { allow:[projectRoot],deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', '**/.runtime-logs/**', '**/.venv*/**', '**/models/**'] },
    proxy: { '/api': apiProxy },
  },
  preview: { proxy: { '/api': apiProxy } },
  build: {
    ...(android ? {outDir:localPath('./web/android-app/app/'),emptyOutDir:true} : {}),
    rollupOptions: {
      input: android ? {app:frontendRoot+'/android-offline.html'} : Object.fromEntries(Object.entries({main:'index.html',mobile:'android.html',account:'android-account.html',offline:'android-offline.html',learning:'learning.html',training:'training.html',realtime:'realtime.html',review:'model-review.html',anny:'anny-review.html',dictionary:'sign-dictionary.html',continuous:'continuous-review.html'}).map(([name,file])=>[name,frontendRoot+'/'+file])),
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
  };
});
