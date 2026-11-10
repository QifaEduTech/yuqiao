import { useCallback, useEffect, useRef, useState } from 'react';

export type MediaKind = 'audio' | 'video';
type MediaStatus = 'idle' | 'requesting' | 'preview' | 'recording' | 'recorded' | 'error';
const MAX_RECORDING_SECONDS = 30;

function permissionMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError') return '设备访问未获允许。请在浏览器地址栏中检查权限，或使用文字输入。';
  if (name === 'NotFoundError') return '没有找到可用设备，请检查摄像头或麦克风是否已连接。';
  if (name === 'NotReadableError') return '设备可能正在被其他应用占用，请关闭占用程序后重试。';
  return '暂时无法开启设备，请检查设备连接及浏览器设置。';
}

export function useMediaCapture() {
  const [status, setStatus] = useState<MediaStatus>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const liveStream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const objectUrl = useRef('');
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const releaseStream = useCallback(() => {
    liveStream.current?.getTracks().forEach(track => track.stop());
    liveStream.current = null;
    setStream(null);
  }, []);

  const clear = useCallback(() => {
    generation.current++;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current) {
      recorder.current.ondataavailable = null;
      recorder.current.onstop = null;
      recorder.current.onerror = null;
      if (recorder.current.state !== 'inactive') recorder.current.stop();
      recorder.current = null;
    }
    releaseStream();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = '';
    setRecordingUrl('');
    setRecordingBlob(null);
    setSeconds(0);
    setError('');
    setStatus('idle');
  }, [releaseStream]);

  const finish = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    releaseStream();
  }, [releaseStream]);

  const startRecording = useCallback(() => {
    const current = liveStream.current;
    if (!current || recorder.current?.state === 'recording') return;
    if (typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持录制，请使用新版 Edge 或 Chrome。');
      releaseStream();
      setStatus('error');
      return;
    }
    const requestGeneration = generation.current;
    const chunks: Blob[] = [];
    try {
      const next = new MediaRecorder(current);
      recorder.current = next;
      let bytes = 0;
      next.ondataavailable = event => {
        if (requestGeneration !== generation.current || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > 32 * 1024 * 1024) {
          clear();
          setError('录制内容超过本阶段的 32 MB 限制，请缩短后重试。');
          setStatus('error');
          return;
        }
        chunks.push(event.data);
      };
      next.onstop = () => {
        if (requestGeneration !== generation.current) return;
        releaseStream();
        const blob = new Blob(chunks, { type: next.mimeType });
        if (!blob.size) {
          setError('未能获得有效录制内容，请重试。');
          setStatus('error');
          return;
        }
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(blob);
        setRecordingUrl(objectUrl.current);
        setRecordingBlob(blob);
        setStatus('recorded');
        recorder.current = null;
      };
      next.onerror = () => {
        clear();
        setError('录制被中断，请检查设备后重试。');
        setStatus('error');
      };
      next.start(250);
      setStatus('recording');
      setSeconds(0);
      const started = performance.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((performance.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_RECORDING_SECONDS) finish();
      }, 200);
    } catch {
      clear();
      setError('该设备的录制格式暂不可用，请换一个浏览器重试。');
      setStatus('error');
    }
  }, [clear, finish, releaseStream]);

  const open = useCallback(async (kind: MediaKind) => {
    clear();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('当前页面无法访问设备，请使用 localhost 或 HTTPS 地址打开。');
      setStatus('error');
      return;
    }
    const requestGeneration = generation.current;
    setStatus('requesting');
    try {
      const next = await navigator.mediaDevices.getUserMedia(kind === 'audio'
        ? { audio: true, video: false }
        : { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
      if (requestGeneration !== generation.current) {
        next.getTracks().forEach(track => track.stop());
        return;
      }
      liveStream.current = next;
      setStream(next);
      setStatus('preview');
      next.getTracks().forEach(track => track.addEventListener('ended', () => {
        if (requestGeneration !== generation.current || liveStream.current !== next) return;
        clear();
        setError('设备连接已中断，请重新开启。');
        setStatus('error');
      }));
      if (kind === 'audio') startRecording();
    } catch (caught) {
      if (requestGeneration !== generation.current) return;
      setError(permissionMessage(caught));
      setStatus('error');
    }
  }, [clear, startRecording]);

  useEffect(() => {
    // Backgrounding ends private capture; a late permission response is invalidated too.
    const onVisibility = () => { if (document.hidden) clear(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', clear);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', clear);
      clear();
    };
  }, [clear]);

  return { status, stream, recordingUrl, recordingBlob, seconds, error, open, startRecording, finish, clear };
}
