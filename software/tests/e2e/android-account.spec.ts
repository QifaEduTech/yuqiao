import {test,expect,type Page} from '@playwright/test';
const password='test-passphrase-2026';
const avatarPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
async function register(page:Page,name:string){
 await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();const dialog=page.locator('.auth-dialog');await dialog.getByRole('button',{name:'注册',exact:true}).click();await dialog.getByLabel('用户名',{exact:true}).fill(name);await dialog.getByLabel('密码',{exact:true}).fill(password);await dialog.getByLabel('再次输入密码').fill(password);await dialog.getByRole('button',{name:'注册并登录',exact:true}).click();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
}
test('安卓账号与Web共享会话、资料和记录，退出后不残留另一账号记录',async({page,context})=>{
 const name='mobile_'+Date.now().toString(36);await page.setViewportSize({width:390,height:844});await page.goto('/android-offline.html?tab=me');await register(page,name);
 const web=await context.newPage();await web.goto('/');await expect(web.locator('.account-name')).toContainText(name);await web.close();
 const text='mobile shared record '+Date.now();const response=await page.request.post('/api/records/text',{headers:{Origin:'http://127.0.0.1:5183','X-Yuqiao-Request':'1'},data:{text}});expect(response.status()).toBe(201);
 await page.reload();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();await expect(page.getByText('已保存 1 条记录')).toBeVisible();
 await page.getByRole('button',{name:/我的记录/}).click();await expect(page.locator('.record-list')).toContainText(text);await page.getByRole('button',{name:'关闭我的记录'}).click();
 await page.getByRole('button',{name:/账号设置/}).click();const settings=page.getByRole('dialog',{name:'账号设置'});await settings.getByLabel('邮箱地址').fill('mobile@example.com');await settings.getByRole('button',{name:'保存',exact:true}).first().click();await expect(settings.getByRole('status')).toContainText('邮箱已绑定');await settings.getByRole('button',{name:'关闭账号设置'}).click();
 await page.getByRole('button',{name:/账号设置/}).click();await settings.getByLabel('更换头像').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:avatarPng});await expect(page.locator('.mobile-profile img')).toHaveCount(1);await expect(page.locator('.mobile-user-card img')).toHaveCount(1);await settings.getByRole('button',{name:'关闭账号设置'}).click();
 await page.reload();await expect(page.locator('.mobile-profile img')).toHaveCount(1);await expect.poll(()=>page.locator('.mobile-profile img').evaluate((e:HTMLImageElement)=>e.naturalWidth)).toBeGreaterThan(0);
 await page.getByRole('button',{name:/账号设置/}).click();await settings.getByRole('button',{name:'移除头像'}).click();await expect(page.locator('.mobile-profile [data-avatar="default"]')).toHaveCount(1);await expect(page.locator('.mobile-user-card img')).toHaveCount(0);
 await settings.getByLabel('更换头像').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:avatarPng});await expect(page.locator('.mobile-profile img')).toHaveCount(1);await settings.getByRole('button',{name:'关闭账号设置'}).click();
 await page.screenshot({path:'.runtime-logs/android-account-connected.png',fullPage:true});await page.getByRole('button',{name:'退出登录',exact:true}).click();await expect(page.getByRole('button',{name:'登录 / 注册',exact:true})).toBeVisible();await expect(page.locator('.mobile-profile img')).toHaveCount(0);
 await register(page,name+'_b');await page.getByRole('button',{name:/我的记录/}).click();await expect(page.locator('.record-list')).toContainText('还没有保存记录');await expect(page.locator('.record-list')).not.toContainText(text);
 const stored=await page.evaluate(()=>JSON.stringify({...localStorage}));expect(stored).not.toContain(password);expect(stored).not.toContain('yuqiao_session');
});
test('账号服务不可达时明确提示，本地动作仍可播放',async({page})=>{
 await page.route('**/api/auth/me',r=>r.abort());await page.goto('/android-offline.html?tab=me');await expect(page.getByText('账号服务暂不可用')).toBeVisible();await expect(page.getByRole('button',{name:'登录 / 注册',exact:true})).toBeDisabled();
 await page.getByRole('navigation',{name:'移动端导航'}).getByRole('button',{name:'交流',exact:true}).click();await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','true');await page.getByRole('button',{name:'谢谢',exact:true}).click();await expect(page.getByTestId('avatar')).toHaveAttribute('data-motion-id','csl.thanks');
});
test('安装版服务地址拒绝明文远端和URL凭据，账号窗口不获得原生权限',async({page})=>{
 await page.goto('/android-offline.html');const result=await page.evaluate(async()=>{
  const path='/src/nativeAccount.ts';const m=await import(path);let rejected=0;for(const u of ['http://example.com','https://u:p@example.com','javascript:alert(1)','https://example.com/?token=abc'])try{m.accountOrigin(u);}catch{rejected++;}
  let args:any[]=[];let handler:any=null;const view={show(){},close(){},addEventListener(){},overrideUrlLoading(options:any,callback:any){handler={options,callback};}};
  (window as any).plus={webview:{create(...value:any[]){args=value;return view;}}};m.openNativeAccount('https://accounts.example.com',()=>{});
  return {rejected,url:args[0],styles:args[2],match:handler.options.match,stored:localStorage.getItem('yuqiao-account-service')};
 });expect(result.rejected).toBe(4);expect(result.url).toBe('https://accounts.example.com/android-account.html?native=1');expect(result.styles.plusrequire).toBe('none');expect(new RegExp(result.match).test('https://accounts.example.com.evil.test/')).toBe(false);expect(result.stored).toBe('https://accounts.example.com');
});
test('独立账号服务页可打开，使用同一登录组件',async({page})=>{await page.goto('/android-account.html');await expect(page.getByText('账号服务已连接')).toBeVisible();await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();await expect(page.getByRole('dialog',{name:'欢迎回来'})).toBeVisible();});
