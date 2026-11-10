import {test,expect} from '@playwright/test';

test('旧多动作视频路线停用，首页只引导单动作学习',async({page,request})=>{
 const r=await request.post('/api/sign/sequences',{headers:{Origin:'http://127.0.0.1:5183','X-Yuqiao-Request':'1','Content-Type':'video/webm'},data:Buffer.alloc(40)});
 expect(r.status()).toBe(410);expect((await r.json()).error).toContain('已停用');
 await page.goto('/');await page.getByRole('tab',{name:'手语 文字',exact:true}).click();
 await expect(page.getByRole('heading',{name:'实时手语试用'})).toBeVisible();await expect(page.getByRole('button',{name:'开启摄像头'})).toHaveCount(0);
 await page.getByRole('link',{name:'前往手语学习'}).click();await expect(page).toHaveURL(/learning\.html$/);await expect(page.getByRole('combobox',{name:'手语视频识别方式'})).toHaveCount(0);
 await expect(page.getByLabel('当前可识别词语')).toHaveText('你好再见对不起谢谢');
});
