import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from './app.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createApp({ dataDir: process.env.YUQIAO_DATA_DIR || resolve(root, 'data'), publicDir: resolve(root, 'web/public'), ...(process.env.APP_ORIGINS ? { origins: process.env.APP_ORIGINS.split(',') } : {}) });
const port = Number(process.env.API_PORT || 5174);
server.listen(port, '127.0.0.1', () => console.log(`Yuqiao local API: http://127.0.0.1:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
if (process.send) {
  process.on('message', message => { if (message === 'shutdown') { server.closeAllConnections(); server.close(() => process.exit(0)); } });
  process.on('disconnect', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
}
