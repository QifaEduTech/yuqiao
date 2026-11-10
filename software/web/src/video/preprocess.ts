import { QUALITY_THRESHOLDS, type QualityMetrics } from './quality';

export const VIDEO_LIMITS = { maxBytes: 32 * 1024 * 1024, maxDuration: 30.25, maxPixels: 3840 * 2160, maxSide: 4096, sampleFps: 4, maxFrames: 122, normalizedLongEdge: 640, analysisLongEdge: 320, previewCount: 12 };
export interface FrameAnalysis { timestampMs: number; seekPositionMs: number; metrics: QualityMetrics; warnings: string[]; preview?: string }
export interface VideoReport {
  version: 1;
  source: { container: 'WebM' | 'MP4'; mime: string; bytes: number; width: number; height: number; durationSeconds: number; durationSource: 'metadata' | 'seekable'; };
  normalized: { width: number; height: number; analysisWidth: number; analysisHeight: number; sampleFps: number; count: number; };
  frames: FrameAnalysis[];
  summary: { darkFrames: number; brightFrames: number; lowDetailFrames: number; averageBrightness: number; averageDifference: number | null; warnings: string[]; };
  processingMs: number;
  recognition: 'not_connected';
}
export interface ProcessingProgress { phase: string; completed: number; total: number }

function stopped(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('处理已取消。', 'AbortError');
}
function waitVideo(video: HTMLVideoElement, event: string, signal: AbortSignal, action?: () => void): Promise<void> {
  stopped(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, success); video.removeEventListener('error', failure); signal.removeEventListener('abort', abort); };
    const success = () => { cleanup(); resolve(); };
    const failure = () => { cleanup(); reject(new Error('视频无法解码，文件可能损坏或当前浏览器不支持该编码。')); };
    const abort = () => { cleanup(); reject(signal.reason || new DOMException('处理已取消。', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('视频读取或定位超时，请重新录制后再试。')); }, 8000);
    video.addEventListener(event, success, { once: true }); video.addEventListener('error', failure, { once: true }); signal.addEventListener('abort', abort, { once: true });
    try { action?.(); } catch (error) { cleanup(); reject(error); }
  });
}
export function frameTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration < 0.2 || duration > VIDEO_LIMITS.maxDuration) throw new Error('当前支持 0.2–30 秒的视频，请缩短后重试。');
  const end = Math.max(0, duration - 0.025);
  const values: number[] = [];
  for (let i = 0; i < Math.ceil(duration * VIDEO_LIMITS.sampleFps); i++) values.push(Math.min(i / VIDEO_LIMITS.sampleFps, end));
  if (end - values[values.length - 1] > 0.025) values.push(end);
  if (values.length > VIDEO_LIMITS.maxFrames) throw new Error('视频抽帧数量超出限制。');
  return [...new Set(values)];
}

// Duration only: no frame analysis, recognition, upload or training.
export async function readVideoDuration(blob:Blob,signal:AbortSignal):Promise<number>{
  stopped(signal);
  const video=document.createElement('video'),url=URL.createObjectURL(blob);
  video.muted=true;video.preload='auto';
  try{
    await waitVideo(video,'loadedmetadata',signal,()=>{video.src=url;});
    if(!Number.isFinite(video.duration)||video.duration<=0)await waitVideo(video,'seeked',signal,()=>{video.currentTime=1e10;});
    const duration=Number.isFinite(video.duration)?video.duration:video.seekable.length?video.seekable.end(video.seekable.length-1):NaN;
    if(!Number.isFinite(duration)||duration<=0||duration>31)throw new Error('无法确认录像实际时长，请重新载入或重新录制。');
    return Math.round(duration*1000)/1000;
  }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
function sizeWithin(width: number, height: number, edge: number) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(3, Math.round(width * scale)), height: Math.max(3, Math.round(height * scale)) };
}

