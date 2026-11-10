import {test,expect,type Page} from '@playwright/test';
import {registerForVideo,recordVideo,saveAndRecognizeVideo} from './helpers/videoPipeline';
import type {PracticeAttempt} from '../../web/src/api';

async function candidateServices(page:Page){
  await page.route('**/api/sign/status',r=>r.fulfill({json:{available:true}}));
  let attempt:PracticeAttempt,failed=false,readFailure=false;let delayed:Promise<void>|null=null;
  await page.route('**/api/sign/experiments',r=>{
    const id=r.request().headers()['x-yuqiao-record-id'];expect(id).toBeTruthy();
    attempt={id:'11111111-1111-4111-8111-111111111111',recordId:id,status:'candidate',candidate:'你好',candidateId:'csl.hello',snapshot:{modelId:'test-model',modelVersion:'test-v1',modelSha256:'test-hash',featureId:'test-feature',dictionaryVersion:'2026-10-16',dictionaryHash:'dictionary-hash',motionVersion:'user-description-1'},feedback:null,correction:'',revision:0,createdAt:Date.now(),updatedAt:Date.now()};
    return r.fulfill({json:{status:'candidate',candidate:'你好',attempt}});
  });
  await page.route('**/api/records/*/practice**',async r=>{
    const url=r.request().url();
    if(r.request().method()==='GET'){if(readFailure){readFailure=false;return r.fulfill({status:503,json:{error:'读取练习记录失败，请重试'}});}return r.fulfill({json:url.endsWith('/practice')?{attempts:[attempt],total:1}:{attempt}});}
    const body=r.request().postDataJSON();
    if(delayed)await delayed;
    if(failed){failed=false;return r.fulfill({status:503,json:{error:'本次反馈保存失败'}});}
    if(body.revision!==attempt.revision)return r.fulfill({status:409,json:{error:'这条反馈已在其他位置更新，请重新载入后再修改。'}}).catch(()=>{});
    attempt={...attempt,feedback:body.feedback,correction:body.correction,revision:attempt.revision+1,updatedAt:Date.now()};return r.fulfill({json:{attempt}}).catch(()=>{});
  });
  return {latest:()=>attempt,failReadNext:()=>{readFailure=true;},failNext:()=>{failed=true;},conflict:()=>{attempt={...attempt,feedback:'uncertain',revision:attempt.revision+1};},delay:(p:Promise<void>)=>{delayed=p;}};
}
const feedback=(page:Page)=>page.getByRole('region',{name:'本次练习反馈',exact:true});
async function start(page:Page){await page.goto('/learning.html');await registerForVideo(page);await recordVideo(page);await saveAndRecognizeVideo(page);await expect(feedback(page)).toBeVisible();}

