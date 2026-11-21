import {test,expect} from '@playwright/test';
import {resolveExpression} from '../../shared/sign-expression.mjs';
const nav=(page:any)=>page.getByRole('navigation',{name:'移动端导航'});

test('Windows浏览器显示独立安卓界面，新增说法播放并同步，换页停止且词典不跳到桌面',async({page,context})=>{
 test.setTimeout(90000);await page.setViewportSize({width:1440,height:1040});await page.goto('/android.html');
 await expect(page.getByRole('heading',{name:/把想说的话/})).toBeVisible();await expect(page.locator('.home-page')).toHaveCount(0);await expect(page.locator('iframe')).toHaveCount(0);await expect(nav(page).getByRole('button')).toHaveCount(5);await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:60000});
 expect(await page.locator('.android-browser-preview').evaluate(e=>e.getBoundingClientRect().width)).toBeLessThanOrEqual(480);
 const display=await context.newPage();await display.goto('/avatar');await expect(display.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:60000});await page.bringToFront();
 const text='我想请医生帮忙';await page.getByLabel('输入要表达的中文').fill(text);await page.getByRole('button',{name:'提交文字',exact:true}).click();const id=resolveExpression(text).preview!.id;await expect(page.getByTestId('avatar')).toHaveAttribute('data-motion-id',id);await expect(display.getByTestId('avatar')).toHaveAttribute('data-motion-id',id);await page.screenshot({path:'.runtime-logs/android-browser-windows.png',fullPage:true});
 await nav(page).getByRole('button',{name:'训练',exact:true}).click();await expect(page).toHaveURL(/android.html\?tab=train/);await expect(page.getByRole('button',{name:'开始统一训练',exact:true})).toBeVisible();await expect(display.getByTestId('avatar')).toHaveAttribute('data-motion-id','');await display.close();
 await nav(page).getByRole('button',{name:'我的',exact:true}).click();await page.getByRole('button',{name:/手语词典/}).click();await expect(page).toHaveURL(/android.html\?tab=dictionary/);await expect(page.locator('.mobile-dictionary-list article')).toHaveCount(10);await page.getByRole('searchbox',{name:'搜索词语'}).fill('医生');await expect(page.locator('.mobile-dictionary-list')).toContainText('医生');await page.getByRole('button',{name:'返回我的',exact:true}).click();await expect(page).toHaveURL(/android.html\?tab=me/);
 await page.setViewportSize({width:390,height:844});await nav(page).getByRole('button',{name:'交流',exact:true}).click();await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','true');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/android-browser-mobile.png',fullPage:true});
});

test('安卓训练可录制保存，切换标签释放摄像头；识别不自动开启',async({page})=>{
 await page.setViewportSize({width:1440,height:1040});const r=await page.request.post('/api/training/actions',{headers:{Origin:'http://127.0.0.1:5183','X-Yuqiao-Request':'1'},data:{dictionaryId:'csl.you',description:'一手指向对方',hands:1,motion:'static'}});expect(r.ok()).toBe(true);
 await page.goto('/android.html?tab=train');await page.getByRole('button',{name:'打开任务：你'}).click();await page.getByRole('button',{name:'训练集，点击录制'}).click();await page.getByRole('button',{name:'开始录制',exact:true}).click();await expect(page.getByRole('button',{name:'结束录制',exact:true})).toBeVisible();await page.waitForTimeout(1000);await page.getByRole('button',{name:'结束录制',exact:true}).click();await page.getByRole('button',{name:'确认保存',exact:true}).click();await expect(page.locator('.training-file')).toHaveCount(1);
 await page.getByRole('button',{name:'开始录制',exact:true}).click();await expect(page.getByRole('button',{name:'结束录制',exact:true})).toBeVisible();await page.evaluate(()=>{(window as any).__tracks=(document.querySelector('[aria-label="训练摄像头画面"]') as HTMLVideoElement).srcObject&&(document.querySelector('[aria-label="训练摄像头画面"]') as HTMLVideoElement).srcObject as MediaStream;});
 page.once('dialog',d=>d.dismiss());await nav(page).getByRole('button',{name:'识别',exact:true}).click();await expect(page).toHaveURL(/android.html\?tab=train/);await expect(page.getByRole('button',{name:'结束录制',exact:true})).toBeVisible();
 page.once('dialog',d=>d.accept());await nav(page).getByRole('button',{name:'识别',exact:true}).click();await expect(page.getByRole('button',{name:'开启摄像头'})).toBeVisible();expect(await page.evaluate(()=>(window as any).__tracks.getTracks().every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);await expect(page).toHaveURL(/android.html\?tab=live/);
 await nav(page).getByRole('button',{name:'学习',exact:true}).click();await expect(page.locator('.learning-page')).toBeVisible();await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('安卓语音确认后播放，退出回本入口登录',async({page,baseURL})=>{
 await page.context().clearCookies();
 const session=await page.request.post('/api/auth/register',{headers:{Origin:new URL(baseURL!).origin,'X-Yuqiao-Request':'1'},data:{username:'logout_'+Date.now().toString(36),password:'test-passphrase-2026'}});
 expect(session.status()).toBe(201);
 await page.goto('/android.html');await expect(page.getByTestId('avatar')).toHaveAttribute('data-ready','true',{timeout:60000});await page.route('**/api/speech/transcriptions',r=>r.fulfill({json:{status:'transcribed',text:'请志愿者帮我挂号',requires_confirmation:true,processing_ms:1}}));await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.getByRole('button',{name:'开始录音',exact:true}).click();await expect(page.getByRole('button',{name:'结束录音',exact:true})).toBeVisible();await page.waitForTimeout(1000);await page.getByRole('button',{name:'结束录音',exact:true}).click();await expect(page.getByLabel('语音识别文字')).toHaveValue('请志愿者帮我挂号');await page.getByRole('button',{name:'确认这段文字',exact:true}).click();await expect(page.getByTestId('avatar')).toHaveAttribute('data-motion-id',resolveExpression('请志愿者帮我挂号').preview!.id);
 await nav(page).getByRole('button',{name:'我的',exact:true}).click();await page.getByRole('button',{name:'退出登录',exact:true}).click();await expect(page.getByRole('heading',{name:'安卓端登录'})).toBeVisible();await expect(nav(page)).toHaveCount(0);await expect(page).toHaveURL(/android.html/);await expect(page.getByRole('group',{name:'选择进入的端'})).toHaveCount(0);
});

test('安卓迟到匹配不覆盖新的输入和动作',async({page})=>{
 let release:undefined|(()=>void);await page.route('**/api/sign/resolve',async r=>{if(r.request().postDataJSON().text==='旧请求'){await new Promise<void>(done=>release=done);await r.fulfill({json:resolveExpression('我想挂号')}).catch(()=>{});}else await r.continue();});
 await page.goto('/android.html');await page.getByLabel('输入要表达的中文').fill('旧请求');await page.getByRole('button',{name:'提交文字',exact:true}).click();await expect.poll(()=>!!release).toBe(true);await page.getByLabel('输入要表达的中文').fill('我想请医生帮忙');await page.getByRole('button',{name:'提交文字',exact:true}).click();await expect(page.getByTestId('avatar')).toHaveAttribute('data-motion-id',resolveExpression('我想请医生帮忙').preview!.id);release!();await expect(page.getByLabel('输入要表达的中文')).toHaveValue('我想请医生帮忙');await expect(page.getByTestId('avatar')).toHaveAttribute('data-motion-id',resolveExpression('我想请医生帮忙').preview!.id);
});
