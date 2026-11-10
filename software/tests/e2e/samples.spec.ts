import {test,expect,type Page} from '@playwright/test';
import {registerForVideo,recordVideo,saveRecordedVideo} from './helpers/videoPipeline';

async function start(page:Page){
  await page.route('**/api/sign/status',r=>r.fulfill({json:{available:true}}));
  await page.route('**/api/sign/experiments',r=>r.fulfill({json:{status:'candidate',candidate:'你好'}}));
  await page.goto('/learning.html');await registerForVideo(page);await recordVideo(page);await saveRecordedVideo(page);
  await page.locator('summary').filter({hasText:'试采样本登记'}).click();
  return page.getByRole('region',{name:'试采样本登记表'});
}
test('原录像手工加入试采，回看修改撤回并删除，不改候选不复制视频',async({page})=>{
  const form=await start(page);await expect(form.getByLabel('样本类别')).toHaveValue('');await expect(form.getByRole('button',{name:'加入试采集合'})).toBeDisabled();
  await form.getByLabel('样本类别').selectOption('help');await form.getByLabel('实际内容说明').fill('完整谢谢');
  await form.getByLabel('这段内容完整',{exact:false}).check();await form.getByLabel('我已回看原片',{exact:false}).check();await form.getByRole('button',{name:'加入试采集合'}).click();
  await expect(form.getByRole('status')).toContainText('已保存人工登记');await expect(page.getByTestId('sign-result')).toHaveCount(0);await page.getByRole('button',{name:'开始识别',exact:true}).click();await expect(page.getByTestId('sign-result')).toContainText('你好');
  const records=(await(await page.request.get('/api/records')).json()).records;expect(records).toHaveLength(1);const id=records[0].id;
  const saved=await(await page.request.get(`/api/records/${id}/sample`)).json();expect(saved.sample.category).toBe('help');expect(saved.sample.trainingReady).toBe(false);expect(saved.sample.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(saved.sample.sampleNumber).toBe('30.1');expect(saved.sample.batch).toMatch(/^auto-date-/);await expect(form.getByTestId('sample-number')).toHaveValue('30.1');
  await page.screenshot({path:'.runtime-logs/sample-registration-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/sample-registration-mobile.png',fullPage:true});
  await page.reload();await expect(page.locator('.account-name')).toBeVisible();await page.getByRole('button',{name:'我的记录',exact:true}).click();const dialog=page.getByRole('dialog',{name:'我的记录',exact:true});await dialog.locator('.record-item').first().click();await dialog.locator('summary').filter({hasText:'试采样本登记'}).click();const history=dialog.getByRole('region',{name:'试采样本登记表'});
  await expect(history.getByLabel('实际内容说明')).toHaveValue('完整谢谢');await history.getByLabel('样本类别').selectOption('uncertain');await history.getByLabel('我已回看原片',{exact:false}).check();await history.getByRole('button',{name:'保存登记修改'}).click();await expect(history).toContainText('不确定 · 排除训练');
  await expect(history.getByTestId('sample-number')).toHaveValue('29.1');
  await history.getByRole('button',{name:'撤回试采登记'}).click();await expect(history.getByRole('status')).toContainText('原录像仍保留');expect((await page.request.get(`/api/records/${id}/media`)).ok()).toBe(true);
  await dialog.getByRole('button',{name:'删除这条记录'}).click();await expect(dialog).toContainText('试采登记');
  const deletion=page.waitForResponse(r=>r.url().endsWith(`/api/records/${id}`)&&r.request().method()==='DELETE');
  await dialog.getByRole('button',{name:'确认删除',exact:true}).click();expect((await deletion).ok()).toBe(true);
  expect((await page.request.get(`/api/records/${id}/sample`)).status()).toBe(404);
});

test('新录像无需填写批次，选择帮助自动填名，成功登记后下一条自动接号',async({page})=>{
  let form=await start(page);await form.getByLabel('样本类别').selectOption('help');await expect(form.getByLabel('实际内容说明')).toHaveValue('帮助');await expect(form.getByTestId('sample-number')).toHaveValue('预计 30.1，保存后确定');
  await form.getByLabel('这段内容完整',{exact:false}).check();await form.getByLabel('我已回看原片',{exact:false}).check();await form.getByRole('button',{name:'加入试采集合'}).click();await expect(form.getByRole('status')).toContainText('样本编号 30.1');
  await page.getByRole('button',{name:'清空本次练习'}).click();await recordVideo(page);await saveRecordedVideo(page);await page.locator('summary').filter({hasText:'试采样本登记'}).click();form=page.getByRole('region',{name:'试采样本登记表'});
  await form.getByLabel('样本类别').selectOption('background');await expect(form.getByTestId('sample-number')).toHaveValue('预计 27.1，保存后确定');
  await form.getByLabel('样本类别').selectOption('help');await expect(form.getByTestId('sample-number')).toHaveValue('预计 30.2，保存后确定');await form.getByLabel('这段内容完整',{exact:false}).check();await form.getByLabel('我已回看原片',{exact:false}).check();await form.getByRole('button',{name:'加入试采集合'}).click();await expect(form.getByTestId('sample-number')).toHaveValue('30.2');
});

test('冲突保留草稿，重载可继续，清空后迟到保存不会恢复表单',async({page})=>{
  const form=await start(page);const id=(await(await page.request.get('/api/records')).json()).records[0].id;
  await form.getByLabel('样本类别').selectOption('background');await form.getByLabel('实际内容说明').fill('空手入镜');await form.getByLabel('我已回看原片',{exact:false}).check();
  const other={revision:0,category:'uncertain',detail:'另一个窗口',batch:'batch-a',performer:'本人',complete:false,startSeconds:0,endSeconds:0.5,reviewed:true};
  expect((await page.request.put(`/api/records/${id}/sample`,{headers:{Origin:new URL(page.url()).origin,'X-Yuqiao-Request':'1'},data:other})).ok()).toBe(true);
  await form.getByRole('button',{name:'加入试采集合'}).click();await expect(form.getByRole('alert')).toContainText('其他位置');await expect(form.getByLabel('实际内容说明')).toHaveValue('空手入镜');await expect(form.getByRole('button',{name:'加入试采集合'})).toBeDisabled();
  await form.getByRole('button',{name:'重新载入登记（覆盖草稿）'}).click();await expect(form.getByLabel('实际内容说明')).toHaveValue('另一个窗口');
  let release!:()=>void,entered=false;await page.route('**/api/records/*/sample',async r=>{if(r.request().method()!=='PUT')return r.continue();entered=true;await new Promise<void>(resolve=>{release=resolve;});await r.fulfill({json:{revision:2,duration:2,sample:null}}).catch(()=>{});});
  await form.getByLabel('我已回看原片',{exact:false}).check();await form.getByRole('button',{name:'保存登记修改'}).click();await expect.poll(()=>entered).toBe(true);await page.getByRole('button',{name:'清空本次练习'}).click();release();await page.waitForTimeout(150);await expect(form).toHaveCount(0);
});

test('保存超时保留草稿且不报成功，必须重载核对结果',async({page})=>{
  const form=await start(page);await page.clock.install();let release!:()=>void,entered=false;
  await page.route('**/api/records/*/sample',async r=>{if(r.request().method()!=='PUT')return r.continue();entered=true;await new Promise<void>(resolve=>{release=resolve;});await r.fulfill({json:{revision:1,duration:1,sample:null}}).catch(()=>{});});
  await form.getByLabel('样本类别').selectOption('background');await form.getByLabel('实际内容说明').fill('保持空手');await form.getByLabel('我已回看原片',{exact:false}).check();await form.getByRole('button',{name:'加入试采集合'}).click();await expect.poll(()=>entered).toBe(true);await page.clock.fastForward(31000);
  await expect(form.getByRole('alert')).toContainText('状态尚未确认');await expect(form.getByLabel('实际内容说明')).toHaveValue('保持空手');await expect(form.getByRole('button',{name:'加入试采集合'})).toBeDisabled();await expect(form.getByRole('status')).toHaveCount(0);release();
  await form.getByRole('button',{name:'重新载入登记（覆盖草稿）'}).click();await expect(form.getByLabel('样本类别')).toBeEnabled();await expect(form.getByLabel('样本类别')).toHaveValue('');
});
