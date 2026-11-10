import { createServer } from 'node:http';
import { DatabaseSync } from './database.mjs';
import { randomBytes, randomUUID, createHash, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, writeFile, unlink, stat, readFile } from 'node:fs/promises';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpeechService, validatePcmWav } from './speech.mjs';
import { SignService } from './sign.mjs';
import { signCatalog } from '../shared/sign-catalog.mjs';
import { resolveInputPreview } from '../shared/sign-preview.mjs';
import { LocalLanguageService } from './local-language.mjs';
import { TtsService } from './tts.mjs';
import {QwenUserKeys} from './qwen-user-keys.mjs';
import {CaptchaStore} from './captcha.mjs';
import {TrainingStore} from './training-store.mjs';
import { VoiceService } from './voice.mjs';
import { createPracticeStore } from './practice.mjs';
import { createSampleStore } from './samples.mjs';
import { RealtimeSignService,liveConfig,liveTargets } from './realtime.mjs';
import {removeArchivedRecord} from './training-archive.mjs';
import {loadHelpModelReview,removeHelpModelReview} from './help-model-review.mjs';
import {recordingConfig,recordingEntries,recordingBundle,recordingSnapshot} from './recording-catalog.mjs';

const scrypt = promisify(deriveKey);
const developmentActions=JSON.parse(readFileSync(new URL('../shared/sign-development-actions.json',import.meta.url),'utf8')).actions;
const motionCatalog = JSON.parse(readFileSync(new URL('../shared/sign-motion-catalog.json', import.meta.url), 'utf8'));
const dictionarySource=readFileSync(new URL('../shared/sign-dictionary.json',import.meta.url),'utf8');
if (motionCatalog.schemaVersion !== 1 || motionCatalog.rig !== 'anny-makehuman' || !Array.isArray(motionCatalog.entries) || new Set(motionCatalog.entries.map(e => e.id)).size !== motionCatalog.entries.length || motionCatalog.entries.some(e => !/^csl\.[a-z0-9_.-]+$/.test(e.id) || typeof e.label !== 'string' || !e.label.trim() || e.reviewRequired !== true)) throw new Error('Invalid motion catalog');
const SESSION_AGE = 7 * 24 * 60 * 60;
const MAX_VIDEO = 32 * 1024 * 1024;
const MAX_USER_BYTES = 256 * 1024 * 1024;
const MAX_AVATAR = 2 * 1024 * 1024;
const MAX_VOICE_SAMPLE = 1_000_000;
const AVATAR_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function readBody(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw new HttpError(413, '内容过大，请缩短后重试。');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, '内容过大，请缩短后重试。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, '请求格式不支持。');
  try { return JSON.parse((await readBody(req, 16384)).toString()); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, '请求格式不正确。'); }
}
function textValue(value, limit = 2000) {
  if (typeof value !== 'string' || value.trim().length > limit) throw new HttpError(400, `文字不能超过 ${limit} 字。`);
  return value.trim();
}

