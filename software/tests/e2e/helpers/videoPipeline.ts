import {expect,type Page} from '@playwright/test';
export async function registerForVideo(page:Page){
 const username=`video_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
 await page.getByRole('button',{name:'登录 / 注册'}).click();await page.getByRole('dialog',{name:'欢迎回来'}).getByRole('button',{name:'注册',exact:true}).click();
 await page.getByLabel('用户名',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill('test-passphrase-2026');await page.getByLabel('再次输入密码',{exact:true}).fill('test-passphrase-2026');await page.getByRole('button',{name:'注册并登录'}).click();await expect(page.locator('.account-name')).toContainText(username);
}
export async function recordVideo(page:Page){
 if(new URL(page.url()).pathname!=='/learning.html')await page.goto('/learning.html');await page.getByRole('button',{name:'开启摄像头'}).first().click();await page.getByRole('button',{name:'开始录制',exact:true}).click();await page.waitForTimeout(1100);await page.getByRole('button',{name:'结束录制'}).click();
}
export async function saveRecordedVideo(page:Page){await page.getByRole('button',{name:'下一步：确认并保存'}).click();await page.getByRole('button',{name:'确认保存录像'}).click();await expect(page.getByRole('heading',{name:'这次练习，已经留下来了'})).toBeVisible();}
export async function saveAndRecognizeVideo(page:Page){await saveRecordedVideo(page);await page.getByRole('button',{name:'开始识别',exact:true}).click();}

