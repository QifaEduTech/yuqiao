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

const candidateJson = {
  status: 'candidate', candidate: '帮助', score: .91, reason: '仅为实验候选',
  duration_seconds: 1.2, decoded_frames: 36, sampled_frames: 18, hand_frames: 18,
  hand_coverage: 1, processing_ms: 900, limitations: ['不是整句翻译。'],
};

async function mockServices(page: Page) {
  await page.route('**/api/sign/status', route => route.fulfill({ json: { available: true } }));
  await page.route('**/api/sign/experiments', route => route.fulfill({ json: candidateJson }));
  await page.route('**/api/tts/status', route => route.fulfill({ json: { available: true, voice: 'Microsoft Huihui Desktop', language: 'zh-CN', engine: 'Windows System.Speech', local: true } }));
}

async function recordSaveAndRecognize(page: Page) {
  
  await page.getByRole('button', { name: '开启摄像头' }).first().click();
  await page.getByRole('button', { name: '开始录制', exact: true }).click();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: '结束录制' }).click();
  await page.getByRole('button', { name: '下一步：确认并保存' }).click();
  await page.getByRole('button', { name: '确认保存录像' }).click();
  await expect(page.getByRole('heading', { name: '这次练习，已经留下来了' })).toBeVisible();
  await page.getByRole('button',{name:'开始识别',exact:true}).click();
}

