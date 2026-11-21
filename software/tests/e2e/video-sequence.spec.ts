import {test,expect} from '@playwright/test';

test('首页引导先录后识别，旧录像接口维持退役',async({page,request})=>{
 const r=await request.post('/api/sign/sequences',{headers:{Origin:'http://127.0.0.1:5183','X-Yuqiao-Request':'1','Content-Type':'video/webm'},data:Buffer.alloc(40)});
 expect(r.status()).toBe(410);expect((await r.json()).error).toContain('已停用');
 await page.goto('/');await page.getByRole('tab',{name:'手语 文字',exact:true}).click();
 await expect(page.getByRole('heading',{name:'手语转文字'})).toBeVisible();await expect(page.getByRole('button',{name:'开启摄像头'})).toHaveCount(0);
 await page.getByRole('link',{name:'录制手语',exact:true}).click();
 await expect(page).toHaveURL(/realtime\.html$/);
 await expect(page.getByRole('button',{name:'开启摄像头',exact:true})).toBeVisible();
 await expect(page.getByLabel('摄像头预览')).toHaveCount(0);
});
