"""Live JPEGs remain in memory; exactly one unified action model per session."""
import base64,json,sys,time,argparse
import cv2,numpy as np
from body_tracking import pose_graph
from sign_worker import hand_graph
from hand_overlay import hand_overlay
from unified_observation import observe_unified_bgr
from realtime_paragraph import ParagraphBuffer
from unified_live import UnifiedLiveRecognizer,ENGINE,LIMITS

def emit(value):print(json.dumps(value,ensure_ascii=False),flush=True)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--target',choices=['auto'],default='auto')
    parser.add_argument('--help-engine',choices=['unified-tcn'],default='unified-tcn')
    parser.add_argument('--trained-models',default='[]')
    parser.add_argument('--flow',choices=['words','paragraph'],default='words')
    args=parser.parse_args()
    if json.loads(args.trained_models):raise ValueError('per_word_models_retired')
    live=UnifiedLiveRecognizer();paragraph=ParagraphBuffer() if args.flow=='paragraph' else None
    with hand_graph() as hands,pose_graph() as pose:
        emit({'type':'ready','protocol':LIMITS['protocol'],'target':'auto','helpEngine':ENGINE['engine'],'recognitionEngine':ENGINE['engine'],'loadedModelCount':1,'flow':args.flow})
        last_seq=0;previous=None
        while True:
            line=sys.stdin.readline(400000)
            if not line:break
            if not line.endswith('\n'):raise ValueError('frame_too_large')
            message=json.loads(line);seq=message['seq'];t=message['timestampMs']/1000
            if not isinstance(seq,int) or seq<=last_seq or not np.isfinite(t) or t<0:raise ValueError('invalid_frame_order')
            last_seq=seq;started=time.perf_counter()
            raw=base64.b64decode(message['jpeg'],validate=True)
            if not raw or len(raw)>LIMITS['maxJpegBytes']:raise ValueError('frame_too_large')
            frame=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
            if frame is None or min(frame.shape[:2])<16 or max(frame.shape[:2])>LIMITS['maxImageEdge']:raise ValueError('invalid_image')
            observation,payload=observe_unified_bgr(frame,hands,pose,t-previous if previous is not None else 1/30)
            result=live.push(t,payload)
            present=bool(payload is not None and (payload['frame'][74] or payload['frame'][150]))
            if paragraph is not None:
                finish=message.get('finishParagraph') is True
                if finish and not result['event']:
                    completed=live.finish_for_paragraph(t)
                    if completed is not None:result=completed
                result['paragraph']=paragraph.push(t,result,present,finish)
            previous=t
            emit({'type':'frame','seq':seq,**result,'handTracking':hand_overlay(observation,int(frame.shape[1]),int(frame.shape[0])),'processingMs':round((time.perf_counter()-started)*1000,1)})

if __name__=='__main__':
    try:main()
    except Exception:emit({'type':'error','error':'统一模型处理失败，请停止后重新开启。'})
