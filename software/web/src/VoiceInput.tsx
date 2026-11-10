import { useEffect, useState } from 'react';
import { Check, Mic, RotateCcw, Save, Square } from 'lucide-react';
import { api } from './api';
import { recordingToWav } from './audio';
import type { useMediaCapture } from './useMediaCapture';

type Result = { status: 'transcribed' | 'no_speech'; text: string; processing_ms: number; requires_confirmation: boolean };
type Props = { media: ReturnType<typeof useMediaCapture>; loggedIn: boolean; saving: boolean; savedText: string; matching:boolean; onInvalidate:()=>void; onMatch:(text:string)=>void; onSave: (text: string) => void; onUseText: (text: string) => void };

export function VoiceInput({ media, loggedIn, saving, savedText, matching, onInvalidate, onMatch, onSave, onUseText }: Props) {
  const [phase, setPhase] = useState<'idle' | 'processing' | 'review' | 'error'>('idle');
  const [transcript, setTranscript] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const recording = media.status === 'recording';
  const requesting = media.status === 'requesting';

  useEffect(() => {
    const blob = media.recordingBlob;
    onInvalidate();
    setConfirmed(false); setTranscript(''); setError('');
    if (!blob) { setPhase('idle'); return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), 90000);
    setPhase('processing');
    void (async () => {
      try {
        const audio = await recordingToWav(blob);
        if (controller.signal.aborted) return;
        const result = await api<Result>('/api/speech/transcriptions', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audio, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.status === 'no_speech' || !result.text.trim()) throw new Error('没有识别到清晰的语音，请靠近麦克风重新录制。');
        setTranscript(result.text); setPhase('review');
      } catch (caught) {
        if (controller.signal.aborted && controller.signal.reason !== 'timeout') return;
        setError(controller.signal.reason === 'timeout' ? '识别超时，请缩短录音后重试。' : caught instanceof Error ? caught.message : '识别失败，请重试。');
        setPhase('error');
      } finally { clearTimeout(timeout); }
    })();
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [media.recordingBlob, attempt, onInvalidate]);

  return <div className="voice-input">
    {phase !== 'review' && <div className={`mic-orb ${recording ? 'recording' : ''}`}><Mic size={30} strokeWidth={1.5} /></div>}
    <strong>{recording ? `正在录音 00:${String(media.seconds).padStart(2, '0')}` : phase === 'processing' ? '正在本机识别中文…' : phase === 'review' ? '请核对识别出的文字' : media.status === 'recorded' ? '录音完成' : '把想说的话，说出来'}</strong>
    <p>{phase === 'processing' ? '首次识别需要加载模型，稍等片刻。' : phase === 'review' ? '先核对转写文字，确认后自动播放手语动作。保存时保留这段原话。' : '录制结束后自动转写为中文，音频只交给本机服务处理。'}</p>
    {media.recordingUrl && <audio controls src={media.recordingUrl} aria-label="录音回听" />}
    {phase === 'review' && <div className="speech-review">
      <label className="sr-only" htmlFor="speech-transcript">语音识别文字</label>
      <textarea id="speech-transcript" maxLength={2000} value={transcript} disabled={saving} onChange={event => { onInvalidate();setTranscript(event.target.value); setConfirmed(false); }} />
      <span className={`speech-confirm-state ${confirmed ? 'confirmed' : ''}`}>{confirmed ? '已核对确认' : '待你核对 · 尚未保存'}</span>
      {!confirmed ? <button className="primary-button" disabled={!transcript.trim()} onClick={() => {setConfirmed(true);onMatch(transcript.trim());}}><Check size={16} />确认这段文字</button> : <>
        <button className="secondary-button" disabled={saving||matching} onClick={()=>onMatch(transcript.trim())}>{matching?'正在准备动作…':'重新播放这段文字'}</button>
        <button className="primary-button" disabled={saving || savedText === transcript.trim()} onClick={() => onSave(transcript.trim())}><Save size={16} />{saving ? '正在保存…' : savedText === transcript.trim() ? '识别文字已保存' : loggedIn ? '保存识别文字' : '登录并保存识别文字'}</button>
        <button className="secondary-button" disabled={saving} onClick={() => onUseText(transcript.trim())}>转入文字输入</button>
      </>}
    </div>}
    {error && <div className="inline-notice notice-error" role="status">{error}</div>}
    {phase === 'error' && <button className="secondary-button" onClick={() => setAttempt(value => value + 1)}><RotateCcw size={15} />重试识别这段录音</button>}
    <button className={phase === 'review' ? 'secondary-button' : 'primary-button'} disabled={requesting || saving} onClick={() => {onInvalidate();if(recording)media.finish();else void media.open('audio');}}>{recording ? <><Square size={16} />结束录音</> : <><Mic size={16} />{requesting ? '等待设备授权…' : media.status === 'recorded' ? '重新录音' : '开始录音'}</>}</button>
    {(requesting || recording || media.recordingUrl) && <button className="text-button" disabled={saving} onClick={()=>{onInvalidate();media.clear();}}>取消并清除录音</button>}
    <span className="small-hint">最长 30 秒 · 本机识别 · 原始录音不落盘</span>
  </div>;
}
