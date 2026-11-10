import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

function failure(message, status = 503) { return Object.assign(new Error(message), { status }); }
export function validatePcmWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE' || buffer.readUInt32LE(4) + 8 !== buffer.length) throw failure('音频格式无效，请重新录音。', 415);
  let offset = 12, format = false, bytes = null;
  while (offset + 8 <= buffer.length) {
    const kind = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + length > buffer.length) throw failure('音频不完整，请重新录音。', 415);
    if (kind === 'fmt ') {
      if (length < 16 || buffer.readUInt16LE(offset) !== 1 || buffer.readUInt16LE(offset + 2) !== 1 || buffer.readUInt32LE(offset + 4) !== 16000 || buffer.readUInt32LE(offset + 8) !== 32000 || buffer.readUInt16LE(offset + 12) !== 2 || buffer.readUInt16LE(offset + 14) !== 16) throw failure('音频需转换为单声道 16 kHz PCM。', 415);
      format = true;
    }
    if (kind === 'data') { if (bytes !== null) throw failure('音频格式无效。', 415); bytes = length; }
    offset += length + length % 2;
  }
  if (!format || bytes === null || bytes % 2 || bytes < 6400 || bytes > 968000) throw failure('录音需为 0.2–30 秒，请重新录制。', 422);
  return bytes / 32000;
}

export class SpeechService {
  constructor(root) { this.root = root; this.child = null; this.ready = false; this.busy = false; this.starting = null; this.pending = null; }
  installed() {
    try {
      const manifest = JSON.parse(readFileSync(resolve(this.root, 'models/speech-manifest.json'), 'utf8'));
      const directory = resolve(this.root, manifest.model_dir);
      return directory.startsWith(resolve(this.root, 'models') + sep) && existsSync(resolve(directory, manifest.model)) && existsSync(resolve(directory, manifest.tokens)) && existsSync(this.python());
    } catch { return false; }
  }
  python() { return process.env.SPEECH_PYTHON || resolve(this.root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python'); }
  status() { return { available: this.installed(), ready: this.ready, busy: this.busy, language: 'zh', engine: 'SenseVoice Small INT8', processing: 'local', max_seconds: 30 }; }
  ensureReady() {
    if (this.ready) return Promise.resolve();
    if (this.starting) return this.starting;
    if (!this.installed()) return Promise.reject(failure('本机中文语音识别环境尚未就绪。'));
    this.starting = new Promise((resolveReady, rejectReady) => {
      const child = spawn(this.python(), ['-u', resolve(this.root, 'server/speech_worker.py')], { cwd: this.root, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONPYCACHEPREFIX: resolve(this.root, '.runtime-logs/pycache') }, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      this.child = child;
      const lines = createInterface({ input: child.stdout });
      const timeout = setTimeout(() => { rejectReady(failure('语音模型加载超时，请重试。')); child.kill(); }, 45000);
      const fail = () => {
        clearTimeout(timeout); lines.close();
        if (this.child === child) {
          this.child = null; this.ready = false; this.starting = null;
          this.pending?.reject(failure('语音识别中断，请重新尝试。'));
          this.pending = null;
        }
        rejectReady(failure('本机语音识别服务未能启动，请重试。'));
      };
      child.on('error', fail); child.on('exit', fail);
      child.stdin.on('error', () => child.kill());
      lines.on('line', line => {
        let result;
        try { result = JSON.parse(line); } catch { return; }
        if (result.type === 'ready') { clearTimeout(timeout); this.ready = true; resolveReady(); return; }
        if (result.type === 'startup_error') { child.kill(); return; }
        if (result.id && result.id === this.pending?.id) {
          if (result.error) this.pending.reject(failure('这段录音未能识别，请重录或改用文字。', 422));
          else this.pending.resolve({ status: result.status, text: result.text, processing_ms: result.processing_ms, requires_confirmation: result.status === 'transcribed', engine: 'SenseVoice Small INT8' });
          this.pending = null;
        }
      });
    }).catch(error => { this.starting = null; throw error.status ? error : failure('本机语音识别进程无法启动，请检查运行环境。'); });
    return this.starting;
  }
  async transcribe(buffer, signal) {
    validatePcmWav(buffer);
    if (this.busy) throw failure('另一段录音正在处理，请稍后重试。', 429);
    if (signal?.aborted) throw failure('识别已取消。', 499);
    this.busy = true;
    let timeout;
    const abort = () => { this.pending?.reject(failure('识别已取消。', 499)); this.pending = null; this.ready = false; this.starting = null; this.child?.kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await this.ensureReady();
      if (signal?.aborted) throw failure('识别已取消。', 499);
      return await new Promise((resolveResult, rejectResult) => {
        const id = randomUUID();
        this.pending = { id, resolve: resolveResult, reject: rejectResult };
        timeout = setTimeout(() => { this.pending = null; this.ready = false; this.starting = null; rejectResult(failure('识别时间过长，请缩短录音后重试。', 504)); this.child?.kill(); }, 45000);
        this.child.stdin.write(JSON.stringify({ id, audio: buffer.toString('base64') }) + '\n');
      });
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); this.busy = false; }
  }
  close() { this.pending?.reject(failure('语音服务已停止。')); this.pending = null; this.child?.kill(); }
}
