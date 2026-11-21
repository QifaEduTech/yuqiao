import {test,expect} from '@playwright/test';
test('录像识别与自动收尾分开显示，不把只有反例的100%当作学会',async({page})=>{
 const base={signId:'csl.you',text:'你',counts:{tp:0,fn:5,fp:0,tn:0},recall:0,precision:null,falsePositiveRate:null,accuracy:0,passed:false};
 const missing={...base,signId:'csl.me',text:'我',counts:{tp:0,fn:0,fp:0,tn:5},recall:null,accuracy:1};
 await page.route('**/api/training/state',r=>r.fulfill({json:{runtimeMode:'unified-tcn',actions:[{id:'good',text:'好',state:'collecting',samples:[]}],busy:false,jobs:[{id:'job',kind:'unified',createdAt:1,status:'needs_data',message:'本轮未达标',report:{trained:true,passed:false,perClass:[base,missing],reassessment:{mode:'diagnostic_replay',perClass:[base,missing],recordingPerClass:[{...base,counts:{tp:3,fn:2,fp:0,tn:0},recall:.6,precision:1,accuracy:.6},missing]}}}]}}));
 await page.route('**/api/training/sources',r=>r.fulfill({json:{sources:[]}}));await page.goto('/training.html');const metrics=page.locator('.training-metrics').first();await expect(metrics).toBeHidden();await page.getByText('查看训练结果',{exact:true}).click();await expect(metrics).toBeVisible();await expect(metrics).toContainText('录像识别：60.0%');await expect(metrics).toContainText('实时自动收尾成功率：0.0%');await expect(page.locator('.training-metrics').nth(1)).toContainText('尚无本动作的新测试');await expect(page.locator('.training-metrics').nth(1)).not.toContainText('100.0%');await expect(page.getByText(/同一模型对原测试视频的分层复查/)).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/layered-training-metrics.png',fullPage:true});
 await page.getByRole('button',{name:'打开任务：好'}).click();
 await expect(page.getByRole('region',{name:'统一训练'})).toHaveCount(0);
 for(const name of ['训练集','测试集']){
  await page.getByRole('button',{name:name+'，点击录制'}).click();
  await expect(page.getByRole('heading',{level:1,name:'好 › '+name})).toBeInViewport();
  await expect(page.getByText('本轮未达标',{exact:true})).toHaveCount(0);
 }
 await page.getByRole('button',{name:'全部任务',exact:true}).click();
 await expect(metrics).toBeHidden();
});
