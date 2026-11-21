"""Replay original timestamps through the Web realtime engine; never read labels/DB."""
from pathlib import Path
import sys,json,hashlib,time
import cv2,numpy as np
ROOT=Path(__file__).resolve().parents[1]
CFG=json.loads((ROOT/'shared/recording-recognition.json').read_text(encoding='utf8'))
TARGETS=json.loads((ROOT/'shared/realtime-targets.json').read_text(encoding='utf8'))
from unified_observation import observe_unified_bgr
from recording_result import RecordingResult
from realtime_paragraph import ParagraphBuffer
from sign_worker import hand_graph
from body_tracking import pose_graph
from unified_live import UnifiedLiveRecognizer,ENGINE

def pipeline_hash():
    directory=ROOT/ENGINE['modelDirectory']
    paths=sorted(set(['shared/recording-recognition.json']+CFG['sources']+[(directory/name).relative_to(ROOT).as_posix() for name in ['model.json','weights.npz']]))
    values=[[p,hashlib.sha256((ROOT/p).read_bytes()).hexdigest()] for p in paths]
    return hashlib.sha256(json.dumps(values,separators=(',',':')).encode()).hexdigest()

def recognize(path,custom_entries=None,*,paragraph=False):
    if custom_entries:raise ValueError('统一模型模式不加载逐动作模型。')
    targets={v['signId']:v for v in ENGINE['labels']}
    started=time.perf_counter();identity=pipeline_hash();cap=cv2.VideoCapture(str(path))
    if not cap.isOpened():raise ValueError('无法解码视频，请重新选择原录像。')
    summary=RecordingResult(targets)
    collector=ParagraphBuffer(auto_finish=False) if paragraph else None
    pending=final=None
    decoded=0;previous=-1.;previous_sample=None;duration=0.;time_source='decoder_pts';deltas=[]
    try:
        fps=cap.get(cv2.CAP_PROP_FPS);fallback=fps if np.isfinite(fps) and 1<=fps<=120 else None
        width,height=cap.get(cv2.CAP_PROP_FRAME_WIDTH),cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        if not np.isfinite([width,height]).all() or min(width,height)<16 or max(width,height)>CFG['maxSourceDimension'] or width*height>CFG['maxSourcePixels']:raise ValueError('视频尺寸不支持，请使用常规摄像头尺寸。')
        step=1/fallback if fallback else 0.
        live=UnifiedLiveRecognizer()
        with hand_graph() as hands,pose_graph() as pose:
            while True:
                ok,frame=cap.read()
                if not ok:break
                pts=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
                if np.isfinite(pts) and pts>=0 and (decoded==0 or pts>previous):t=float(pts)
                elif fallback:t=decoded/fallback;time_source='fps_fallback'
                else:raise ValueError('无法确定录像时间顺序，请重新录制。')
                if previous>=0:
                    if t<=previous:raise ValueError('录像时间戳不连续，未进行补帧识别。')
                    step=t-previous
                previous=t;decoded+=1;duration=t+step
                if duration>CFG['maxSeconds']+.25 or decoded>CFG['maxDecodedFrames']:raise ValueError('录像最长30秒，请缩短后重试。')
                if previous_sample is not None and t-previous_sample<CFG['sampleIntervalSeconds']-1e-6:continue
                h,w=frame.shape[:2]
                if min(h,w)<16 or max(h,w)>CFG['maxSourceDimension'] or h*w>CFG['maxSourcePixels']:raise ValueError('解码后的画面尺寸不支持。')
                scale=min(1,CFG['maxImageEdge']/max(h,w));frame=cv2.resize(frame,(round(w*scale),round(h*scale)))
                delta=1/30 if previous_sample is None else t-previous_sample
                if previous_sample is not None:deltas.append(delta)
                observation,payload=observe_unified_bgr(frame,hands,pose,delta)
                result=live.push(t,payload)
                present=bool(payload['frame'][74] or payload['frame'][150])
                summary.add(t,present,result);previous_sample=t
                if collector is not None and final is None:
                    # Keep the last real sample pending so EOF can confirm
                    # its final action without adding a fabricated frame.
                    if pending is not None:
                        final=collector.push(*pending)['final']
                    pending=(t,result,present)
    finally:cap.release()
    if decoded==0 or duration<.5:raise ValueError('视频太短或无法解码，请使用至少0.5秒的录像。')
    if pipeline_hash()!=identity:raise RuntimeError('model_resources_changed')
    if collector is not None:
        if final is None and pending is not None:
            t,last,present=pending
            if not last.get('event'):
                last=live.finish_recording(t) or last
            final=collector.push(t,last,present,finish=True)['final']
        return {'kind':'recorded-sign-paragraph','status':'recognized' if final else 'uncertain' if summary.hand_frames else 'no_hands',
                'paragraph':final,'duration_seconds':round(duration,3),'pipeline_sha256':identity}
    if previous_sample is not None:summary.confirm_recording_end(live.finish_recording(previous_sample))
    result=summary.finish()
    return {**result,'pipeline_id':CFG['id'],'pipeline_sha256':identity,'catalog_version':CFG['id'],'engine':'unified-tcn','experimental':True,'standard_validated':False,'diagnostic_version':4,'duration_seconds':round(duration,3),'decoded_frames':decoded,'sampled_frames':summary.frames,'hand_frames':summary.hand_frames,'hand_coverage':round(summary.hand_frames/max(summary.frames,1),4),'time_source':time_source,'sample_fps_limit':1/CFG['sampleIntervalSeconds'],'low_frame_rate':bool(deltas and float(np.median(deltas))>.06),'mirrored_for_model':True,'processing_ms':round((time.perf_counter()-started)*1000),'checks':[{'code':'single_action','passed':len(summary.words)<=1 and summary.events<=1 and not summary.after_completion},{'code':'no_conflict','passed':summary.conflicts==0},{'code':'candidate_evidence','passed':result['status']=='candidate'}]}

if __name__=='__main__':
    try:result=recognize(Path(sys.argv[1]),json.loads(sys.argv[2]) if len(sys.argv)>2 and sys.argv[2]!='--paragraph' else [],paragraph='--paragraph' in sys.argv[2:])
    except ValueError as error:result={'error':str(error),'status':422}
    except Exception:result={'error':'实时同款录像识别未能完成，请检查模型资源或稍后重试。','status':503}
    print(json.dumps(result,ensure_ascii=False),flush=True)
