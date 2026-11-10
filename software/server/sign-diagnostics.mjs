import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Bounded local numerical diagnostics. No video, landmarks, account, filename,
// candidate word or user-entered content is retained here or exposed by HTTP.
export async function recordSignDiagnostics(directory, result) {
  const entry = { id: randomUUID(), recorded_at: new Date().toISOString(), status: result.status, version: 2 };
  for (const key of ['duration_seconds', 'decoded_frames', 'sampled_frames', 'hand_frames', 'hand_coverage', 'longest_missing_seconds', 'active_sampled_frames', 'active_hand_coverage', 'internal_missing_seconds', 'trimmed_leading_seconds', 'trimmed_trailing_seconds', 'score', 'score_margin', 'processing_ms']) {
    entry[key] = typeof result[key] === 'number' && Number.isFinite(result[key]) ? result[key] : null;
  }
  const codes = new Set(['hand_count', 'coverage', 'gap', 'score', 'margin', 'scope']);
  entry.checks = (result.checks || []).filter(item => codes.has(item.code)).map(item => ({ code: item.code, passed: item.passed === true }));
  entry.thresholds = { min_hand_samples: 8, active_coverage: .6, max_internal_gap_seconds: .6, score: .8, margin: .25 };
  if(result.pipeline_id==='realtime-four-words-recording-v1'){
    entry.version=4;entry.thresholds={max_seconds:30,max_image_edge:640,sample_interval_seconds:.03};
    for(const key of ['observed_word_count','completed_event_count','conflict_frames'])entry[key]=Number.isInteger(result[key])?result[key]:null;
    entry.checks=(result.checks||[]).filter(c=>['single_action','no_conflict','candidate_evidence'].includes(c.code)).map(c=>({code:c.code,passed:c.passed===true}));
    entry.low_frame_rate=result.low_frame_rate===true;entry.end_boundary_observed=result.end_boundary_observed===true;
    if(/^[a-f0-9]{64}$/.test(result.pipeline_sha256))entry.pipeline_sha256=result.pipeline_sha256;
  }
  // Keep bounded numeric per-segment evidence, never words, free-text reasons,
  // record IDs, video paths, or landmarks. Older records are not backfilled.
  if(result.kind==='segmented-sign-sequence'&&Array.isArray(result.segments)){
    entry.version=3;
    entry.segment_count=Math.min(result.segments.length,10);
    const reasons=new Set(['no_boundary','too_short','too_long','hand_count','coverage','gap','score','margin','scope','candidate','uncertain']);
    entry.segments=result.segments.slice(0,10).map((segment,i)=>{
      const item={index:i+1,status:['candidate','uncertain','unsupported'].includes(segment.status)?segment.status:'uncertain',reason_code:reasons.has(segment.reason_code)?segment.reason_code:'uncertain'};
      for(const key of ['start_seconds','end_seconds','sampled_frames','hand_frames','active_hand_coverage','internal_missing_seconds','score','score_margin'])item[key]=typeof segment[key]==='number'&&Number.isFinite(segment[key])?segment[key]:null;
      item.checks=(Array.isArray(segment.checks)?segment.checks:[]).filter(check=>codes.has(check.code)).map(check=>({code:check.code,passed:check.passed===true}));
      return item;
    });
  }
  await mkdir(directory, { recursive: true });
  const target = join(directory, 'recent.json');
  let previous = [];
  try { const parsed = JSON.parse(await readFile(target, 'utf8')); if (Array.isArray(parsed)) previous = parsed.slice(-19); }
  catch { /* Missing or interrupted old reports do not block inference. */ }
  await writeFile(join(directory, 'recent.pending'), JSON.stringify([...previous, entry], null, 2));
  await rename(join(directory, 'recent.pending'), target);
  return entry.id;
}
