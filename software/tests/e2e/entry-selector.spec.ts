import {test,expect} from '@playwright/test';
test.use({storageState:{cookies:[],origins:[]}});

test('登录页先选择三个端，登录后进入所选端',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#auth-title')).toBeVisible({timeout:20000});
  const group=page.getByRole('group',{name:'选择进入的端'});
  await expect(group.getByRole('button')).toHaveCount(3);
  await expect(group.getByRole('button',{name:/^正常端/})).toHaveAttribute('aria-pressed','true');
  await group.getByRole('button',{name:/^数字人端/}).click();
  await expect(group.getByRole('button',{name:/^数字人端/})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'注册',exact:true}).click();
  await page.getByLabel('用户名',{exact:true}).fill(`entry_${Date.now().toString(36)}`);
  await page.getByLabel('密码',{exact:true}).fill('entry-selector-pass-2026');
  await page.getByLabel('再次输入密码',{exact:true}).fill('entry-selector-pass-2026');
  await page.getByRole('button',{name:'注册并登录'}).click();
  await page.waitForURL(/\/avatar$/,{timeout:20000});
  await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:60000});
  await expect(page.locator('.home-motion-controls')).toHaveCount(0);
});
