import {test,expect} from '@playwright/test';

test('主页面使用 Anny，摄像头切换后可重新加载，窄屏仍可见',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  const avatarStatus=await (await page.request.get('/api/avatar')).json();
  expect(avatarStatus.available).toBe(true);expect(avatarStatus.url).toBe('/avatar-candidates/anny-makehuman.glb');expect(avatarStatus.signMotionAvailable).toBe(false);
  await expect(page.getByTestId('avatar')).toHaveAttribute('data-model','anny-makehuman');
  await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:30000});
  await expect(page.locator('.stage-badge')).toContainText('Anny');
  await page.getByRole('button',{name:'恢复正面视角'}).click();
  await page.screenshot({path:'.runtime-logs/anny-home-desktop.png',fullPage:true});
  await page.getByRole('tab',{name:'手语 文字',exact:true}).click();
  await expect(page.getByTestId('avatar')).toHaveCount(0);
  await page.getByRole('tab',{name:'文字 / 语音 手语',exact:true}).click();
  await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:30000});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByTestId('avatar').locator('canvas')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.runtime-logs/anny-home-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('旧 VRM 入口已停用且不再提供两个模型，固定动作仍不依赖账号',async({page})=>{
  await page.goto('/model-review.html');
  await expect(page.getByRole('heading',{name:'已选用 Anny'})).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  for(const name of ['Base_Female.vrm','AvatarSample_E.vrm']){
    const response=await page.request.get(`/avatar-candidates/${name}`);
    expect((await response.body()).subarray(0,4).toString()).not.toBe('glTF');
  }
  const requests:string[]=[];
  await page.route('**/api/**',route=>{requests.push(route.request().url());return route.abort();});
  await page.getByRole('link',{name:'打开 Anny 动作预览'}).click();
  await expect(page.getByTestId('motion-play')).toBeEnabled({timeout:30000});
  await page.getByTestId('motion-play').click();
  await expect(page.getByRole('button',{name:'暂停动作',exact:true})).toBeEnabled();
  expect(requests).toEqual([]);
});

test('Anny 资源加载失败有明确提示，文字功能仍可操作',async({page})=>{
  await page.route('**/avatar-candidates/anny-makehuman.glb*',route=>route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('暂时无法显示数字人');
  await page.getByLabel('输入要表达的中文').fill('谢谢');
  await page.getByRole('button',{name:'提交文字',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已匹配“谢谢”');
});
