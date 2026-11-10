import {test,expect} from '@playwright/test';
test('真实验证码图片能显示和刷新，手机布局不溢出',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();
 const img=page.getByRole('img',{name:'登录验证码'});await expect(img).toBeVisible();await expect.poll(()=>img.evaluate((i:HTMLImageElement)=>i.naturalWidth)).toBe(180);
 const old=await img.getAttribute('src');await page.getByRole('button',{name:'换一张',exact:true}).click();await expect(img).not.toHaveAttribute('src',old!);
 await expect(page.getByText('5位数字和英文字母，不区分大小写，5分钟有效。')).toBeVisible();
 const box=await page.getByRole('dialog',{name:'欢迎回来'}).boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(390);
 await page.screenshot({path:'.runtime-logs/login-captcha-mobile.png',fullPage:true});
});
test('前端提交验证码，失败刷新清空，大小写原样提交供后端核对',async({page})=>{
 let generation=0,logins=0;
 await page.route('**/api/auth/captcha',async r=>{generation++;await r.fulfill({json:{id:'challenge-'+generation,image:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',expiresAt:Date.now()+300000}});});
 await page.route('**/api/auth/login',async r=>{const b=r.request().postDataJSON();logins++;expect(b.captchaId).toBe('challenge-'+generation);expect(b.captchaCode).toBe(logins===1?'zz999':'aB3dE');await r.fulfill(logins===1?{status:400,json:{error:'验证码错误或已失效，请输入新验证码。'}}:{json:{user:{id:'test-user',username:'captcha_user'}}});});
 await page.goto('/');await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();
 await page.getByLabel('用户名',{exact:true}).fill('captcha_user');await page.getByLabel('密码',{exact:true}).fill('test-password-2026');
 await page.getByLabel('验证码',{exact:true}).fill('zz999');await page.getByRole('button',{name:'登录账号',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('验证码错误或已失效');await expect(page.getByLabel('验证码',{exact:true})).toHaveValue('');await expect.poll(()=>generation).toBe(2);
 await page.getByLabel('验证码',{exact:true}).fill('aB3dE');await page.getByRole('button',{name:'登录账号',exact:true}).click();await expect(page.locator('.account-name')).toContainText('captcha_user');
});
