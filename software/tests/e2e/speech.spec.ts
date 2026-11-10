import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('实际中文识别接口工作，错误格式有明确提示', async ({ request }) => {
  const wav = await readFile('models/sensevoice-small-int8/test_wavs/zh.wav');
  const response = await request.post('/api/speech/transcriptions', { headers: { Origin: 'http://127.0.0.1:5183', 'X-Yuqiao-Request': '1', 'Content-Type': 'audio/wav' }, data: wav });
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.status).toBe('transcribed'); expect(result.text).toMatch(/[\u4e00-\u9fff]/); expect(result.requires_confirmation).toBe(true);
  const invalid = await request.post('/api/speech/transcriptions', { headers: { Origin: 'http://127.0.0.1:5183', 'X-Yuqiao-Request': '1', 'Content-Type': 'audio/wav' }, data: Buffer.alloc(100) });
  expect(invalid.status()).toBe(415);
});

test('录音自动转写，修改后重新确认，再转入文字输入', async ({ page }) => {
  // Deterministic UI response; the preceding test checks the real model independently.
  await page.route('**/api/speech/transcriptions', async route => {
    expect(route.request().headers()['content-type']).toBe('audio/wav');
    const bytes = route.request().postDataBuffer()!;
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    await route.fulfill({ json: { status: 'transcribed', text: '你好，请稍等一下。', processing_ms: 100, requires_confirmation: true } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '语音输入', exact: true }).click();
  await page.getByRole('button', { name: '开始录音', exact: true }).click();
  await expect(page.locator('.voice-input > strong')).toContainText(/正在录音 00:0[1-9]/);
  await page.getByRole('button', { name: '结束录音' }).click();
  await expect(page.getByLabel('语音识别文字')).toHaveValue('你好，请稍等一下。');
  await expect(page.getByRole('button', { name: '登录并保存识别文字' })).toHaveCount(0);
  await page.getByRole('button', { name: '确认这段文字' }).click();
  await expect(page.getByRole('button', { name: '登录并保存识别文字' })).toBeVisible();
  await page.getByLabel('语音识别文字').fill('谢谢你的帮助。');
  await expect(page.getByRole('button', { name: '确认这段文字' })).toBeVisible();
  await page.getByRole('button', { name: '确认这段文字' }).click();
  await page.screenshot({ path: '.runtime-logs/speech-review.png', fullPage: true });
  await page.getByRole('button', { name: '转入文字输入' }).click();
  await expect(page.getByLabel('输入要表达的中文')).toHaveValue('谢谢你的帮助。');
});

test('语音处理期间取消，迟到响应不能恢复结果', async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route('**/api/speech/transcriptions', async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { status: 'transcribed', text: '这条旧结果不应显示', requires_confirmation: true } }).catch(() => {});
  });
  await page.goto('/');
  await page.getByRole('button', { name: '语音输入', exact: true }).click();
  await page.getByRole('button', { name: '开始录音', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '结束录音' }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole('button', { name: '取消并清除录音' }).click();
  release!();
  await expect(page.getByLabel('语音识别文字')).toHaveCount(0);
  await expect(page.getByLabel('录音回听')).toHaveCount(0);
});
