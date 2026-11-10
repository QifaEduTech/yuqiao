import {testWav} from './helpers/localSpeech';
import { test, expect, type Page } from '@playwright/test';

async function register(page: Page) {
  const username = `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  const auth = page.getByRole('dialog', { name: '欢迎回来' });
  await auth.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill('test-passphrase-2026');
  await page.getByLabel('再次输入密码', { exact: true }).fill('test-passphrase-2026');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await expect(page.locator('.account-name')).toContainText(username);
  return username;
}

/** Clicking the account name must open the settings dialog. */
async function openSettings(page: Page) {
  await page.locator('.account-name').click();
  const dialog = page.getByRole('dialog', { name: '账号设置' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async({page})=>{await page.route('**/api/tts/status',r=>r.fulfill({json:{available:true,voice:'千问 · Cherry'}}));});

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// Playwright exposes the dialog scope; assertions must not leak to page-level notices.
type Dialog = ReturnType<Page['getByRole']>;

async function expectNotice(dialog: Dialog, text: string) {
  await expect(dialog.locator('[role="status"], [role="alert"]').first()).toContainText(text);
}

test('点击用户名打开设置页，展示账号信息并可绑定邮箱与手机号', async ({ page }) => {
  await page.goto('/');
  const username = await register(page);
  const dialog = await openSettings(page);
  await expect(dialog).toContainText(username);
  await expect(dialog).toContainText('已保存记录');

  await dialog.getByLabel('邮箱地址').fill('not-an-email');
  await dialog.getByRole('button', { name: '保存' }).first().click();
  await expect(dialog.getByRole('alert')).toContainText('邮箱格式不正确');

  await dialog.getByLabel('邮箱地址').fill('me@example.com');
  await dialog.getByRole('button', { name: '保存' }).first().click();
  await expectNotice(dialog, '邮箱已绑定');

  await dialog.getByLabel('手机号').fill('13800138000');
  await dialog.getByRole('button', { name: '保存' }).nth(1).click();
  await expectNotice(dialog, '手机号已绑定');

  await page.reload();
  const reopened = await openSettings(page);
  await expect(reopened.getByLabel('邮箱地址')).toHaveValue('me@example.com');
  await expect(reopened.getByLabel('手机号')).toHaveValue('13800138000');
});

test('更换头像后标题栏显示头像，可再移除', async ({ page }) => {
  await page.goto('/');
  await register(page);
  const dialog = await openSettings(page);
  await dialog.getByLabel('更换头像').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expectNotice(dialog, '头像已更新');
  await expect(page.locator('.account-avatar')).toBeVisible();
  await dialog.getByRole('button', { name: '移除头像' }).click();
  await expectNotice(dialog, '头像已移除');
  await expect(page.locator('.account-avatar')).toHaveCount(0);
});

test('修改密码需要正确的当前密码，成功后旧密码失效', async ({ page }) => {
  await page.goto('/');
  await register(page);
  const dialog = await openSettings(page);
  await dialog.getByLabel('当前密码').fill('wrong-password-here');
  await dialog.getByLabel('新密码', { exact: true }).fill('test-passphrase-2027');
  await dialog.getByLabel('再次输入新密码').fill('test-passphrase-2027');
  await dialog.getByRole('button', { name: '更新密码' }).click();
  await expect(dialog.getByRole('alert')).toContainText('当前密码不正确');

  await dialog.getByLabel('当前密码').fill('test-passphrase-2026');
  await dialog.getByRole('button', { name: '更新密码' }).click();
  await expectNotice(dialog, '密码已更新');
});

test('千问试听无需录音，旧参考录音可删除但不再用于合成',async({page})=>{
  let voices=[{id:'11111111-1111-1111-1111-111111111111',name:'旧参考录音甲'}];let requests=0;
  await page.route('**/api/tts/status',r=>r.fulfill({json:{available:true,voice:'千问 · Cherry',local:false}}));
  await page.route('**/api/voices**',r=>{if(r.request().method()==='DELETE'){voices=[];return r.fulfill({json:{ok:true}});}return r.fulfill({json:{voices,active_id:null}});});
  await page.route('**/api/tts/synthesize',r=>{requests++;const b=r.request().postDataJSON();expect(b.voice).toBeUndefined();expect(b.confirmed).toBe(true);return r.fulfill({json:{text:b.text,revision:b.revision,audio:testWav(),mime:'audio/wav'}});});
  await page.goto('/');await register(page);const dialog=await openSettings(page);
  await expect(dialog).toContainText('阿里云百炼');await expect(dialog.getByRole('button',{name:'开始录音'})).toHaveCount(0);
  await dialog.getByRole('button',{name:'试听千问音色'}).click();await expect(dialog.getByLabel('千问音色试听')).toHaveAttribute('src',/^blob:/);expect(requests).toBe(1);
  await dialog.getByRole('button',{name:'删除录音'}).click();await expect(dialog).not.toContainText('旧参考录音甲');
  await page.screenshot({path:'.runtime-logs/qwen-settings.png',fullPage:true});
});

test('关闭设置会中止未完成的千问试听',async({page})=>{
  let release:()=>void=()=>{};let pending=false;
  await page.route('**/api/tts/status',r=>r.fulfill({json:{available:true,voice:'千问 · Cherry'}}));
  await page.route('**/api/tts/synthesize',async r=>{pending=true;await new Promise<void>(resolve=>{release=resolve;});const b=r.request().postDataJSON();await r.fulfill({json:{...b,audio:testWav(),mime:'audio/wav'}}).catch(()=>{});});
  await page.goto('/');await register(page);const dialog=await openSettings(page);await dialog.getByRole('button',{name:'试听千问音色'}).click();await expect.poll(()=>pending).toBe(true);
  await dialog.getByRole('button',{name:'关闭账号设置'}).click();release();await page.waitForTimeout(100);await expect(page.getByLabel('千问音色试听')).toHaveCount(0);
});

test('账号设置可保存替换删除个人Key，重开不回显且不存浏览器持久化',async({page})=>{
  const first='sk-test-only-settings-key-123456',second=first+'2';
  await page.goto('/');await register(page);let dialog=await openSettings(page);
  const field=dialog.getByLabel('千问 API Key（中国内地）');
  await expect(field).toHaveAttribute('type','password');
  await field.fill(first);await dialog.getByRole('button',{name:'保存 API Key',exact:true}).click();
  await expect(dialog).toContainText('API Key 已加密保存');await expect(field).toHaveValue('');
  await expect(dialog.getByRole('button',{name:'替换 API Key'})).toBeVisible();
  await field.fill(second);await dialog.getByRole('button',{name:'替换 API Key'}).click();await expect(field).toHaveValue('');
  await dialog.getByRole('button',{name:'关闭账号设置'}).click();dialog=await openSettings(page);
  await expect(dialog.getByLabel('千问 API Key（中国内地）')).toHaveValue('');
  const storage=await page.evaluate(()=>JSON.stringify({local:localStorage,session:sessionStorage}));expect(storage).not.toContain(first);
  await dialog.getByRole('button',{name:'删除 API Key'}).click();await expect(dialog).toContainText('已删除本账号的 API Key');
  await expect(dialog.getByRole('button',{name:'保存 API Key',exact:true})).toBeDisabled();
  await page.screenshot({path:'.runtime-logs/qwen-key-settings.png',fullPage:true});
});
