import {test,expect,type Page} from '@playwright/test';
import {setupParagraph as setup} from './helpers/paragraphStream';

const endAudio=(page:Page)=>page.getByTestId('realtime-auto-audio').evaluate(el=>el.dispatchEvent(new Event('ended')));
test.afterEach(async({page})=>{const stop=page.getByRole('button',{name:'停止实时识别',exact:true});if(await stop.count())await stop.click();});

test('任意已接入动作按顺序成段，新增动作自动进入范围，整段结束前不逐词播报',async({page})=>{
  const s=await setup(page);
  for(const w of ['我','需要','挂号','没有','帮助','谢谢'])await s.emit(w);
  await expect(page.getByTestId('paragraph-draft')).toHaveText('我需要挂号没有帮助谢谢。');expect(s.speech).toHaveLength(0);
  await page.getByRole('button',{name:'结束本段',exact:true}).click();await expect(page.getByTestId('paragraph-final')).toHaveText('我需要挂号没有帮助谢谢。');await expect.poll(()=>s.speech.length).toBe(1);expect(s.speech[0]).toBe('我需要挂号没有帮助谢谢。');
  await endAudio(page);await page.waitForTimeout(200);expect(s.speech).toHaveLength(1);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('持势候选不自动当成整段，重复动作的独立确认仍保留',async({page})=>{
  const s=await setup(page);s.candidate('谢谢');await page.waitForTimeout(300);expect(s.speech).toHaveLength(0);await expect(page.getByTestId('paragraph-final')).toHaveCount(0);
  s.candidate(null);await s.emit('谢谢');await s.emit('谢谢');s.finish();await expect(page.getByTestId('paragraph-final')).toHaveText('谢谢谢谢。');await expect.poll(()=>s.speech.length).toBe(1);
});
test('冲突片段保留待核对文字，不自动朗读',async({page})=>{
  const s=await setup(page);await s.emit('需要');s.partial();s.finish();await expect(page.getByTestId('paragraph-final')).toHaveAttribute('data-partial','true');await expect(page.getByText('片段待核对 · 未自动播报')).toBeVisible();expect(s.speech).toHaveLength(0);
});
test('停止后迟到语音不能播放，整段记录同时清除',async({page})=>{
  const s=await setup(page,{delayVoice:true});await s.emit('帮助');s.finish();await expect.poll(()=>s.speech.length).toBe(1);
  await page.getByRole('button',{name:'停止实时识别',exact:true}).click();s.release();await page.waitForTimeout(200);await expect(page.getByTestId('paragraph-final')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__paragraphPlays)).toBe(0);
});
test('整段自动播放被浏览器拦截时保留应急播放器',async({page})=>{
  const s=await setup(page,{blockPlayback:true});await s.emit('挂号');s.finish();await expect(page.getByTestId('realtime-auto-audio')).toBeVisible();await expect(page.getByTestId('paragraph-final')).toHaveText('挂号。');
});
test('语音不可用仍保留完整段落，不恢复逐词或手动拼句面板',async({page})=>{
  const s=await setup(page,{available:false});await s.emit('我');await s.emit('需要');await s.emit('帮助');s.finish();await expect(page.getByTestId('paragraph-final')).toHaveText('我需要帮助。');expect(s.speech).toHaveLength(0);await expect(page.getByRole('heading',{name:'把动作连成话'})).toHaveCount(0);
});
test('后台或离开取消整段，不将未完成段补播',async({page})=>{
  const s=await setup(page);await s.emit('我');await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-phase','idle');await expect(page.getByTestId('paragraph-final')).toHaveCount(0);expect(s.speech).toHaveLength(0);
});
test('协议拒绝后台文本无证据补词',async({page})=>{
  const s=await setup(page);s.tamper();await expect(page.getByRole('alert')).toContainText('段落结果不匹配');await expect(page.getByTestId('paragraph-final')).toHaveCount(0);
});
test('不同段落串行播报，重复的真实发言可再次成段，停止后全部清空',async({page})=>{
  const s=await setup(page);await s.emit('挂号');s.finish();await expect.poll(()=>s.speech.length).toBe(1);
  await s.emit('没有');await s.emit('挂号');s.finish();await expect(page.getByTestId('paragraph-final')).toHaveCount(2);
  expect(s.speech).toEqual(['挂号。']);await endAudio(page);await expect.poll(()=>s.speech.length).toBe(2);expect(s.speech).toEqual(['挂号。','没有挂号。']);await endAudio(page);
  await s.emit('挂号');s.finish();await expect.poll(()=>s.speech.length).toBe(3);expect(s.speech[2]).toBe('挂号。');
  await page.getByRole('button',{name:'停止实时识别',exact:true}).click();await expect(page.getByTestId('paragraph-final')).toHaveCount(0);
});
