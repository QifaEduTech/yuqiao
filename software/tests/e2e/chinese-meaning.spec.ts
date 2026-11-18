import {test,expect} from '@playwright/test';
import {setupParagraph} from './helpers/paragraphStream';

test('本段中文断句后自动播报，原始词序保留可展开',async({page})=>{
 const s=await setupParagraph(page);
 for(const w of ['我','需要','帮助','谢谢'])await s.emit(w);
 expect(s.speech).toEqual([]);s.finish();await expect(page.getByTestId('paragraph-final')).toHaveText('我需要帮助，谢谢。');await expect.poll(()=>s.speech.length).toBe(1);expect(s.speech).toEqual(['我需要帮助，谢谢。']);
 await page.getByText('查看原始识别',{exact:true}).click();await expect(page.getByTestId('paragraph-source')).toHaveText('我 → 需要 → 帮助 → 谢谢');
 await page.screenshot({path:'.runtime-logs/chinese-meaning-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/chinese-meaning-mobile.png',fullPage:true});
});
test('明确需求词序整理，显示和播报使用同一结果，原词序不变',async({page})=>{
 const s=await setupParagraph(page);for(const w of ['我','帮助','需要'])await s.emit(w);s.finish();
 await expect(page.getByTestId('paragraph-final')).toHaveText('我需要帮助。');await expect.poll(()=>s.speech.length).toBe(1);expect(s.speech).toEqual(['我需要帮助。']);await page.getByText('查看原始识别',{exact:true}).click();await expect(page.getByTestId('paragraph-source')).toHaveText('我 → 帮助 → 需要');
});
test('主客体不明确时不猜句子，待核对段不影响下一段',async({page})=>{
 const s=await setupParagraph(page);for(const w of ['我','你','帮助'])await s.emit(w);s.finish();await expect(page.getByTestId('paragraph-final')).toHaveAttribute('data-chinese-status','needs_review');await expect(page.getByText('语义待核对 · 未自动播报')).toBeVisible();expect(s.speech).toEqual([]);
 await s.emit('谢谢');s.finish();await expect.poll(()=>s.speech.length).toBe(1);expect(s.speech).toEqual(['谢谢。']);
});
test('摄像头端同样等待整段，整理后显示中文与原词序',async({page})=>{
 const s=await setupParagraph(page,{entry:'camera'});s.candidate('我');await page.waitForTimeout(150);expect(s.speech).toEqual([]);s.candidate(null);
 for(const w of ['我','帮助','需要'])await s.emit(w);await page.getByRole('button',{name:'结束本段',exact:true}).click();await expect(page.getByTestId('paragraph-final')).toHaveText('我需要帮助。');await expect.poll(()=>s.speech.length).toBe(1);expect(s.speech).toEqual(['我需要帮助。']);
 await page.getByText('查看原始识别',{exact:true}).click();await expect(page.getByTestId('paragraph-source')).toHaveText('我 → 帮助 → 需要');await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.runtime-logs/chinese-camera-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'停止摄像头'}).click();await expect(page.getByTestId('paragraph-final')).toHaveCount(0);await expect(page.getByRole('button',{name:'重新开启摄像头'})).toBeVisible();
});
test('摄像头停止后迟到的整理语音失效，未确认段不自动播报',async({page})=>{
 const s=await setupParagraph(page,{entry:'camera',delayVoice:true});await s.emit('帮助');s.finish();await expect.poll(()=>s.speech.length).toBe(1);await page.getByRole('button',{name:'停止摄像头'}).click();s.release();await page.waitForTimeout(100);expect(await page.evaluate(()=>(window as any).__paragraphPlays)).toBe(0);await expect(page.getByTestId('paragraph-final')).toHaveCount(0);
});
