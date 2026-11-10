import {test,expect} from '@playwright/test';
import {registerForVideo,recordVideo} from './helpers/videoPipeline';

test('录制前创建真实采集轮次，保存和重录沿用，重新打开本页仍可恢复',async({page})=>{
  await page.goto('/learning.html');await registerForVideo(page);
  let form=page.getByRole('region',{name:'本次练习登记'});await form.getByLabel('样本类别').selectOption('thanks');await form.locator('summary').filter({hasText:'采集信息'}).click();await form.getByRole('button',{name:'开始新一轮采集'}).click();
  const batch=await form.getByLabel('采集批次').inputValue();expect(batch).toMatch(/^capture:\d{8}:\d{6}:[a-f0-9]{6}$/);
  await recordVideo(page);await page.getByRole('button',{name:'下一步：确认并保存'}).click();await expect(form.getByRole('button',{name:'开始新一轮采集'})).toBeDisabled();await form.getByLabel('这段内容完整',{exact:false}).check();await form.getByLabel('我已回看原片',{exact:false}).check();await page.getByRole('button',{name:'确认保存录像并登记'}).click();await expect(page.getByRole('heading',{name:'这次练习，已经留下来了'})).toBeVisible();
  const record=(await(await page.request.get('/api/records')).json()).records[0];expect((await(await page.request.get(`/api/records/${record.id}/sample`)).json()).sample.batch).toBe(batch);
  await page.getByRole('button',{name:'重新录制',exact:true}).click();form=page.getByRole('region',{name:'本次练习登记'});await form.locator('summary').filter({hasText:'采集信息'}).click();await expect(form.getByLabel('采集批次')).toHaveValue(batch);
  await page.reload();await expect(page.locator('.account-name')).toBeVisible();await form.getByLabel('样本类别').selectOption('thanks');await form.locator('summary').filter({hasText:'采集信息'}).click();await expect(form.getByLabel('采集批次')).toHaveValue(batch);await form.getByRole('button',{name:'开始新一轮采集'}).click();await expect(form.getByLabel('采集批次')).not.toHaveValue(batch);
  await page.screenshot({path:'.runtime-logs/capture-round-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/capture-round-mobile.png',fullPage:true});
});