/** Local service: private media never lives in Vite's public directory. */
export async function createApp({ dataDir, publicDir, speechService, signService, realtimeService, ttsService, qwenKeyStore, voiceService, languageService, captchaService, origins = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173'] }) {
  const root = resolve(dataDir);
  const captcha=captchaService||new CaptchaStore();
  const captchaCookie=req=>/(?:^|;\s*)yuqiao_captcha=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
  const mediaDir = join(root, 'media');
  const avatarDir = join(root, 'avatars');
  const voiceDir = join(root, 'voices');
  const projectRoot = fileURLToPath(new URL('../',import.meta.url));
  const speech = speechService || new SpeechService(projectRoot);
  const diagnosticDir = root === resolve(projectRoot, 'data') ? resolve(projectRoot, '.runtime-logs/sign-diagnostics') : join(root, 'sign-diagnostics');
  const sign = signService || new SignService(projectRoot, { diagnosticDir });
  const realtime=realtimeService||new RealtimeSignService(projectRoot);
  const qwenKeys=qwenKeyStore||new QwenUserKeys(root);
  const tts=ttsService || new TtsService(projectRoot,{configLoader:(base,userId)=>qwenKeys.config(base,userId)});
  const voice=voiceService || new VoiceService(projectRoot);
  const language=languageService || new LocalLanguageService();
  await mkdir(mediaDir, { recursive: true });
  await mkdir(avatarDir, { recursive: true });
  await mkdir(voiceDir, { recursive: true });
  const db = new DatabaseSync(join(root, 'app.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('text','video')), text TEXT NOT NULL, media_file TEXT, mime TEXT, byte_length INTEGER NOT NULL DEFAULT 0, duration REAL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, email TEXT, phone TEXT, avatar_file TEXT, avatar_mime TEXT, active_voice_id TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS voices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, sample_file TEXT NOT NULL, ref_text TEXT NOT NULL, name TEXT NOT NULL, note TEXT, duration REAL NOT NULL, revision INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed')), created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS records_user_time ON records(user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS voices_user_time ON voices(user_id,created_at DESC);`);
  const practice=createPracticeStore(db,{signCatalog:{entries:recordingEntries},motionCatalog,dictionaryVersion:JSON.parse(dictionarySource).updated,dictionaryHash:digest(dictionarySource),snapshotForResult:result=>result.modelSnapshot??recordingSnapshot(recordingBundle(projectRoot),result.candidate),additionalEntriesForUser:id=>training.active(id).map(x=>({id:x.signId,text:x.text}))});
  const samples=createSampleStore(db);
  const training=new TrainingStore({dataDir:root,projectRoot,db});
  db.exec(`CREATE TABLE IF NOT EXISTS video_save_keys (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    save_key TEXT NOT NULL, record_id TEXT REFERENCES records(id) ON DELETE SET NULL,
    content_hash TEXT NOT NULL, request_hash TEXT NOT NULL,
    PRIMARY KEY(user_id,save_key));`);

  // A voice only becomes selectable after its owner confirms it sounds right, and an
  // account keeps exactly one active voice. Older shapes are rebuilt once on startup.
  if (!db.prepare('PRAGMA table_info(profiles)').all().some(column => column.name === 'active_voice_id')) {
    db.exec('ALTER TABLE profiles ADD COLUMN active_voice_id TEXT');
  }
  const voiceColumns = db.prepare('PRAGMA table_info(voices)').all().map(column => column.name);
  if (voiceColumns.length && (!voiceColumns.includes('id') || !voiceColumns.includes('status'))) {
    const legacy = db.prepare('SELECT * FROM voices').all();
    db.exec('DROP TABLE voices');
    db.exec(`CREATE TABLE voices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, sample_file TEXT NOT NULL, ref_text TEXT NOT NULL, name TEXT NOT NULL, note TEXT, duration REAL NOT NULL, revision INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed')), created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS voices_user_time ON voices(user_id,created_at DESC);`);
    const insert = db.prepare('INSERT INTO voices (id,user_id,sample_file,ref_text,name,note,duration,revision,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    // Anything carried over was already in use, so it stays usable rather than silently losing access.
    for (const row of legacy) insert.run(randomUUID(), row.user_id, row.sample_file, row.ref_text, row.name, row.note ?? null, row.duration, row.revision ?? 1, 'confirmed', row.created_at);
  }
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  const throttle = new Map();
  const dummySalt = randomBytes(16).toString('hex');
  const dummyHash = await scrypt('not-a-real-password', dummySalt, 64);
  function cookieToken(req) {
    return /(?:^|;\s*)yuqiao_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  }
  function userFor(req) {
    const token = cookieToken(req);
    if (!token) return null;
    return db.prepare('SELECT users.id, users.display_name AS username FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now()) || null;
  }
  function requireUser(req) {
    const user = userFor(req);
    if (!user) throw new HttpError(401, '请先登录，再保存或查看记录。');
    return user;
  }
  function profileOf(userId) {
    const row = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(userId);
    return {
      email: row?.email || null,
      phone: row?.phone || null,
      avatar: row?.avatar_file ? `/api/profile/avatar?v=${encodeURIComponent(row.updated_at)}` : null,
    };
  }
  function saveProfile(userId, changes) {
    const current = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(userId);
    const next = {
      email: current?.email ?? null, phone: current?.phone ?? null,
      avatar_file: current?.avatar_file ?? null, avatar_mime: current?.avatar_mime ?? null,
      active_voice_id: current?.active_voice_id ?? null,
      ...changes,
    };
    db.prepare(`INSERT INTO profiles (user_id,email,phone,avatar_file,avatar_mime,active_voice_id,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET email=excluded.email, phone=excluded.phone,
      avatar_file=excluded.avatar_file, avatar_mime=excluded.avatar_mime,
      active_voice_id=excluded.active_voice_id, updated_at=excluded.updated_at`)
      .run(userId, next.email, next.phone, next.avatar_file, next.avatar_mime, next.active_voice_id, Date.now());
  }
  function voiceView(row) {
    return {
      id: row.id, name: row.name, note: row.note || null,
      ref_text: row.ref_text, duration: row.duration,
      revision: row.revision, status: row.status, created_at: row.created_at,
      sample_available: existsSync(join(voiceDir, row.sample_file)),
    };
  }
  function voicesOf(userId) {
    return db.prepare('SELECT * FROM voices WHERE user_id=? ORDER BY created_at DESC, id DESC').all(userId).map(voiceView);
  }
  function voiceOwned(userId, id) {
    return db.prepare('SELECT * FROM voices WHERE id=? AND user_id=?').get(String(id), userId) || null;
  }
  /** Only a confirmed voice can be spoken with; a pending one must be verified first. */
  function activeVoice(userId) {
    const activeId = db.prepare('SELECT active_voice_id FROM profiles WHERE user_id=?').get(userId)?.active_voice_id;
    if (!activeId) return null;
    const row = voiceOwned(userId, activeId);
    return row && row.status === 'confirmed' ? row : null;
  }
  function setSession(req, res, userId) {
    const old = cookieToken(req);
    if (old) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(old));
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), userId, Date.now() + SESSION_AGE * 1000);
    res.setHeader('Set-Cookie', `yuqiao_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_AGE}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
  }
  function checkRate(req, username) {
    const now = Date.now();
    for (const [key, entry] of throttle) if (entry.until < now) throttle.delete(key);
    const keys = [req.socket.remoteAddress || 'local', `account:${username}`];
    for (const key of keys) {
      const entry = throttle.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
      entry.count++;
      throttle.set(key, entry);
      if (entry.count > (key.startsWith('account:') ? 15 : 60)) throw new HttpError(429, '尝试次数较多，请稍后再试。');
    }
  }
  function checkQuota(userId, bytes) {
    const usage = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(byte_length),0) AS bytes FROM records WHERE user_id=?').get(userId);
    if (usage.count >= 1000 || usage.bytes + bytes > MAX_USER_BYTES) throw new HttpError(409, '保存空间已满，请先删除不需要的记录。');
  }
  const columns = 'id, kind, text, mime, byte_length, duration, created_at';
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      const url = new URL(req.url, 'http://localhost');
      const method = req.method;
      if (!['GET', 'HEAD'].includes(method)) {
        if (!origins.includes(req.headers.origin) || req.headers['x-yuqiao-request'] !== '1') throw new HttpError(403, '请求来源无效，请从语桥页面操作。');
      }
      if (url.pathname === '/api/health' && method === 'GET') return send(res, 200, { ok: true, service: 'yuqiao', database: db.engine, workspace: digest(resolve(publicDir)).slice(0, 16), origins });
      if(url.pathname.startsWith('/api/training/')){
        const user=requireUser(req);
        if(url.pathname==='/api/training/dictionary'&&method==='GET')return send(res,200,training.dictionary(url.searchParams.get('q')||'',url.searchParams.get('category')||'',Number(url.searchParams.get('page')||0),user.id));
        if(url.pathname==='/api/training/state'&&method==='GET')return send(res,200,training.publicState(user.id));
        if(url.pathname==='/api/training/sources'&&method==='GET')return send(res,200,{sources:training.sources(user.id)});
        if(url.pathname==='/api/training/actions'&&method==='POST')return send(res,201,training.mutate(user.id,null,await readJson(req)));
        const action=/^\/api\/training\/actions\/([a-f0-9-]{36})(?:\/(jobs|activate))?$/.exec(url.pathname);
        if(action&&method==='POST'){const body=await readJson(req);return send(res,200,action[2]==='jobs'?training.start(user.id,action[1],body.kind):action[2]==='activate'?training.activate(user.id,action[1],body.version):training.mutate(user.id,action[1],body));}
        const job=/^\/api\/training\/jobs\/([a-f0-9-]{36})\/cancel$/.exec(url.pathname);
        if(job&&method==='POST')return send(res,200,training.cancel(user.id,job[1]));
        throw new HttpError(404,'训练接口不存在。');
      }
      if (url.pathname === '/api/speech/status' && method === 'GET') return send(res, 200, speech.status());
      if (url.pathname === '/api/sign/status' && method === 'GET') return send(res, 200, {...sign.status(),labels:[...recordingEntries.map(e=>e.text),...training.active(userFor(req)?.id).map(e=>e.text)]});
      if(url.pathname==='/api/sign/realtime/status'&&method==='GET')return send(res,200,{...realtime.status(),labels:[...Object.values(liveTargets).map(x=>x.text),...training.active(userFor(req)?.id).map(x=>x.text)]});
      if(url.pathname==='/api/sign/help-model-review'&&method==='GET'){
        const user=requireUser(req);const result=await loadHelpModelReview({db,dataDir:root,projectRoot,userId:user.id});
        if(userFor(req)?.id!==user.id)throw new HttpError(401,'登录已失效，请重新登录。');
        return send(res,200,result);
      }
      if(url.pathname==='/api/sign/realtime/sessions'&&method==='POST'){
        const body=await readJson(req);if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['target','helpEngine'].includes(k))||(body.target!==undefined&&!['auto','thanks','help'].includes(body.target))||(body.helpEngine!==undefined&&(body.target!=='help'||!['video-tcn','geometry'].includes(body.helpEngine))))throw new HttpError(400,'启动参数无效。');
        const controller=new AbortController(),cancel=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancel);
        try{const result=await realtime.start(controller.signal,body.target??'auto',body.helpEngine,{models:training.active(userFor(req)?.id),ownerId:userFor(req)?.id??null});if(res.destroyed){realtime.stop(result.session);return;}return send(res,201,result);}finally{res.off('close',cancel);}
      }
      if(url.pathname==='/api/sign/realtime/sessions'&&method==='DELETE')return send(res,200,realtime.stop(req.headers['x-yuqiao-live-session']));
      if(url.pathname==='/api/sign/realtime/frames'&&method==='POST'){
        const liveSession=realtime.owned?.(req.headers['x-yuqiao-live-session']);if(liveSession?.models?.length&&liveSession.ownerId!==userFor(req)?.id){realtime.stop(req.headers['x-yuqiao-live-session']);throw new HttpError(401,'账号已变化，请重新开启识别。');}
        if(req.headers['content-type']!=='image/jpeg')throw new HttpError(415,'实时画面仅支持JPEG。');
        const frame=await readBody(req,liveConfig.maxJpegBytes);
        const controller=new AbortController(),cancel=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancel);
        try{const result=await realtime.frame(req.headers['x-yuqiao-live-session'],frame,Number(req.headers['x-yuqiao-frame-seq']),Number(req.headers['x-yuqiao-capture-ms']),controller.signal);if(!res.destroyed)return send(res,200,result);return;}finally{res.off('close',cancel);}
      }
      if (url.pathname === '/api/profile/tts-key' && ['GET','PUT','DELETE'].includes(method)) {
        const user=requireUser(req);
        if(method==='GET')return send(res,200,await qwenKeys.status(user.id));
        const result=method==='PUT'?await qwenKeys.save(user.id,(await readJson(req)).apiKey):await qwenKeys.remove(user.id);
        tts.cancelUser?.(user.id);
        return send(res,200,result);
      }
      if (url.pathname === '/api/tts/status' && method === 'GET') return send(res,200,await tts.status(userFor(req)?.id));
      if (url.pathname === '/api/tts/synthesize' && method === 'POST') {
        const body=await readJson(req);
        const controller=new AbortController(); const cancel=()=>controller.abort();
        res.on('close',cancel);
        try {
          if (body.voice === 'personal') {
            if (voice.status().retired) throw new HttpError(410, '本地个人音色已停用，请使用千问音色。');
            const user = requireUser(req);
            // Settings must be able to preview any confirmed voice of the account — otherwise a
            // freshly recorded voice could never be heard before being activated. Ownership and
            // the confirmed gate are what matter; "currently active" only decides the default.
            const row = body.voice_id ? voiceOwned(user.id, String(body.voice_id)) : activeVoice(user.id);
            if (!row) throw new HttpError(409, body.voice_id ? '找不到这个音色，它可能已被删除。' : '还没有已启用的个人音色，请到“账号设置 → 我的音色”里确认并选用一个。');
            if (row.status !== 'confirmed') throw new HttpError(409, '这个音色还没有确认。请先在“账号设置 → 我的音色”里试听，确认后才能用于播报。');
            if (body.voice_revision !== undefined && Number(body.voice_revision) !== row.revision) throw new HttpError(409, '个人音色已更新，请重新生成语音。');
            const result = await voice.synthesize({
              text: body.text, refAudioPath: join(voiceDir, row.sample_file),
              promptText: row.ref_text, speed: body.speed,
            }, controller.signal);
            if (!res.destroyed) return send(res, 200, { ...result, voice_name: row.name, voice_id: row.id, voice_revision: row.revision, revision: body.revision });
            return;
          }
          const result=await tts.synthesize(body,controller.signal,userFor(req)?.id);
          if(!res.destroyed)return send(res,200,result);
          return;
        }
        finally {res.off('close',cancel);}
      }
      if (url.pathname === '/api/sign/catalog' && method === 'GET') return send(res, 200, {version:recordingConfig.id,entries:[...recordingEntries,...training.active(userFor(req)?.id).map(x=>({id:x.signId,text:x.text,category:'self-trained'}))],capabilities:{singleActionClassification:'experimental',multipleActionsInOneVideo:'rejected',sameAsRealtime:true,defaultSpeech:'connected',signPlayback:'authored_unverified',personalVoice:'retired'}});
      if (url.pathname === '/api/sign/resolve' && method === 'POST') {
        const body=await readJson(req);
        const text=textValue(body.text,2000);
        if(body.mode!=='expression'&&body.mode!=='playback')return send(res,200,resolveInputPreview(text));
        const controller=new AbortController(),cancel=()=>controller.abort();
        res.on('close',cancel);
        try{
          const result=await language.resolve(text,controller.signal);
          if(!res.destroyed&&!controller.signal.aborted){
            if(body.mode==='playback'){
              // Backend diagnostics only: no original text, names or private media.
              console.info('Motion planning:',JSON.stringify({status:result.status,model:result.engine?.model,actions:result.expression?.steps.map(s=>s.id)??[],reason:result.reason??null}));
              return send(res,200,{status:result.status,preview:result.preview,reason:result.reason});
            }
            return send(res,200,result);
          }
          return;
        }
        finally{res.off('close',cancel);}
      }
      if (url.pathname === '/api/continuous/status' && method === 'GET') return send(res, 200, { available: false, retired: true, reason: 'Uni-Sign 已按用户要求删除；当前采用 MediaPipe 四词模型扩词路线。' });
      if (url.pathname === '/api/continuous/experiments' && method === 'POST') {
        throw new HttpError(410, '该模型已删除，请进入手语学习使用四词单动作识别。');
      }
      if (url.pathname === '/api/sign/sequences') throw new HttpError(410, '多动作录像识别已停用，请进入手语学习进行单动作练习。');
      if (url.pathname === '/api/sign/experiments' && method === 'POST') {
        const modelOwner=userFor(req)?.id,customModels=training.active(modelOwner);
        const recordId=req.headers['x-yuqiao-record-id'];
        let practiceUser=null,sourceRecord=null,sampleRevision=null;
        if(recordId!==undefined){
          practiceUser=requireUser(req);
          if(typeof recordId!=='string'||!/^[a-f0-9-]{36}$/.test(recordId))throw new HttpError(400,'录像编号无效。');
          sourceRecord=practice.record(practiceUser.id,recordId);
        }
        const mime = req.headers['content-type']?.split(';')[0];
        if (!['video/webm', 'video/mp4'].includes(mime)) throw new HttpError(415, '请选择 WebM 或 MP4 视频。');
        const video = await readBody(req, MAX_VIDEO);
        if(sourceRecord){
          if(sourceRecord.mime!==mime||sourceRecord.byte_length!==video.length)throw new HttpError(409,'本次识别内容与保存的录像不一致。');
          let original;try{original=await readFile(join(mediaDir,sourceRecord.media_file));}catch{throw new HttpError(404,'录像文件已删除或不可用。');}
          if(!original.equals(video))throw new HttpError(409,'本次识别内容与保存的录像不一致。');
          if(userFor(req)?.id!==practiceUser.id)throw new HttpError(401,'登录已失效，请重新登录。');
          practice.record(practiceUser.id,recordId);
          // Registration is only used to detect an unsupported practice route,
          // never to supply a candidate or correct a model prediction.
          const registration=samples.get(practiceUser.id,recordId);sampleRevision=registration.revision;const registered=registration.sample;
          const developmentTarget=registered&&developmentActions.find(a=>a.category===registered.category);
          if(developmentTarget&&![...recordingEntries,...training.active(practiceUser.id)].some(e=>e.id===developmentTarget.signId||e.text===developmentTarget.text)){
            return send(res,200,{status:'unsupported',candidate:null,reason:'recording_action_not_connected',actionText:developmentTarget.text,realtimeAvailable:Object.hasOwn(liveTargets,registered.category)});
          }
        }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        res.on('close', cancel);
        try {
          const result = await sign.recognize(video, mime, controller.signal,{models:customModels});
          if (!res.destroyed&&!controller.signal.aborted){
            if(customModels.length&&userFor(req)?.id!==modelOwner)throw new HttpError(401,'账号已变化，本次识别结果已取消。');
            if(practiceUser){
              if(userFor(req)?.id!==practiceUser.id)throw new HttpError(401,'登录已失效，请重新登录。');
              if(samples.get(practiceUser.id,recordId).revision!==sampleRevision)throw new HttpError(409,'样本登记已更新，本次结果未保存，请重新识别。');
              const attempt=practice.create(practiceUser.id,recordId,result);
              return send(res,200,{...result,attempt});
            }
            return send(res, 200, result);
          }
          return;
        } finally { res.off('close', cancel); }
      }
      if (url.pathname === '/api/speech/transcriptions' && method === 'POST') {
        if (req.headers['content-type']?.split(';')[0] !== 'audio/wav') throw new HttpError(415, '请选择可转换的录音格式。');
        const audio = await readBody(req, 1_000_000);
        const controller = new AbortController();
        const cancel = () => controller.abort();
        res.on('close', cancel);
        try {
          const result = await speech.transcribe(audio, controller.signal);
          if (!res.destroyed) return send(res, 200, result);
          return;
        } finally { res.off('close', cancel); }
      }
      if (url.pathname === '/api/avatar' && method === 'GET') return send(res, 200, {
        available: existsSync(join(publicDir, 'avatar-candidates/anny-makehuman.glb')), url: '/avatar-candidates/anny-makehuman.glb', source: 'https://github.com/naver/anny', license: 'CC0-1.0', codeLicense: 'Apache-2.0', signMotionAvailable: false,
      });
      if (url.pathname === '/api/profile' && method === 'GET') {
        const user = requireUser(req);
        const row = db.prepare('SELECT created_at FROM users WHERE id=?').get(user.id);
        const usage = db.prepare('SELECT COUNT(*) AS count FROM records WHERE user_id=?').get(user.id);
        return send(res, 200, { username: user.username, created_at: row?.created_at ?? null, record_count: usage?.count ?? 0, ...profileOf(user.id) });
      }
      if (url.pathname === '/api/profile/avatar' && ['GET', 'HEAD'].includes(method)) {
        const user = requireUser(req);
        const row = db.prepare('SELECT avatar_file, avatar_mime FROM profiles WHERE user_id=?').get(user.id);
        if (!row?.avatar_file) throw new HttpError(404, '还没有设置头像。');
        const file = join(avatarDir, row.avatar_file);
        let size;
        try { size = (await stat(file)).size; } catch { throw new HttpError(404, '头像文件已不可用。'); }
        res.writeHead(200, { 'Content-Type': row.avatar_mime, 'Content-Length': size, 'Cache-Control': 'no-store' });
        if (method === 'HEAD') return res.end();
        const stream = createReadStream(file);
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        return stream.pipe(res);
      }
      if (url.pathname === '/api/profile/avatar' && method === 'POST') {
        const user = requireUser(req);
        const mime = req.headers['content-type']?.split(';')[0];
        const extension = AVATAR_TYPES[mime];
        if (!extension) throw new HttpError(415, '头像仅支持 PNG、JPEG 或 WebP 图片。');
        const data = await readBody(req, MAX_AVATAR);
        if (data.length < 64) throw new HttpError(415, '没有检测到有效图片。');
        const signature = extension === 'png' ? data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
          : extension === 'jpg' ? data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
            : data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
        if (!signature) throw new HttpError(415, '图片内容与格式不符，请重新选择。');
        const previous = db.prepare('SELECT avatar_file FROM profiles WHERE user_id=?').get(user.id)?.avatar_file;
        const filename = `${user.id}.${extension}`;
        await writeFile(join(avatarDir, filename), data);
        saveProfile(user.id, { avatar_file: filename, avatar_mime: mime });
        if (previous && previous !== filename) await unlink(join(avatarDir, previous)).catch(() => {});
        return send(res, 200, { ok: true, ...profileOf(user.id) });
      }
      if (url.pathname === '/api/profile/avatar' && method === 'DELETE') {
        const user = requireUser(req);
        const previous = db.prepare('SELECT avatar_file FROM profiles WHERE user_id=?').get(user.id)?.avatar_file;
        saveProfile(user.id, { avatar_file: null, avatar_mime: null });
        if (previous) await unlink(join(avatarDir, previous)).catch(() => {});
        return send(res, 200, { ok: true, ...profileOf(user.id) });
      }
      if (['/api/profile/email', '/api/profile/phone'].includes(url.pathname) && method === 'POST') {
        const user = requireUser(req);
        const body = await readJson(req);
        const raw = typeof body.value === 'string' ? body.value.trim() : '';
        if (url.pathname.endsWith('email')) {
          if (raw && !EMAIL_PATTERN.test(raw)) throw new HttpError(400, '邮箱格式不正确。');
          saveProfile(user.id, { email: raw || null });
          return send(res, 200, { ok: true, ...profileOf(user.id) });
        }
        if (raw && !PHONE_PATTERN.test(raw)) throw new HttpError(400, '手机号格式不正确（需为 11 位中国大陆号码）。');
        saveProfile(user.id, { phone: raw || null });
        return send(res, 200, { ok: true, ...profileOf(user.id) });
      }
      if (url.pathname === '/api/auth/password' && method === 'POST') {
        const user = requireUser(req);
        const body = await readJson(req);
        const current = body.current_password, next = body.new_password;
        if (typeof current !== 'string' || typeof next !== 'string' || next.length < 10 || next.length > 128) throw new HttpError(400, '新密码需为 10–128 位。');
        checkRate(req, `password:${user.id}`);
        const row = db.prepare('SELECT salt, password_hash FROM users WHERE id=?').get(user.id);
        const given = await scrypt(current, row.salt, 64);
        if (!timingSafeEqual(given, Buffer.from(row.password_hash, 'hex'))) throw new HttpError(401, '当前密码不正确。');
        const salt = randomBytes(16).toString('hex');
        const hash = await scrypt(next, salt, 64);
        db.prepare('UPDATE users SET salt=?, password_hash=? WHERE id=?').run(salt, hash.toString('hex'), user.id);
        // Other sessions must not survive a password change; keep the current one usable.
        const token = cookieToken(req);
        db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(user.id, token ? digest(token) : '');
        return send(res, 200, { ok: true, message: '密码已更新，其他设备上的登录已退出。' });
      }
      if (url.pathname === '/api/voices' && method === 'GET') {
        const user = requireUser(req);
        const activeId = db.prepare('SELECT active_voice_id FROM profiles WHERE user_id=?').get(user.id)?.active_voice_id ?? null;
        return send(res, 200, { voices: voicesOf(user.id), active_id: activeVoice(user.id)?.id ?? null, selected_id: activeId, engine: voice.status() });
      }
      if (url.pathname === '/api/voices' && method === 'POST') {
        if (voice.status().retired) throw new HttpError(410, '本地个人音色已停用，当前使用千问音色。');
        const user = requireUser(req);
        if (req.headers['content-type']?.split(';')[0] !== 'audio/wav') throw new HttpError(415, '请提交 16 kHz 单声道 WAV 参考录音。');
        const count = db.prepare('SELECT COUNT(*) AS count FROM voices WHERE user_id=?').get(user.id).count;
        if (count >= 10) throw new HttpError(409, '每个账号最多保存 10 个音色，请先删除不需要的。');
        const name = textValue(url.searchParams.get('name') || '', 24) || `音色 ${count + 1}`;
        const note = textValue(url.searchParams.get('note') || '', 120) || null;
        const refText = textValue(url.searchParams.get('text') || '', 300);
        if (!refText) throw new HttpError(400, '请先确认参考录音对应的中文文字，用于提高音色还原度。');
        const audio = await readBody(req, MAX_VOICE_SAMPLE);
        const seconds = validatePcmWav(audio);
        if (seconds < 3 || seconds > 10) throw new HttpError(422, `参考录音需为 3–10 秒，当前 ${seconds.toFixed(1)} 秒，请重新录制。`);
        if (!voice.installed()) throw new HttpError(503, '本机个人音色环境尚未就绪。');
        const id = randomUUID();
        const filename = `${id}.wav`;
        await writeFile(join(voiceDir, filename), audio);
        // New recordings start unconfirmed: they cannot be spoken with until the owner verifies them.
        db.prepare('INSERT INTO voices (id,user_id,sample_file,ref_text,name,note,duration,revision,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(id, user.id, filename, refText, name, note, seconds, 1, 'pending', Date.now());
        return send(res, 201, { voice: voiceView(voiceOwned(user.id, id)) });
      }
      const voiceMatch = /^\/api\/voices\/([a-f0-9-]{36})(\/activate)?$/.exec(url.pathname);
      if (voiceMatch?.[2] && method === 'POST') {
        const user = requireUser(req);
        const row = voiceOwned(user.id, voiceMatch[1]);
        if (!row) throw new HttpError(404, '音色不存在或已删除。');
        if (row.status !== 'confirmed') throw new HttpError(409, '这个音色还没有确认，请先试听并确认后再选用。');
        saveProfile(user.id, { active_voice_id: row.id });
        return send(res, 200, { ok: true, active_id: row.id });
      }
      if (voiceMatch && !voiceMatch[2] && method === 'PATCH') {
        const user = requireUser(req);
        const row = voiceOwned(user.id, voiceMatch[1]);
        if (!row) throw new HttpError(404, '音色不存在或已删除。');
        const body = await readJson(req);
        const name = body.name === undefined ? row.name : (textValue(body.name, 24) || row.name);
        const note = body.note === undefined ? row.note : (textValue(body.note, 120) || null);
        let status = row.status;
        if (body.status !== undefined) {
          if (!['pending', 'confirmed'].includes(body.status)) throw new HttpError(400, '音色状态不合法。');
          status = body.status;
        }
        db.prepare('UPDATE voices SET name=?, note=?, status=? WHERE id=? AND user_id=?').run(name, note, status, row.id, user.id);
        // Confirming the first usable voice makes it the active one; nothing else changes implicitly.
        const activeId = db.prepare('SELECT active_voice_id FROM profiles WHERE user_id=?').get(user.id)?.active_voice_id ?? null;
        if (status === 'confirmed' && !activeVoice(user.id)) saveProfile(user.id, { active_voice_id: row.id });
        else if (status !== 'confirmed' && activeId === row.id) saveProfile(user.id, { active_voice_id: null });
        return send(res, 200, { voice: voiceView(voiceOwned(user.id, row.id)), active_id: activeVoice(user.id)?.id ?? null });
      }
      if (voiceMatch && !voiceMatch[2] && method === 'DELETE') {
        const user = requireUser(req);
        const row = voiceOwned(user.id, voiceMatch[1]);
        if (!row) throw new HttpError(404, '音色不存在或已删除。');
        db.prepare('DELETE FROM voices WHERE id=? AND user_id=?').run(row.id, user.id);
        await unlink(join(voiceDir, row.sample_file)).catch(() => {});
        if (activeVoice(user.id) === null) {
          const activeId = db.prepare('SELECT active_voice_id FROM profiles WHERE user_id=?').get(user.id)?.active_voice_id ?? null;
          if (activeId === row.id) saveProfile(user.id, { active_voice_id: null });
        }
        return send(res, 200, { ok: true, active_id: activeVoice(user.id)?.id ?? null });
      }
      if (url.pathname === '/api/auth/me' && method === 'GET') return send(res, 200, { user: userFor(req) });
      if (url.pathname === '/api/auth/captcha' && method === 'POST') {
        const challenge=captcha.issue(req.socket.remoteAddress||'local',captchaCookie(req));
        res.setHeader('Set-Cookie',`yuqiao_captcha=${challenge.id}; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=300${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);
        return send(res,200,challenge);
      }
      if (['/api/auth/register', '/api/auth/login'].includes(url.pathname) && method === 'POST') {
        const body = await readJson(req);
        const displayName = typeof body.username === 'string' ? body.username.trim().normalize('NFKC') : '';
        const username = displayName.toLowerCase();
        const password = body.password;
        if (!/^[\p{L}\p{N}_]{3,24}$/u.test(username) || typeof password !== 'string' || password.length < 10 || password.length > 128) throw new HttpError(400, '用户名需为 3–24 个字母、汉字、数字或下划线；密码需为 10–128 位。');
        checkRate(req, username);
        if (url.pathname.endsWith('login') && !captcha.consume(body.captchaId,body.captchaCode,captchaCookie(req))) throw new HttpError(400,'验证码错误或已失效，请输入新验证码。');
        const existing = db.prepare('SELECT * FROM users WHERE username=?').get(username);
        if (url.pathname.endsWith('register')) {
          if (existing) throw new HttpError(409, '这个用户名已被使用，请换一个。');
          const salt = randomBytes(16).toString('hex');
          const hash = await scrypt(password, salt, 64);
          const id = randomUUID();
          try { db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id, username, displayName, salt, hash.toString('hex'), Date.now()); }
          catch (error) { if ((String(error.message).includes('UNIQUE')||error.code==='ER_DUP_ENTRY')) throw new HttpError(409, '这个用户名已被使用，请换一个。'); throw error; }
          setSession(req, res, id);
          return send(res, 201, { user: { id, username: displayName } });
        }
        const hash = await scrypt(password, existing?.salt || dummySalt, 64);
        const matches = timingSafeEqual(hash, existing ? Buffer.from(existing.password_hash, 'hex') : dummyHash);
        if (!existing || !matches) throw new HttpError(401, '用户名或密码不正确。');
        setSession(req, res, existing.id);
        return send(res, 200, { user: { id: existing.id, username: existing.display_name } });
      }
      if (url.pathname === '/api/auth/logout' && method === 'POST') {
        const token = cookieToken(req);
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
        res.setHeader('Set-Cookie', 'yuqiao_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/records' && method === 'GET') {
        const user = requireUser(req);
        return send(res, 200, { records: db.prepare(`SELECT ${columns} FROM records WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 1000`).all(user.id) });
      }
      if (url.pathname === '/api/sign/motion-references' && method === 'GET') {
        const user = requireUser(req);
        const rows = db.prepare("SELECT id,created_at FROM records WHERE user_id=? AND kind='video' ORDER BY created_at DESC").all(user.id);
        const references = [];
        for (const row of rows) {
          const file = join(root, 'sign-motions', `${row.id}.json`);
          if (!existsSync(file)) continue;
          try {
            if ((await stat(file)).size > 2_000_000) continue;
            const motion = JSON.parse(await readFile(file, 'utf8'));
            const entry = motionCatalog.entries.find(entry => entry.id === motion.id && entry.label === motion.label);
            if (!entry || motion.status !== 'authored_unverified' || motion.source?.recordId !== row.id) continue;
            references.push({ recordId: row.id, signId: entry.id, label: entry.label, createdAt: row.created_at, motionUrl: `/api/records/${row.id}/motion`, mediaUrl: `/api/records/${row.id}/media` });
          } catch { /* Corrupt private derivatives are not advertised as available. */ }
        }
        if (userFor(req)?.id !== user.id) throw new HttpError(401, '登录已失效，请重新登录。');
        return send(res, 200, { references });
      }
      if (url.pathname === '/api/records/text' && method === 'POST') {
        const user = requireUser(req);
        const body = await readJson(req);
        const text = textValue(body.text);
        if (!text) throw new HttpError(400, '请先输入需要保存的文字。');
        if (!userFor(req)) throw new HttpError(401, '登录已失效，请重新登录。');
        checkQuota(user.id, 0);
        const id = randomUUID();
        db.prepare('INSERT INTO records (id,user_id,kind,text,created_at) VALUES (?,?,?,?,?)').run(id, user.id, 'text', text, Date.now());
        return send(res, 201, { record: db.prepare(`SELECT ${columns} FROM records WHERE id=?`).get(id) });
      }
      if(url.pathname==='/api/samples/numbering'&&method==='GET'){
        const user=requireUser(req);return send(res,200,{nextNumbers:samples.numbering(user.id)});
      }
      if (url.pathname === '/api/records/video' && method === 'POST') {
        const user = requireUser(req);
        const mime = req.headers['content-type']?.split(';')[0];
        if (!['video/webm', 'video/mp4'].includes(mime)) throw new HttpError(415, '仅支持 WebM 或 MP4 录像。');
        const text = textValue(url.searchParams.get('text') || '');
        const duration = Number(url.searchParams.get('duration'));
        if (!Number.isFinite(duration) || duration < 0 || duration > 31) throw new HttpError(400, '录像时长超出限制。');
        let samplePayload=null;
        const encodedSample=req.headers['x-yuqiao-sample'];
        if(encodedSample!==undefined){
          if(typeof encodedSample!=='string'||encodedSample.length>6000)throw new HttpError(400,'试采登记内容过长。');
          let sampleBody;try{sampleBody=JSON.parse(decodeURIComponent(encodedSample));}catch{throw new HttpError(400,'试采登记格式不正确。');}
          if(sampleBody?.revision!==0)throw new HttpError(400,'新录像登记版本必须为0。');
          samplePayload=samples.validate(sampleBody,duration);
        }
        const saveKey=req.headers['x-yuqiao-save-key'];
        if(saveKey!==undefined&&(typeof saveKey!=='string'||! /^[a-f0-9-]{36}$/.test(saveKey)))throw new HttpError(400,'保存标识格式不正确。');
        const data = await readBody(req, MAX_VIDEO);
        const valid = mime === 'video/webm' ? data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : data.subarray(4, 8).toString() === 'ftyp';
        if (data.length < 32 || !valid) throw new HttpError(415, '没有检测到有效录像，请重新录制。');
        if (userFor(req)?.id!==user.id) throw new HttpError(401, '登录已失效，请重新登录。');
        const contentHash=digest(data),requestHash=digest(JSON.stringify({text,duration,mime,samplePayload}));
        const previousSave=()=>{
          if(!saveKey)return null;
          const prior=db.prepare('SELECT * FROM video_save_keys WHERE user_id=? AND save_key=?').get(user.id,saveKey);
          if(!prior)return null;
          if(prior.content_hash!==contentHash||prior.request_hash!==requestHash)throw new HttpError(409,'同次录像的保存内容已变化，请先在“我的记录”核对已保存结果。');
          if(!prior.record_id)throw new HttpError(410,'这次录像已被删除，请重新录制。');
          return {record:db.prepare(`SELECT ${columns} FROM records WHERE id=? AND user_id=?`).get(prior.record_id,user.id),registration:samplePayload?samples.get(user.id,prior.record_id):null};
        };
        const previous=previousSave();if(previous)return send(res,200,previous);
        checkQuota(user.id, data.length);
        const id = randomUUID();
        const filename = `${id}.${mime === 'video/webm' ? 'webm' : 'mp4'}`;
        const file = join(mediaDir, filename);
        await writeFile(file, data, { flag: 'wx' });
        let registration=null;
        try {
          if (userFor(req)?.id!==user.id) throw new HttpError(401, '登录已失效，请重新登录。');
          const parallelSave=previousSave();if(parallelSave){await unlink(file);return send(res,200,parallelSave);}
          checkQuota(user.id, data.length);
          db.exec('BEGIN IMMEDIATE');
          try{
            db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?)').run(id, user.id, 'video', text, filename, mime, data.length, duration, Date.now());
            if(samplePayload)registration=samples.commit(user.id,id,0,samplePayload,contentHash);
            if(saveKey)db.prepare('INSERT INTO video_save_keys VALUES (?,?,?,?,?)').run(user.id,saveKey,id,contentHash,requestHash);
            db.exec('COMMIT');
          }catch(error){db.exec('ROLLBACK');throw error;}
        } catch (error) { await unlink(file); throw error; }
        return send(res, 201, { record: db.prepare(`SELECT ${columns} FROM records WHERE id=?`).get(id),registration });
      }
      const sampleMatch=/^\/api\/records\/([a-f0-9-]{36})\/sample$/.exec(url.pathname);
      if(sampleMatch){
        const user=requireUser(req),id=sampleMatch[1],source=samples.record(user.id,id);
        if(method==='GET')return send(res,200,samples.get(user.id,id));
        if(!['PUT','DELETE'].includes(method))throw new HttpError(405,'不支持此操作。');
        const body=await readJson(req);
        if(userFor(req)?.id!==user.id)throw new HttpError(401,'登录已失效，请重新登录。');
        if(method==='DELETE')return send(res,200,samples.withdraw(user.id,id,body));
        const payload=samples.validate(body,source.duration);
        let bytes;try{bytes=await readFile(join(mediaDir,source.media_file));}catch{throw new HttpError(404,'源录像无法读取，请核对记录。');}
        if(userFor(req)?.id!==user.id)throw new HttpError(401,'登录已失效，请重新登录。');
        const current=samples.record(user.id,id);
        if(current.media_file!==source.media_file||bytes.length!==current.byte_length)throw new HttpError(409,'源录像已变化，请重新核对。');
        return send(res,200,samples.commit(user.id,id,body.revision,payload,digest(bytes)));
      }
      const practiceMatch=/^\/api\/records\/([a-f0-9-]{36})\/practice(?:\/([a-f0-9-]{36})(\/feedback)?)?$/.exec(url.pathname);
      if(practiceMatch){
        const user=requireUser(req),[,recordId,attemptId,action]=practiceMatch;
        if(method==='GET'&&!action)return send(res,200,attemptId?{attempt:practice.get(user.id,recordId,attemptId)}:practice.list(user.id,recordId));
        if(method==='PUT'&&action==='/feedback'){
          practice.get(user.id,recordId,attemptId);
          const body=await readJson(req);
          if(userFor(req)?.id!==user.id)throw new HttpError(401,'登录已失效，请重新登录。');
          return send(res,200,{attempt:practice.feedback(user.id,recordId,attemptId,body)});
        }
        throw new HttpError(405,'不支持此操作。');
      }
      const match = /^\/api\/records\/([a-f0-9-]{36})(\/media|\/motion)?$/.exec(url.pathname);
      if (match) {
        const user = requireUser(req);
        const record = db.prepare('SELECT * FROM records WHERE id=? AND user_id=?').get(match[1], user.id);
        if (!record) throw new HttpError(404, '记录不存在或已删除。');
        if (match[2] === '/motion' && method === 'GET') {
          const file = join(root, 'sign-motions', `${record.id}.json`);
          if (!record.media_file || !existsSync(file)) throw new HttpError(404, '这段录像还没有动作参考。');
          if ((await stat(file)).size > 2_000_000) throw new HttpError(409, '动作参考文件异常，请重新提取。');
          let motion;
          try { motion = JSON.parse(await readFile(file, 'utf8')); }
          catch { throw new HttpError(409, '动作参考文件损坏，请重新提取。'); }
          if (motion.schemaVersion !== 1 || !motionCatalog.entries.some(entry => entry.id === motion.id && entry.label === motion.label) || motion.rig !== 'anny-makehuman' || motion.status !== 'authored_unverified' || motion.review !== 'not_reviewed' || motion.verifiedBy !== null || motion.source?.recordId !== record.id || !Array.isArray(motion.frames) || !motion.frames.length || motion.frames.length > 320) {
            throw new HttpError(409, '动作参考状态不合法，不能作为已校验素材播放。');
          }
          const mediaHash = createHash('sha256').update(await readFile(join(mediaDir, record.media_file))).digest('hex');
          if (mediaHash !== motion.source.sha256) throw new HttpError(409, '录像已变化，请重新提取动作。');
          // Re-check the session after async reads before returning private landmarks.
          if (userFor(req)?.id !== user.id) throw new HttpError(401, '登录已失效，请重新登录。');
          return send(res, 200, { motion });
        }
        if (match[2] === '/media' && ['GET', 'HEAD'].includes(method)) {
          if (!record.media_file) throw new HttpError(404, '该记录没有录像。');
          const file = join(mediaDir, record.media_file);
          let size;
          try { size = (await stat(file)).size; } catch { throw new HttpError(404, '录像文件已不可用。'); }
          let start = 0, end = size - 1;
          if (req.headers.range) {
            const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            if (!range || (!range[1] && !range[2])) { res.setHeader('Content-Range', `bytes */${size}`); throw new HttpError(416, '无效播放范围。'); }
            start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
            end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            if (start > end || start >= size) { res.setHeader('Content-Range', `bytes */${size}`); throw new HttpError(416, '无效播放范围。'); }
          }
          const headers = { 'Content-Type': record.mime, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Content-Disposition': `inline; filename="${record.media_file}"` };
          if (req.headers.range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
          res.writeHead(req.headers.range ? 206 : 200, headers);
          if (method === 'HEAD') return res.end();
          const stream = createReadStream(file, { start, end });
          stream.on('error', () => res.destroy());
          res.on('close', () => stream.destroy());
          return stream.pipe(res);
        }
        if (!match[2] && method === 'DELETE') {
          if (record.media_file) await unlink(join(mediaDir, record.media_file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
          await unlink(join(root, 'sign-motions', `${record.id}.json`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
          db.prepare('DELETE FROM records WHERE id=? AND user_id=?').run(record.id, user.id);
          removeArchivedRecord(root,record.id);
          await removeHelpModelReview(root,record.id);
          return send(res, 200, { ok: true });
        }
      }
      throw new HttpError(404, '接口不存在。');
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (res.destroyed) return;
      if (!(error instanceof HttpError) && !error.status) console.error('Request failed:', error.code || error.name); // No bodies, passwords or filenames.
      send(res, error.status || 500, { error: error.status ? error.message : '服务暂时不可用，请稍后重试。' });
    }
  });
  server.requestTimeout = 45000;
  server.headersTimeout = 10000;
  server.on('close', () => { training.close(); captcha.close(); language.close(); speech.close(); sign.close(); realtime.close(); tts.close(); voice.close(); db.close(); });
  return server;
}
