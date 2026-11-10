export function encodePcmWav(samples: Float32Array, sampleRate = 16000): Blob {
  const data = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(data);
  const ascii = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
  ascii(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return new Blob([data], { type: 'audio/wav' });
}

/** Decode browser-specific recording codecs locally; send only mono PCM to the local server. */
export async function recordingToWav(recording: Blob): Promise<Blob> {
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try { decoded = await context.decodeAudioData(await recording.arrayBuffer()); }
  catch { throw new Error('当前录音格式无法解码，请换一个浏览器或重新录音。'); }
  finally { await context.close(); }
  if (!Number.isFinite(decoded.duration) || decoded.duration < 0.2 || decoded.duration > 30.25) throw new Error('请录制 0.2–30 秒的语音后重试。');
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination); source.start();
  const rendered = await offline.startRendering();
  return encodePcmWav(rendered.getChannelData(0));
}
