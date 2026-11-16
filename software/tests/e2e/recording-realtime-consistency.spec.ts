import {test,expect} from '@playwright/test';
import {registerForVideo,recordVideo,saveRecordedVideo} from './helpers/videoPipeline';

test('录像与实时公布同一四词，四词候选都能显示，旧词和冲突不冒充结果',async({page})=>{
  const cases=[
    {status:'candidate',candidate:'谢谢',sign_id:'csl.thanks'},
    {status:'candidate',candidate:'帮助',sign_id:'csl.ref.bmcx.1900'},
    {status:'candidate',candidate:'需要',sign_id:'csl.ref.bmcx.1874'},
    {status:'candidate',candidate:'我',sign_id:'csl.me',end_boundary_observed:false},
    {status:'uncertain',candidate:null,reason:'conflicting_evidence'},
    {status:'candidate',candidate:'再见',sign_id:'csl.goodbye'},
  ];
  const recorded=await(await page.request.get('/api/sign/status')).json();
  const live=await(await page.request.get('/api/sign/realtime/status')).json();
  expect(recorded.labels).toEqual(['谢谢','帮助','需要','我']);expect(recorded.labels).toEqual(live.labels);
  let index=0;
  await page.route('**/api/sign/status',r=>r.fulfill({json:{available:true,labels:recorded.labels}}));
  await page.route('**/api/sign/experiments',r=>r.fulfill({json:cases[index++]}));
  await page.goto('/learning.html');await registerForVideo(page);await recordVideo(page);await saveRecordedVideo(page);
  for(let i=0;i<cases.length;i++){
    await page.getByRole('button',{name:'开始识别',exact:true}).click();
    const view=page.getByTestId('sign-result');
    if(i<4)await expect(view).toContainText('识别候选：'+cases[i].candidate);
    else if(i===4)await expect(view).toContainText('本段动作证据存在冲突');
    else {await expect(view).toContainText('本次没有可靠候选');await expect(view).not.toContainText('识别候选：再见');}
    if(i===3)await expect(view).toContainText('未观察到结束边界');
    if(i<cases.length-1)await page.getByRole('button',{name:'停止并清除本次识别',exact:true}).click();
  }
  expect(index).toBe(cases.length);
  expect((await(await page.request.get('/api/records')).json()).records).toHaveLength(1);
});

test('历史切换另一条录像后，旧请求的迟到候选不串入当前录像',async({page})=>{
  await page.route('**/api/sign/status',r=>r.fulfill({json:{available:true,labels:['谢谢','帮助','需要','我']}}));
  await page.goto('/learning.html');await registerForVideo(page);await recordVideo(page);await saveRecordedVideo(page);
  await page.goto('/learning.html');await recordVideo(page);await saveRecordedVideo(page);
  let release:undefined|(()=>void),requests=0;
  await page.route('**/api/sign/experiments',async r=>{
    requests++;
    if(requests===1){await new Promise<void>(resolve=>{release=resolve;});await r.fulfill({json:{status:'candidate',candidate:'帮助'}}).catch(()=>{});}
    else await r.fulfill({json:{status:'candidate',candidate:'我',end_boundary_observed:false}});
  });
  await page.getByRole('button',{name:'查看我的记录',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'我的记录',exact:true}),items=dialog.locator('.record-item');
  await expect(items).toHaveCount(2);await items.nth(0).click();
  await dialog.getByRole('button',{name:'重新识别录像',exact:true}).click();await expect.poll(()=>!!release).toBe(true);
  await items.nth(1).click();await expect(dialog.getByTestId('sign-result')).toHaveCount(0);
  release!();await page.waitForTimeout(100);await expect(dialog.getByTestId('sign-result')).toHaveCount(0);
  await dialog.getByRole('button',{name:'重新识别录像',exact:true}).click();
  await expect(dialog.getByTestId('sign-result')).toContainText('识别候选：我');
  await expect(dialog.getByTestId('sign-result')).not.toContainText('识别候选：帮助');
  expect((await(await page.request.get('/api/records')).json()).records).toHaveLength(2);
});
