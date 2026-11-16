import {expect,type Page} from '@playwright/test';
import {registerAtGate} from './gate';
export async function registerForVideo(page:Page){
 return registerAtGate(page);
}
export async function recordVideo(page:Page){
 if(new URL(page.url()).pathname!=='/learning.html')await page.goto('/learning.html');await page.getByRole('button',{name:'开启摄像头'}).first().click();await page.getByRole('button',{name:'开始录制',exact:true}).click();await page.waitForTimeout(1100);await page.getByRole('button',{name:'结束录制'}).click();
}
export async function saveRecordedVideo(page:Page){await page.getByRole('button',{name:'下一步：确认并保存'}).click();await page.getByRole('button',{name:'确认保存录像'}).click();await expect(page.getByRole('heading',{name:'这次练习，已经留下来了'})).toBeVisible();}
export async function saveAndRecognizeVideo(page:Page){await saveRecordedVideo(page);await page.getByRole('button',{name:'开始识别',exact:true}).click();}

