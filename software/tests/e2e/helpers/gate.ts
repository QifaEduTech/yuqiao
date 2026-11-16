import {expect,type Page} from '@playwright/test';

/**
 * 页面现在先登录。需要新账号的用例只清除浏览器 Cookie、保留共享测试会话，
 * 再在当前页面的门禁上注册；不要点“退出登录”，那会注销其他用例共用的账号。
 */
export async function registerAtGate(page:Page,password='test-passphrase-2026'){
  await page.context().clearCookies();
  if(page.url()==='about:blank')await page.goto('/');
  else await page.reload();
  await expect(page.locator('#auth-title')).toBeVisible({timeout:20000});
  const username=`user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
  await page.getByRole('button',{name:'注册',exact:true}).click();
  await page.getByLabel('用户名',{exact:true}).fill(username);
  await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByLabel('再次输入密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'注册并登录'}).click();
  await expect(page.locator('.account-name')).toContainText(username,{timeout:15000});
  return username;
}
