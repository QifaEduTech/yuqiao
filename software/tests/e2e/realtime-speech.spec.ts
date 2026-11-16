import {test,expect} from '@playwright/test';
import {setupParagraph as setup} from './helpers/paragraphStream';

// The Web requirement changed from candidate-per-word speech to paragraph speech.
// Keep queue, late-response, unavailable-voice and playback-blocking protections.
test.afterEach(async({page})=>{const stop=page.getByRole('button',{name:'停止实时识别',exact:true});if(await stop.count())await stop.click();});

test('默认只在段落完成后朗读，不因候选闪回或最终确认复读',async({page})=>{
  const s=await setup(page);s.candidate('我');await page.waitForTimeout(200);expect(s.speech).toHaveLength(0);s.candidate(null);
  await s.emit('我');await s.emit('需要');await s.emit('帮助');expect(s.speech).toHaveLength(0);s.finish();
  await expect.poll(()=>s.speech.length).toBe(1);expect(s.speech).toEqual(['我需要帮助。']);await page.waitForTimeout(150);expect(s.speech).toHaveLength(1);
});
test('音色未就绪时段落等待，就绪后只播一次',async({page})=>{
  const s=await setup(page,{deferReady:true});await expect.poll(s.hasStatus).toBe(true);await s.emit('挂号');s.finish();await expect(page.getByTestId('paragraph-final')).toHaveText('挂号。');expect(s.speech).toHaveLength(0);
  s.releaseStatus();await expect.poll(()=>s.speech.length).toBe(1);await expect.poll(()=>page.evaluate(()=>(window as any).__paragraphPlays)).toBe(1);
});
test('等待音色期间停止，后来就绪不补播旧段落',async({page})=>{
  const s=await setup(page,{deferReady:true});await s.emit('帮助');s.finish();await expect(page.getByTestId('paragraph-final')).toBeVisible();await page.getByRole('button',{name:'停止实时识别',exact:true}).click();s.releaseStatus();await page.waitForTimeout(200);expect(s.speech).toHaveLength(0);
});
test('错配语音拒绝播放，段落原文保留',async({page})=>{
  const s=await setup(page,{wrongAudio:true});await s.emit('没有');s.finish();await expect(page.getByRole('alert')).toContainText('不匹配');await expect(page.getByTestId('paragraph-final')).toHaveText('没有。');expect(await page.evaluate(()=>(window as any).__paragraphPlays)).toBe(0);
});
test('合成失败显示错误并保留段落，不回到逐词播报',async({page})=>{
  const s=await setup(page,{failSynthesis:true});await s.emit('帮助');s.finish();await expect(page.getByRole('alert')).toContainText('模拟语音不可用');await expect(page.getByTestId('paragraph-final')).toHaveText('帮助。');expect(s.speech).toEqual(['帮助。']);
});
test('播放拦截时可在播放器继续，持续识别不重复请求同段',async({page})=>{
  const s=await setup(page,{blockPlayback:true});await s.emit('谢谢');s.finish();const audio=page.getByTestId('realtime-auto-audio');await expect(audio).toBeVisible();
  await page.evaluate(()=>{(window as any).__paragraphBlockPlayback=false;});await audio.evaluate(async e=>{await (e as HTMLAudioElement).play();});await expect.poll(()=>page.evaluate(()=>(window as any).__paragraphPlays)).toBe(1);expect(s.speech).toHaveLength(1);
});