test('保存后显式开始识别，内部处理保持隐藏', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let speechRequests=0;page.on('request',request=>{if(request.url().includes('/api/tts/'))speechRequests++;});
  await mockServices(page);
  await page.goto('/learning.html');
  await register(page);
  await recordSaveAndRecognize(page);
  // 仅点击用户识别入口；内部解析没有额外处理按钮
  await expect(page.getByTestId('sign-result')).toContainText('识别候选：帮助', { timeout: 30000 });
  await expect(page.getByRole('button', { name: '确认播报文字' })).toHaveCount(0);
  await expect(page.getByLabel('本次播报文字')).toHaveCount(0);
  await expect(page.locator('.sign-speech-review')).toHaveCount(0);
  await expect(page.locator('.compact-result > .result-scope')).toHaveCount(0);
  expect(speechRequests).toBe(0);
  await expect(page.locator('.interaction-panel #video-result')).toHaveCount(1);
  expect(await page.locator('#video-result').evaluate(el=>!!(el.compareDocumentPosition(el.parentElement!.querySelector('.panel-bottom')!)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  // 解析过程对用户不可见
  for (const selector of ['.processing-report', '.frame-grid', '.report-stats', '.metrics-table', '.preview-heading', '.processing-details']) {
    await expect(page.locator(selector)).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: '开始处理视频', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始动作识别实验', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('选择待处理的视频文件')).toHaveCount(0);
  await page.screenshot({ path: '.runtime-logs/pipeline-desktop.png', fullPage: true });
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/pipeline-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});

function wavBase64(){const data=Buffer.alloc(44+32000);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(16000,24);data.writeUInt32LE(32000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(32000,40);return data.toString('base64');}

test('学习重录撤销旧结果，新视频保存前不识别',async({page})=>{
  await mockServices(page);let submitted=0;await page.route('**/api/sign/experiments',route=>{submitted++;return route.fulfill({json:candidateJson});});
  await page.goto('/learning.html');await register(page);await recordSaveAndRecognize(page);await expect(page.getByTestId('sign-result')).toContainText('识别候选：帮助');
  await page.getByRole('button',{name:'重新录制',exact:true}).click();await expect(page.getByTestId('sign-result')).toHaveCount(0);await expect(page.getByRole('region',{name:'词典与动作对照'})).toHaveCount(0);
  await page.getByRole('button',{name:'开始录制',exact:true}).click();await page.waitForTimeout(1100);await page.getByRole('button',{name:'结束录制'}).click();expect(submitted).toBe(1);await expect(page.getByLabel('本次播报文字')).toHaveCount(0);
});

test('录像保存失败不识别，成功重试后仍需显式开始识别',async({page})=>{
  await mockServices(page);let submitted=0;await page.route('**/api/sign/experiments',route=>{submitted++;return route.fulfill({json:candidateJson});});
  let fail=true;await page.route('**/api/records/video**',route=>fail&&route.request().method()==='POST'?route.fulfill({status:503,json:{error:'本次保存失败，请重试'}}):route.continue());
  await page.goto('/learning.html');await register(page);await page.getByRole('button',{name:'开启摄像头'}).first().click();await page.getByRole('button',{name:'开始录制',exact:true}).click();await page.waitForTimeout(1100);await page.getByRole('button',{name:'结束录制'}).click();await page.getByRole('button',{name:'下一步：确认并保存'}).click();await page.getByRole('button',{name:'确认保存录像'}).click();
  await expect(page.getByRole('status')).toContainText('本次保存失败');expect(submitted).toBe(0);await expect(page.getByTestId('sign-result')).toHaveCount(0);fail=false;await page.getByRole('button',{name:'确认保存录像'}).click();await page.getByRole('button',{name:'开始识别',exact:true}).click();await expect(page.locator('.interaction-panel').getByTestId('sign-result')).toContainText('识别候选：帮助');expect(submitted).toBe(1);
});

test('首页历史复核仍可核对播报，修改文字和关闭记录使旧音频失效',async({page})=>{
  await page.addInitScript(()=>{const original=URL.revokeObjectURL;(window as any).__revoked=[];URL.revokeObjectURL=url=>{(window as any).__revoked.push(url);original.call(URL,url);};});
  await mockServices(page);let release:(()=>void)|undefined,calls=0;
  await page.route('**/api/tts/synthesize',async route=>{const body=route.request().postDataJSON();if(++calls===1)await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({json:{audio:wavBase64(),mime:'audio/wav',text:body.text,revision:body.revision,voice:'Microsoft Huihui Desktop',voice_version:'test'}}).catch(()=>{});});
  await page.goto('/learning.html');await register(page);await recordSaveAndRecognize(page);await expect(page.getByTestId('sign-result')).toContainText('识别候选：帮助');await expect(page.getByLabel('本次播报文字')).toHaveCount(0);
  await page.goto('/');await expect(page.locator('.account-name')).toBeVisible();await page.getByRole('button',{name:'我的记录',exact:true}).click();const dialog=page.getByRole('dialog',{name:'我的记录',exact:true});await dialog.locator('.record-item').first().click();await dialog.getByRole('button',{name:'重新识别录像',exact:true}).click();await expect(dialog.getByLabel('本次播报文字')).toHaveValue('帮助');
  await dialog.getByRole('button',{name:'确认播报文字'}).click();await dialog.getByRole('button',{name:'生成语音',exact:true}).click();await expect.poll(()=>!!release).toBe(true);await dialog.getByLabel('本次播报文字').fill('谢谢');release!();await page.waitForTimeout(100);await expect(dialog.locator('.tts-player')).toHaveCount(0);
  await dialog.getByRole('button',{name:'确认播报文字'}).click();await dialog.getByRole('button',{name:'生成语音',exact:true}).click();await expect(dialog.getByLabel('确认文字的语音')).toBeVisible();
  const audio=(await dialog.getByLabel('确认文字的语音').elementHandle())!,url=(await dialog.getByLabel('确认文字的语音').getAttribute('src'))!;await audio.evaluate((el:HTMLAudioElement)=>el.play());await dialog.getByRole('button',{name:'关闭我的记录'}).click();await expect(page.locator('.tts-player')).toHaveCount(0);expect(await audio.evaluate((el:HTMLAudioElement)=>el.paused)).toBe(true);expect(await page.evaluate(url=>(window as any).__revoked.includes(url),url)).toBe(true);
});