test('一致／不一致反馈独立保存，历史可回看修改撤回，刷新后可见且学习不播报',async({page})=>{
  await candidateServices(page);await start(page);await feedback(page).getByRole('button',{name:'与我的意思一致',exact:true}).click();await feedback(page).getByRole('button',{name:'保存反馈',exact:true}).click();await expect(feedback(page).getByRole('status')).toContainText('反馈已保存');
  await feedback(page).getByRole('button',{name:'不一致',exact:true}).click();await expect(feedback(page).getByRole('button',{name:'保存反馈',exact:true})).toBeDisabled();await page.getByLabel('你原本想表达的词').fill('谢谢');await feedback(page).getByRole('button',{name:'保存反馈',exact:true}).click();await expect(feedback(page)).toContainText('原识别：你好');await expect(page.getByTestId('sign-result')).toContainText('识别候选：你好');await expect(page.getByLabel('本次播报文字')).toHaveCount(0);
  await page.reload();await expect(page.locator('.account-name')).toBeVisible();await page.getByRole('button',{name:'我的记录',exact:true}).click();const dialog=page.getByRole('dialog',{name:'我的记录',exact:true});await dialog.locator('.record-item').first().click();const history=dialog.getByRole('region',{name:'已保存的练习反馈'});
  await expect(history).toContainText('原识别：你好');await expect(history).toContainText('原本想表达：谢谢');await history.getByRole('button',{name:'修改这次反馈'}).click();await feedback(page).getByRole('button',{name:'撤回反馈'}).click();await expect(history).toContainText('尚未反馈');await expect(history).not.toContainText('原本想表达：谢谢');
  await page.screenshot({path:'.runtime-logs/practice-history-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});

test('保存失败保留填写内容，并发反馈必须重载，清空后迟到保存不恢复界面',async({page})=>{
  const mock=await candidateServices(page);await start(page);await feedback(page).getByRole('button',{name:'不一致',exact:true}).click();await page.getByLabel('你原本想表达的词').fill('谢谢');mock.failNext();await feedback(page).getByRole('button',{name:'保存反馈',exact:true}).click();await expect(feedback(page).getByRole('alert')).toContainText('保存失败');await expect(page.getByLabel('你原本想表达的词')).toHaveValue('谢谢');
  mock.conflict();await feedback(page).getByRole('button',{name:'保存反馈',exact:true}).click();await expect(feedback(page).getByRole('alert')).toContainText('其他位置');await feedback(page).getByRole('button',{name:'重新载入反馈'}).click();await expect(feedback(page).getByRole('button',{name:'不确定',exact:true})).toHaveAttribute('aria-pressed','true');
  let release!:()=>void;mock.delay(new Promise<void>(r=>{release=r;}));await feedback(page).getByRole('button',{name:'与我的意思一致',exact:true}).click();await feedback(page).getByRole('button',{name:'保存反馈',exact:true}).click();await page.getByRole('button',{name:'清空本次练习'}).click();release();await page.waitForTimeout(150);await expect(feedback(page)).toHaveCount(0);await expect(page.getByTestId('sign-result')).toHaveCount(0);
});

test('真实无手录像可保存不确定反馈，重新打开记录保留，删除源视频清理反馈',async({page,request})=>{
  test.setTimeout(60000);const status=await(await request.get('/api/sign/status')).json();test.skip(!status.available,'本机模型未安装');
  await start(page);await expect(page.getByTestId('sign-result')).toContainText('本次没有可靠候选');await expect(feedback(page).getByRole('button',{name:'与我的意思一致'})).toBeDisabled();await feedback(page).getByRole('button',{name:'不确定',exact:true}).click();await feedback(page).getByRole('button',{name:'保存反馈',exact:true}).click();await expect(feedback(page).getByRole('status')).toContainText('反馈已保存');
  const record=(await(await page.request.get('/api/records')).json()).records[0];let data=await(await page.request.get(`/api/records/${record.id}/practice`)).json();expect(data.attempts[0].feedback).toBe('uncertain');expect(data.attempts[0].candidate).toBeNull();
  await page.screenshot({path:'.runtime-logs/practice-feedback-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/practice-feedback-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'查看我的记录',exact:true}).click();const dialog=page.getByRole('dialog',{name:'我的记录',exact:true});await dialog.locator('.record-item').first().click();await expect(dialog.getByRole('region',{name:'已保存的练习反馈'})).toContainText('我的反馈：不确定');await dialog.getByRole('button',{name:'删除这条记录'}).click();await dialog.getByRole('button',{name:'确认删除',exact:true}).click();expect((await page.request.get(`/api/records/${record.id}/practice`)).status()).toBe(404);await dialog.getByRole('button',{name:'关闭我的记录'}).click();await expect(feedback(page)).toHaveCount(0);
});

test('历史刷新失败保留草稿，保存中遇到新版本后仍能重载并再次保存',async({page})=>{
  const mock=await candidateServices(page);await start(page);await page.getByRole('button',{name:'查看我的记录'}).click();const dialog=page.getByRole('dialog',{name:'我的记录',exact:true});await dialog.locator('.record-item').first().click();const history=dialog.getByRole('region',{name:'已保存的练习反馈'});await history.getByRole('button',{name:'填写这次反馈'}).click();const form=history.getByRole('region',{name:'本次练习反馈'});
  await form.getByRole('button',{name:'不一致',exact:true}).click();await form.getByLabel('你原本想表达的词').fill('谢谢');
  const refresh=()=>page.evaluate(recordId=>window.dispatchEvent(new CustomEvent('yuqiao-practice-changed',{detail:{recordId}})),mock.latest().recordId);
  mock.failReadNext();await refresh();await expect(history.getByRole('alert')).toContainText('读取练习记录失败');await expect(form.getByLabel('你原本想表达的词')).toHaveValue('谢谢');await history.getByRole('button',{name:'重试读取练习记录'}).click();
  // Retry only updates the same record, so a transient list failure must not erase the edit.
  await expect(form.getByLabel('你原本想表达的词')).toHaveValue('谢谢');
  let release!:()=>void;mock.delay(new Promise<void>(r=>{release=r;}));await form.getByRole('button',{name:'保存反馈',exact:true}).click();mock.conflict();await refresh();await expect(form.getByRole('alert')).toContainText('你的填写已保留');await expect(form.getByLabel('你原本想表达的词')).toHaveValue('谢谢');release();
  await form.getByRole('button',{name:'重新载入反馈'}).click();await expect(form.getByRole('button',{name:'不确定',exact:true})).toHaveAttribute('aria-pressed','true');await form.getByRole('button',{name:'与我的意思一致',exact:true}).click();await form.getByRole('button',{name:'保存反馈',exact:true}).click();await expect(history).toContainText('我的反馈：与我的意思一致');
});

test('保存超时不宣称成功，保留草稿并允许重载确认后台结果',async({page})=>{
  const mock=await candidateServices(page);await start(page);await page.clock.install();
  let release!:()=>void;mock.delay(new Promise<void>(r=>{release=r;}));await feedback(page).getByRole('button',{name:'不一致',exact:true}).click();await page.getByLabel('你原本想表达的词').fill('谢谢');await feedback(page).getByRole('button',{name:'保存反馈',exact:true}).click();await page.clock.fastForward(31000);
  await expect(feedback(page).getByRole('alert')).toContainText('保存响应超时');await expect(page.getByLabel('你原本想表达的词')).toHaveValue('谢谢');await expect(feedback(page).getByRole('status')).toHaveCount(0);
  release();await expect.poll(()=>mock.latest().revision).toBe(1);await feedback(page).getByRole('button',{name:'重新载入反馈'}).click();await expect(feedback(page).getByRole('status')).toContainText('已载入最新反馈');await expect(page.getByLabel('你原本想表达的词')).toHaveValue('谢谢');
});