export async function preprocessVideo(blob: Blob, signal: AbortSignal, progress: (value: ProcessingProgress) => void): Promise<VideoReport> {
  stopped(signal);
  if (!blob.size) throw new Error('视频为空，请重新录制。');
  if (blob.size > VIDEO_LIMITS.maxBytes) throw new Error('当前视频上限为 32 MB，请缩短或降低录制分辨率。');
  const header = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  stopped(signal);
  const webm = header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
  const mp4 = String.fromCharCode(...header.slice(4, 8)) === 'ftyp';
  if (!webm && !mp4) throw new Error('请选择 WebM 或 MP4 视频；不能只修改文件后缀。');
  const started = performance.now();
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;pointer-events:none;';
  document.body.appendChild(video);
  const url = URL.createObjectURL(blob);
  let worker: Worker | undefined;
  try {
    progress({ phase: '读取视频信息', completed: 0, total: 0 });
    await waitVideo(video, 'loadedmetadata', signal, () => { video.src = url; });
    const width = video.videoWidth, height = video.videoHeight;
    if (width < 16 || height < 16 || width > VIDEO_LIMITS.maxSide || height > VIDEO_LIMITS.maxSide || width * height > VIDEO_LIMITS.maxPixels) throw new Error('视频尺寸不支持，请使用不高于 4K 的正常画面。');
    let duration = video.duration;
    let durationSource: VideoReport['source']['durationSource'] = 'metadata';
    // MediaRecorder WebM may lack duration. Let the browser seek to the actual end,
    // never substitute the UI recording timer or silently assume a duration.
    if (!Number.isFinite(duration) || duration <= 0) {
      await waitVideo(video, 'seeked', signal, () => { video.currentTime = 1e10; });
      duration = video.duration;
      if (!Number.isFinite(duration) && video.seekable.length) { duration = video.seekable.end(video.seekable.length - 1); durationSource = 'seekable'; }
    }
    const timestamps = frameTimes(duration);
    if (video.readyState < 2) await waitVideo(video, 'loadeddata', signal);
    const normalized = sizeWithin(width, height, VIDEO_LIMITS.normalizedLongEdge);
    const analysis = sizeWithin(width, height, VIDEO_LIMITS.analysisLongEdge);
    const canvas = document.createElement('canvas'); canvas.width = normalized.width; canvas.height = normalized.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    const metricCanvas = document.createElement('canvas'); metricCanvas.width = analysis.width; metricCanvas.height = analysis.height;
    const metricCtx = metricCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    const thumb = document.createElement('canvas'); const thumbSize = sizeWithin(width, height, 240); thumb.width = thumbSize.width; thumb.height = thumbSize.height;
    const thumbCtx = thumb.getContext('2d', { alpha: false });
    if (!ctx || !metricCtx || !thumbCtx) throw new Error('浏览器无法创建画面处理画布。');
    worker = new Worker(new URL('./quality.worker.ts', import.meta.url), { type: 'module' });
    const analyzer = worker;
    function measure(pixels: ImageData): Promise<{ metrics: QualityMetrics; warnings: string[] }> {
      stopped(signal);
      return new Promise((resolve, reject) => {
        const clear = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); analyzer.onmessage = null; analyzer.onerror = null; };
        const abort = () => { clear(); reject(signal.reason || new DOMException('处理已取消。', 'AbortError')); };
        const timer = setTimeout(() => { clear(); reject(new Error('画面分析超时，请重试。')); }, 5000);
        signal.addEventListener('abort', abort, { once: true });
        analyzer.onmessage = event => { clear(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data); };
        analyzer.onerror = event => { event.preventDefault(); clear(); reject(new Error('画面分析线程启动失败，请刷新页面后重试。')); };
        analyzer.postMessage({ rgba: pixels.data.buffer, width: pixels.width, height: pixels.height }, [pixels.data.buffer]);
      });
    }
    const previews = new Set<number>();
    for (let i = 0; i < Math.min(VIDEO_LIMITS.previewCount, timestamps.length); i++) previews.add(Math.round(i * (timestamps.length - 1) / Math.max(1, Math.min(VIDEO_LIMITS.previewCount, timestamps.length) - 1)));
    const frames: FrameAnalysis[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      stopped(signal);
      const time = timestamps[i];
      if (Math.abs(video.currentTime - time) > 0.00001) await waitVideo(video, 'seeked', signal, () => { video.currentTime = time; });
      if (video.readyState < 2) await waitVideo(video, 'loadeddata', signal);
      stopped(signal);
      ctx.drawImage(video, 0, 0, normalized.width, normalized.height);
      metricCtx.drawImage(canvas, 0, 0, analysis.width, analysis.height);
      const measured = await measure(metricCtx.getImageData(0, 0, analysis.width, analysis.height));
      let preview: string | undefined;
      if (previews.has(i)) { thumbCtx.drawImage(canvas, 0, 0, thumb.width, thumb.height); preview = thumb.toDataURL('image/jpeg', 0.78); }
      frames.push({ timestampMs: Math.round(time * 1000), seekPositionMs: Math.round(video.currentTime * 1000), ...measured, preview });
      progress({ phase: '按时间抽帧并分析画面', completed: i + 1, total: timestamps.length });
    }
    const count = frames.length;
    const darkFrames = frames.filter(f => f.warnings.includes('画面偏暗')).length;
    const brightFrames = frames.filter(f => f.warnings.includes('画面偏亮')).length;
    const lowDetailFrames = frames.filter(f => f.warnings.includes('纹理较少或可能模糊')).length;
    const changes = frames.flatMap(f => f.metrics.frameDifference === null ? [] : [f.metrics.frameDifference]);
    const averageDifference = changes.length ? Math.round(changes.reduce((a, b) => a + b, 0) / changes.length * 100) / 100 : null;
    const warnings: string[] = [];
    if (darkFrames) warnings.push(`${darkFrames} 个采样画面偏暗，建议检查正面光线。`);
    if (brightFrames) warnings.push(`${brightFrames} 个采样画面偏亮，建议避免强光或过曝。`);
    if (lowDetailFrames) warnings.push(`${lowDetailFrames} 个采样画面纹理较少或可能模糊，需结合预览人工判断。`);
    if (averageDifference !== null && averageDifference < QUALITY_THRESHOLDS.lowChange) warnings.push('采样画面变化较少，可能是静止或停顿；系统没有删除这些画面。');
    stopped(signal);
    return { version: 1, source: { container: webm ? 'WebM' : 'MP4', mime: blob.type || '未提供 MIME', bytes: blob.size, width, height, durationSeconds: Math.round(duration * 1000) / 1000, durationSource }, normalized: { ...normalized, analysisWidth: analysis.width, analysisHeight: analysis.height, sampleFps: VIDEO_LIMITS.sampleFps, count }, frames, summary: { darkFrames, brightFrames, lowDetailFrames, averageBrightness: Math.round(frames.reduce((sum, f) => sum + f.metrics.brightness, 0) / count * 100) / 100, averageDifference, warnings }, processingMs: Math.round(performance.now() - started), recognition: 'not_connected' };
  } finally {
    worker?.terminate(); video.pause(); video.removeAttribute('src'); video.load(); video.remove(); URL.revokeObjectURL(url);
  }
}
