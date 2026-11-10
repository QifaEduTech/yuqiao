import { test, expect } from '@playwright/test';

test('视频预处理与解析细节不向用户展示', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link',{name:'手语学习',exact:true}).click();
  // 解析照常执行，但抽帧预览、质量报告、逐帧指标与处理按钮都不渲染
  for (const selector of ['.video-processing', '.processing-report', '.report-stats', '.frame-grid', '.metrics-table', '.processing-progress', '.processing-warning', '.preview-heading', '.processing-heading', '.processing-next']) {
    await expect(page.locator(selector)).toHaveCount(0);
  }
  for (const name of ['开始处理视频', '选择已有视频', '取消处理', '清除处理结果', '重新处理视频']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(page.locator('.video-background')).toHaveCount(1);
  await expect(page.locator('.background-status')).toHaveCount(0);
});

test('解析对空文件、伪装格式、损坏文件和超限文件都给出明确错误', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { preprocessVideo } = await import('/web/src/video/preprocess.ts');
    const run = async (name: string, type: string, bytes: Uint8Array) => {
      try { await preprocessVideo(new File([bytes as BlobPart], name, { type }), new AbortController().signal, () => {}); return '未报错'; }
      catch (error) { return error instanceof Error ? error.message : String(error); }
    };
    return {
      empty: await run('empty.webm', 'video/webm', new Uint8Array(0)),
      wrongContainer: await run('fake.mp4', 'video/mp4', new TextEncoder().encode('not a video')),
      corrupt: await run('broken.webm', 'video/webm', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(100).fill(0)])),
      oversized: await run('large.webm', 'video/webm', new Uint8Array(33 * 1024 * 1024)),
    };
  });
  expect(result.empty).toContain('视频为空');
  expect(result.wrongContainer).toContain('不能只修改文件后缀');
  expect(result.corrupt).toContain('无法解码');
  expect(result.oversized).toContain('32 MB');
});

test('质量指标区分暗、亮与细节，时间采样覆盖首尾且拒绝超时长', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    // Exercise the actual functions with known pixel arrays, independently of camera content.
    const { measureFrame, frameWarnings } = await import('/web/src/video/quality.ts');
    const { frameTimes } = await import('/web/src/video/preprocess.ts');
    const pixels = (v: number) => { const data = new Uint8ClampedArray(16 * 16 * 4); for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; } return data; };
    const black = measureFrame(pixels(0), 16, 16);
    const white = measureFrame(pixels(255), 16, 16, black.gray);
    const pattern = pixels(0);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y) % 2) { const i = (y * 16 + x) * 4; pattern[i] = pattern[i + 1] = pattern[i + 2] = 255; }
    const detailed = measureFrame(pattern, 16, 16);
    let overLimit = false;
    try { frameTimes(31); } catch { overLimit = true; }
    return { black: black.metrics, white: white.metrics, blackWarnings: frameWarnings(black.metrics), whiteWarnings: frameWarnings(white.metrics), detailVariance: detailed.metrics.laplacianVariance, times: frameTimes(1), maxCount: frameTimes(30.25).length, overLimit };
  });
  expect(result.black.brightness).toBe(0);
  expect(result.white.brightness).toBe(255);
  expect(result.white.frameDifference).toBe(255);
  expect(result.black.laplacianVariance).toBe(0);
  expect(result.blackWarnings).toContain('画面偏暗');
  expect(result.whiteWarnings).toContain('画面偏亮');
  expect(result.detailVariance).toBeGreaterThan(50);
  expect(result.times[0]).toBe(0);
  expect(result.times.at(-1)).toBeCloseTo(0.975);
  expect(result.maxCount).toBeLessThanOrEqual(122);
  expect(result.overLimit).toBe(true);
});
