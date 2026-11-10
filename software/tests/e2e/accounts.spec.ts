import { test, expect, type Page } from '@playwright/test';

async function register(page: Page) {
  const username = `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  const dialog = page.getByRole('dialog', { name: '欢迎回来' });
  await dialog.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill('test-passphrase-2026');
  await page.getByLabel('再次输入密码', { exact: true }).fill('test-passphrase-2026');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await expect(page.locator('.account-name')).toContainText(username);
  return username;
}

test('注册、文字保存、刷新后查询、注销后登录必须填写验证码', async ({ page }) => {
  await page.goto('/');
  const username = await register(page);
  await page.getByLabel('输入要表达的中文').fill('这是需要保存的文字。');
  await page.getByRole('button', { name: '保存文字到我的记录' }).click();
  await expect(page.getByRole('status')).toContainText('文字已保存');
  await page.reload();
  await expect(page.locator('.account-name')).toContainText(username);
  await page.getByRole('button', { name: '我的记录', exact: true }).click();
  await page.locator('.record-item').filter({ hasText: '这是需要保存的文字。' }).click();
  await expect(page.locator('.saved-text')).toHaveText('这是需要保存的文字。');
  await page.screenshot({ path: '.runtime-logs/history-text.png', fullPage: true });
  await page.getByRole('button', { name: '删除这条记录' }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.record-item')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭我的记录' }).click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('button', { name: '登录 / 注册' })).toBeVisible();
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill('test-passphrase-2026');
  await expect(page.getByRole('img',{name:'登录验证码'})).toBeVisible();
  await expect(page.getByRole('button', { name: '登录账号' })).toBeDisabled();
  await expect(page.getByLabel('验证码',{exact:true})).toHaveValue('');
});

test('录像结束有下一步，备注和真实录像可保存回看及删除', async ({ page }) => {
  await page.goto('/');
  await register(page);
  await page.getByRole('link',{name:'手语学习',exact:true}).click();
  await page.getByRole('button', { name: '开启摄像头' }).first().click();
  await page.getByRole('button', { name: '开始录制' }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: '结束录制' }).click();
  await page.getByRole('button', { name: '下一步：确认并保存' }).click();
  await expect(page.getByRole('heading', { name: '确认保存录像' })).toBeVisible();
  await page.getByLabel('录像备注（可选）').fill('测试录像备注，不是翻译结果');
  await page.screenshot({ path: '.runtime-logs/camera-next-step.png', fullPage: true });
  await page.getByRole('button', { name: '确认保存录像' }).click();
  await expect(page.getByRole('heading', { name: '这次练习，已经留下来了' })).toBeVisible();
  await page.getByRole('button', { name: '查看我的记录', exact: true }).click();
  await page.locator('.record-item').filter({ hasText: '测试录像备注' }).click();
  const video = page.getByLabel('已保存的手语录像');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: '删除这条记录' }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.record-item')).toHaveCount(0);
});
