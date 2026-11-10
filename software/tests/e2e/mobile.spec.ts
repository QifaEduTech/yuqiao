import {test,expect} from '@playwright/test';
test('移动端四个入口、窄屏布局和账号入口可操作，不自动开启摄像头',async({page})=>{
 await page.setViewportSize({width:390,height:844});let cameraRequests=0;page.on('request',r=>{if(r.url().endsWith('/api/sign/realtime/sessions')&&r.method()==='POST')cameraRequests++;});
 await page.goto('/android.html');await expect(page.getByRole('heading',{name:/把想说的话，.*带到彼此身边/ })).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.runtime-logs/mobile-home.png',fullPage:true});
 const nav=page.getByRole('navigation',{name:'移动端导航'});await nav.getByRole('button',{name:'识别',exact:true}).click();await expect(page.getByRole('heading',{name:'让动作被听见'})).toBeVisible();expect(cameraRequests).toBe(0);await expect(page.getByRole('button',{name:'开启摄像头并实时识别'})).toBeVisible();
 await nav.getByRole('button',{name:'学习',exact:true}).click();await expect(page.locator('.learning-page')).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await nav.getByRole('button',{name:'我的',exact:true}).click();await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();await expect(page.getByRole('dialog',{name:'欢迎回来'})).toBeVisible();
});
test('HBuilder模型包无训练录像，三个独立模型计算与电脑一致',async({page})=>{
 await page.goto('/android-app/model-check.html');await page.getByRole('button',{name:'检查模型文件与计算结果'}).click();await expect(page.locator('#result')).toHaveAttribute('data-result','passed',{timeout:30000});
 const result=await page.evaluate(()=>(window as any).__modelCheck);expect(result.models).toBe(4);expect(result.syntheticCases).toBe(14);expect(result.maxAbsoluteError).toBeLessThan(2e-5);expect(result.cameraRecognitionReady).toBe(false);expect(result.trainingVideos).toBe(0);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.runtime-logs/mobile-model-check.png',fullPage:true});
});
test('HBuilder浏览器入口跳转真实移动页面',async({page})=>{await page.goto('/android-app/index.html');await page.getByRole('button',{name:/进入语桥/}).click();await expect(page).toHaveURL(/\/app\/android-offline.html$/);await expect(page.getByRole('navigation',{name:'移动端导航'})).toBeVisible();});
