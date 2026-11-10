import {test,expect,type Page} from '@playwright/test';
import {mockExpressionForUi} from './expression-fixture';
test.beforeEach(async({page})=>mockExpressionForUi(page));
async function submit(page:Page,text:string){await page.getByLabel('输入要表达的中文').fill(text);await page.getByRole('button',{name:'提交文字',exact:true}).click();}
const avatar=(page:Page)=>page.getByTestId('avatar');
const playing=(page:Page)=>expect(avatar(page)).toHaveAttribute('data-playing','true',{timeout:30000});

test('提交后自动播放，暂停重播调速和相机控制保留',async({page})=>{
 await page.goto('/');await submit(page,'我爱你');await playing(page);
 await page.getByRole('button',{name:'暂停动作',exact:true}).click();const slider=page.getByRole('slider',{name:'首页动作进度'});const paused=await slider.inputValue();await page.waitForTimeout(180);expect(await slider.inputValue()).toBe(paused);
 await page.getByRole('combobox',{name:'首页动作速度'}).selectOption('1.5');await expect(avatar(page)).toHaveAttribute('data-playing','false');
 await page.getByRole('button',{name:'重播动作',exact:true}).click();await playing(page);await page.getByRole('button',{name:'恢复正面视角'}).click();await playing(page);
 await expect(page.getByTestId('home-motion-current')).toHaveText('本段播放结束',{timeout:10000});
 await expect(page.getByTestId('home-motion-current')).not.toContainText('爱');
});
test('改字清空和切换方向立即取消，重复提交同一句从头自动播放',async({page})=>{
 await page.goto('/');await submit(page,'谢谢');await playing(page);await page.waitForTimeout(400);
 await page.getByRole('button',{name:'暂停动作',exact:true}).click();await page.getByRole('button',{name:'提交文字',exact:true}).click();await playing(page);
 expect(Number(await page.getByRole('slider',{name:'首页动作进度'}).inputValue())).toBeLessThan(.4);
 await page.getByLabel('输入要表达的中文').fill('你好');await expect(avatar(page)).toHaveAttribute('data-playing','false');await expect(page.getByTestId('home-motion-play')).toHaveCount(0);
 await submit(page,'谢谢');await playing(page);await page.getByRole('button',{name:'清空本次交流'}).click();await expect(page.getByTestId('home-motion-play')).toHaveCount(0);
 await submit(page,'你好');await playing(page);await page.getByRole('tab',{name:'手语 文字',exact:true}).click();await expect(avatar(page)).toHaveCount(0);
});
test('整段资源失败不播前半段；手动重试加载完成后自动播放',async({page})=>{
 let fail=true;await page.route('**/shared/sign-motions/anny/csl.love.json*',r=>fail&&r.request().resourceType()==='fetch'?r.fulfill({status:503,body:'failed'}):r.continue());
 await page.goto('/');await submit(page,'你好我爱你');await expect(page.getByRole('region',{name:'首页动作试播'})).toContainText('动作加载失败');await expect(avatar(page)).toHaveAttribute('data-playing','false');
 fail=false;await page.getByRole('button',{name:'重新加载动作'}).click();await playing(page);
});
test('语音只确认转写，随后自动播放，改字和重录立即停止',async({page})=>{
 await page.route('**/api/speech/transcriptions',r=>r.fulfill({json:{status:'transcribed',text:'你好，谢谢，再见',processing_ms:100,requires_confirmation:true}}));
 await page.goto('/');await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.getByRole('button',{name:'开始录音',exact:true}).click();await expect(page.locator('.voice-input > strong')).toContainText(/正在录音 00:0[1-9]/);await page.getByRole('button',{name:'结束录音',exact:true}).click();
 await expect(page.getByLabel('语音识别文字')).toHaveValue('你好，谢谢，再见');await expect(page.getByTestId('home-motion-play')).toHaveCount(0);await page.getByRole('button',{name:'确认这段文字',exact:true}).click();await playing(page);
 await expect(page.getByRole('button',{name:'确认表达并准备播放'})).toHaveCount(0);
 await page.getByLabel('语音识别文字').fill('谢谢');await expect(page.getByTestId('home-motion-play')).toHaveCount(0);await page.getByRole('button',{name:'确认这段文字',exact:true}).click();await playing(page);await page.getByRole('button',{name:'重新录音',exact:true}).click();await expect(page.getByTestId('home-motion-play')).toHaveCount(0);
});
