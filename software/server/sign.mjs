import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { recordSignDiagnostics } from './sign-diagnostics.mjs';
import { signCatalog } from '../shared/sign-catalog.mjs';
import {recordingConfig,recordingEntries,recordingBundle,recordingSnapshot,validateRecordingResult} from './recording-catalog.mjs';

const failure = (message, status = 503) => Object.assign(new Error(message), { status });
export function validateSequenceResult(result){
  if(result.kind!=='segmented-sign-sequence'||!['complete','partial','no_hands'].includes(result.status)||!Array.isArray(result.segments)||result.segments.length>10||!Number.isFinite(result.duration_seconds)||result.duration_seconds<=0||result.duration_seconds>30.25)throw Error('Bad sequence');
  let end=-1,unresolved=0;
  for(const [i,s] of result.segments.entries()){
    if(s.index!==i+1||!Number.isFinite(s.start_seconds)||!Number.isFinite(s.end_seconds)||s.start_seconds<0||s.start_seconds<end||s.end_seconds<=s.start_seconds||s.end_seconds>result.duration_seconds+.01||!['candidate','uncertain','unsupported'].includes(s.status))throw Error('Bad segment');
    end=s.end_seconds;
    if(s.status==='candidate'){if(!signCatalog.entries.some(e=>e.text===s.candidate))throw Error('Bad candidate');}
    else{unresolved++;if(s.candidate!==null)throw Error('Uncertain segment must not guess');}
  }
  if(result.unresolved_count!==unresolved)throw Error('Bad unresolved count');
  if(result.status==='complete'){if(result.segments.length<2||unresolved||result.text!==result.segments.map(s=>s.candidate).join('，'))throw Error('Incomplete sequence cannot speak');}
  else if(result.text!==''||result.status==='no_hands'&&result.segments.length||result.status==='partial'&&!unresolved)throw Error('Bad partial result');
}
export function validateSignVideo(buffer, mime) {
  if (!['video/webm', 'video/mp4'].includes(mime)) throw failure('实验仅支持 WebM 或 MP4 视频。', 415);
  if (buffer.length > 32 * 1024 * 1024) throw failure('视频不能超过 32 MB。', 413);
  const valid = mime === 'video/webm' ? buffer.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) : buffer.subarray(4, 8).toString() === 'ftyp';
  if (buffer.length < 32 || !valid) throw failure('视频内容无效，不能只修改文件后缀。', 415);
}

export class SignService {
  constructor(root, { diagnosticDir = null } = {}) { this.root = root; this.diagnosticDir = diagnosticDir; this.busy = false; this.child = null; }
  python() { return resolve(this.root, process.platform === 'win32' ? '.venv-sign/Scripts/python.exe' : '.venv-sign/bin/python'); }
  installed() { try{if(!existsSync(this.python()))return false;recordingBundle(this.root);return true;}catch{return false;} }
  status() { return { available: this.installed(), busy: this.busy, engine: 'Web realtime four-word replay', labels: recordingEntries.map(entry=>entry.text), catalog_version:recordingConfig.id, max_seconds: recordingConfig.maxSeconds, sequence_available:false, sequence_retired:true, experimental: true, standard_validated: false, diagnostic_version: 4 }; }
  workerScript() { return 'server/recording_worker.py'; }
  timeoutMs() { return recordingConfig.timeoutMs; }
  tempRoot() { return resolve(this.root, '.runtime-logs/sign-tmp'); }
  workerEnvironment(temp) { return { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONPYCACHEPREFIX: resolve(this.root, '.runtime-logs/pycache'), TEMP: temp, TMP: temp, KERAS_HOME: resolve(this.root, '.runtime-logs/keras'), MPLCONFIGDIR: resolve(this.root, '.runtime-logs/matplotlib'), TF_CPP_MIN_LOG_LEVEL: '3', CUDA_VISIBLE_DEVICES: '-1' }; }
  async recognize(buffer, mime, signal, {sequence=false,models=[]}={}) {
    validateSignVideo(buffer, mime);
    if(sequence)throw failure('多动作分段识别已停用，请使用单动作录像复核。',410);
    if (this.busy) throw failure('另一个动作实验正在处理，请稍后重试。', 429);
    if (!this.installed()) throw failure('动作实验模型环境尚未就绪。');
    if (signal?.aborted) throw failure('动作识别已取消。', 499);
    this.busy = true;
    let directory;
    try {
      const bundle=recordingBundle(this.root);
      const temp = this.tempRoot();
      await mkdir(temp, { recursive: true });
      directory = await mkdtemp(join(temp, 'job-'));
      const file = join(directory, mime === 'video/webm' ? 'input.webm' : 'input.mp4');
      await writeFile(file, buffer);
      if (signal?.aborted) throw failure('动作识别已取消。', 499);
      const result = await new Promise((resolveResult, rejectResult) => {
        let output = '', failureReason;
        const child = spawn(this.python(), ['-u', resolve(this.root, this.workerScript()), file,...(models.length?[JSON.stringify(models)]:[]),...(sequence?['--sequence']:[])], {
          cwd: this.root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
          env: this.workerEnvironment(temp),
        });
        this.child = child;
        child.stdout.setEncoding('utf8');
        const abort = () => { failureReason = failure('动作识别已取消。', 499); child.kill(); };
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => { failureReason = failure('处理超时，请缩短视频后重试。', 504); child.kill(); }, this.timeoutMs(sequence));
        child.stdout.on('data', data => { output += data.toString('utf8'); if (output.length > 65536) { failureReason = failure('模型返回格式异常。'); child.kill(); } });
        child.on('error', () => { failureReason = failure('动作识别进程未能启动。'); });
        child.on('close', code => {
          clearTimeout(timer); signal?.removeEventListener('abort', abort); this.child = null;
          if (failureReason) return rejectResult(failureReason);
          try {
            const result = JSON.parse(output.trim());
            if (result.error) return rejectResult(failure(result.error, result.status || 422));
            if (code || !(sequence?['complete','partial','no_hands']:['candidate', 'uncertain', 'no_hands', 'unsupported']).includes(result.status)) throw Error('Bad result');
            validateRecordingResult(result,models);
            if(result.pipeline_sha256!==bundle.sha256)throw Error('Recording pipeline changed');
            resolveResult(result);
          } catch { rejectResult(failure('模型未能完成处理，请重试。')); }
        });
        if (signal?.aborted) abort();
      });
      if (signal?.aborted) throw failure('动作识别已取消。', 499);
      if(recordingBundle(this.root).sha256!==bundle.sha256)throw failure('模型或规则在识别期间更新，请重新识别；原录像已保留。',409);
      const custom=models.find(m=>m.text===result.candidate);
      result.modelSnapshot=custom?{modelId:custom.signId,modelVersion:custom.path.split(/[\\/]/).at(-2),modelSha256:custom.sha256,featureId:'self-service-body178-v1',pipelineId:bundle.id,pipelineSha256:bundle.sha256}:recordingSnapshot(bundle,result.candidate);
      if (this.diagnosticDir) {
        try { result.diagnostic_id = await recordSignDiagnostics(this.diagnosticDir, result); result.diagnostic_saved = true; }
        catch { result.diagnostic_saved = false; }
      }
      return result;
    } finally {
      // Directory is generated by mkdtemp under this project's private temp root.
      try { if (directory) await rm(directory, { recursive: true, force: true }); }
      finally { this.busy = false; }
    }
  }
  close() { this.child?.kill(); }
}
