import {test,expect} from '@playwright/test';
import {setupParagraph} from './helpers/paragraphStream';

for(const entry of ['realtime','camera'])test(`${entry}不点结束，出画自动成段；重新入镜续接，下一段可边播边识别`,async({page})=>{
 const s=await setupParagraph(page,{entry,automatic:true});
 const status=entry==='camera'?page.locator('.camera-entry-status'):page.getByTestId('realtime-status');
 for(const w of ['我','需要','帮助'])await s.emit(w);
 s.hands(false);await expect(status).toContainText('秒后自动整理');await expect(page.getByTestId('paragraph-final')).toHaveCount(0);
 s.hands(true);await expect(status).not.toContainText('秒后自动整理');await page.waitForTimeout(2100);await expect(page.getByTestId('paragraph-final')).toHaveCount(0);
 await s.emit('谢谢');s.hands(false);await expect(page.getByTestId('paragraph-final')).toHaveText('我需要帮助，谢谢。',{timeout:5000});await expect(page.getByTestId('paragraph-auto-ended')).toContainText('可继续');await expect.poll(()=>s.speech.length).toBe(1);
 s.hands(true);await s.emit('谢谢');s.hands(false);await expect(page.getByTestId('paragraph-final').last()).toHaveText('谢谢。',{timeout:5000});expect(s.speech).toEqual(['我需要帮助，谢谢。']);
 await page.getByTestId('realtime-auto-audio').evaluate(el=>el.dispatchEvent(new Event('ended')));await expect.poll(()=>s.speech.length).toBe(2);expect(s.speech).toEqual(['我需要帮助，谢谢。','谢谢。']);expect(s.manualFinishes()).toBe(0);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/automatic-paragraph-'+entry+'.png',fullPage:true});
});

test('自动收尾期间停止，不生成或补播旧段落',async({page})=>{
 const s=await setupParagraph(page,{automatic:true});await s.emit('谢谢');s.hands(false);await expect(page.getByTestId('realtime-status')).toContainText('秒后自动整理');await page.getByRole('button',{name:'停止实时识别',exact:true}).click();await page.waitForTimeout(2100);expect(s.speech).toEqual([]);await expect(page.getByTestId('paragraph-final')).toHaveCount(0);
});
