import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  outputDir: '.runtime-logs/test-results',
  use: {
    baseURL: 'http://127.0.0.1:5183',
    viewport: { width: 1440, height: 1040 },
    launchOptions: {
      executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(edge) ? edge : undefined),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: [{
    command: 'node scripts/run-local.mjs dev --port 5183 --strictPort',
    url: 'http://127.0.0.1:5183',
    env: { YUQIAO_DISABLE_CLOUD_TTS: process.env.YUQIAO_TEST_CLOUD_TTS==='1'?'0':'1', YUQIAO_SKIP_LLM_START: '1', API_PORT: '5184', APP_ORIGINS: 'http://127.0.0.1:5183', YUQIAO_DATA_DIR: resolve('.runtime-logs/e2e-data') },
    reuseExistingServer: false,
    timeout: 30_000,
  }],
});
