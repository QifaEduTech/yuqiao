import { test, expect } from '@playwright/test';

test('首页、3D 和文字输入明确保留未接入能力边界', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '让交流，自然发生。' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Anny 数字人，双臂自然下垂，双手与腿留有间距' })).toBeVisible();
  await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:30000});
  await expect(page.getByRole('button', { name: '提交文字' })).toBeDisabled();
  await page.getByLabel('输入要表达的中文').fill('请稍等一下。');
  await page.getByRole('button', { name: '提交文字' }).click();
  await expect(page.getByRole('status')).toContainText('标准手语动作尚未接入');
  await expect(page.locator('.conversation-strip')).toContainText('请稍等一下。');
  await page.screenshot({ path: '.runtime-logs/home-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '清空本次交流' }).click();
  await expect(page.getByLabel('输入要表达的中文')).toHaveValue('');
  await expect(page.locator('.conversation-strip')).not.toContainText('请稍等一下。');
  expect(errors).toEqual([]);
});

test('摄像头真实录制、回看并释放媒体轨道', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as any).__testStreams = [];
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints);
      (window as any).__testStreams.push(stream);
      return stream;
    };
  });
  await page.goto('/');
  expect(await page.evaluate(() => (window as any).__testStreams.length)).toBe(0);
  await page.getByRole('link',{name:'手语学习',exact:true}).click();
  await page.getByRole('button', { name: '开启摄像头' }).first().click();
  await expect(page.getByLabel('摄像头实时预览')).toBeVisible();
  await page.getByRole('button', { name: '开始录制' }).click();
  await expect(page.locator('.stage-badge')).toContainText('录制中');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: '结束录制' }).click();
  await expect(page.getByLabel('本段手语录像预览')).toBeVisible();
  await expect(page.getByRole('region',{name:'学习识别结果'})).toContainText('不是实时或连续手语翻译');
  expect(await page.evaluate(() => (window as any).__testStreams.every((stream: MediaStream) => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await page.getByRole('button', { name: '关闭并清除' }).click();
  await expect(page.getByLabel('本段手语录像预览')).toHaveCount(0);
});

test('录音回听、模式切换清理与设备权限失败提示', async ({ page }) => {
  await page.route('**/api/speech/transcriptions', route => route.fulfill({ json: { status: 'no_speech', text: '' } }));
  await page.goto('/');
  await page.getByRole('button', { name: '语音输入', exact: true }).click();
  await page.getByRole('button', { name: '开始录音', exact: true }).click();
  await expect(page.getByRole('button', { name: '结束录音' })).toBeVisible();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '结束录音' }).click();
  await expect(page.getByLabel('录音回听')).toBeVisible();
  await page.getByRole('link',{name:'手语学习',exact:true}).click();
  await expect(page.locator('audio')).toHaveCount(0);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await page.getByRole('button', { name: '开启摄像头' }).first().click();
  await expect(page.getByRole('status')).toContainText('设备访问未获允许');
});

test('取消授权等待后到达的流被关闭，不恢复预览', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints);
      (window as any).__delayedStream = stream;
      await new Promise(resolve => { (window as any).__resolveMedia = resolve; });
      return stream;
    };
  });
  await page.goto('/');
  await page.getByRole('link',{name:'手语学习',exact:true}).click();
  await page.getByRole('button', { name: '开启摄像头' }).first().click();
  await page.waitForFunction(() => Boolean((window as any).__resolveMedia));
  await page.getByRole('button', { name: '关闭并清除' }).click();
  await page.evaluate(() => (window as any).__resolveMedia());
  await expect.poll(() => page.evaluate(() => (window as any).__delayedStream.getTracks().every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  await expect(page.getByLabel('摄像头实时预览')).toHaveCount(0);
});

test('窄屏可用，说明弹窗可以键盘关闭', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '使用说明' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.screenshot({ path: '.runtime-logs/home-mobile.png', fullPage: true });
});
