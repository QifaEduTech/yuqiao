import {test,expect} from '@playwright/test';
import {mockExpressionForUi} from './expression-fixture';
import scene from '../../shared/service-window-scene.json' with {type:'json'};

test('两句服务窗口核心台词自动完整播放，原话可见，匹配过程隐藏',async({page})=>{
 await mockExpressionForUi(page);await page.goto('/');
 for(const text of ['我需要帮助','好，请等候']){
  await page.getByRole('button',{name:text,exact:true}).click();await page.getByRole('button',{name:'提交文字',exact:true}).click();
  await expect(page.getByTestId('avatar')).toHaveAttribute('data-playing','true',{timeout:30000});
  await expect(page.locator('.home-motion-title strong')).toHaveText(text);await expect(page.locator('.motion-match-card')).toHaveCount(0);
  await page.getByRole('combobox',{name:'首页动作速度'}).selectOption('1.5');await expect(page.getByTestId('home-motion-current')).toHaveText('本段播放结束',{timeout:15000});
 }
 await page.getByRole('button',{name:'重播动作',exact:true}).click();await page.waitForTimeout(2500);await page.getByRole('button',{name:'暂停动作',exact:true}).click();
 await page.screenshot({path:'.runtime-logs/window-motions/home-window-scene.png',fullPage:true});
});
test('四个来源词条现在有正确版本预览，来源与识别范围保持清楚',async({page})=>{
 await page.goto('/sign-dictionary.html');
 for(const item of scene.motions){
  await page.getByLabel('查找词语').fill(item.label);const row=page.locator('tr[data-id="'+item.id+'"]');
  await expect(row).toContainText('已制作 · 待核对');await expect(row).toContainText('不在当前识别范围');
  await expect(row.getByRole('link',{name:'预览“'+item.label+'”',exact:true})).toHaveAttribute('href',new RegExp('motion='+item.id+'&version=source-reference-1'));
 }
});
