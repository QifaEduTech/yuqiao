"""Extract a private, unreviewed Anny reference from an existing account video.

No classification or invented frames: timestamps, missing hands and pose quality
remain explicit. The private record remains the owner/access-control authority.
"""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import os, sys, json, sqlite3, hashlib, argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
for name in ('TEMP','TMP','TMPDIR'): os.environ[name]=str(ROOT/'.runtime-logs/tmp')
os.environ['MPLCONFIGDIR']=str(ROOT/'.runtime-logs/matplotlib')
sys.stdout.reconfigure(encoding='utf-8')
import cv2, numpy as np, mediapipe as mp
from mediapipe.framework import calculator_pb2
from mediapipe.python import solution_base

def graph(kind):
    package=Path(mp.__file__).resolve().parent.parent
    relative={'hands':'hand_landmark/hand_landmark_tracking_cpu.binarypb','pose':'pose_landmark/pose_landmark_cpu.binarypb'}[kind]
    config=calculator_pb2.CalculatorGraphConfig()
    config.ParseFromString((package/'mediapipe/modules'/relative).read_bytes())
    original=solution_base.resource_util.set_resource_dir
    solution_base.resource_util.set_resource_dir=lambda path:original(os.path.relpath(path,ROOT))
    try:
        if kind=='hands':
            return solution_base.SolutionBase(graph_config=config,side_inputs={'model_complexity':1,'num_hands':2,'use_prev_landmarks':True},
                calculator_params={'palmdetectioncpu__TensorsToDetectionsCalculator.min_score_thresh':.6,'handlandmarkcpu__ThresholdingCalculator.threshold':.5},
                outputs=['multi_hand_landmarks','multi_hand_world_landmarks','multi_handedness'])
        return solution_base.SolutionBase(graph_config=config,side_inputs={'model_complexity':1,'smooth_landmarks':True,'enable_segmentation':False,'smooth_segmentation':False,'use_prev_landmarks':True},
            calculator_params={'posedetectioncpu__TensorsToDetectionsCalculator.min_score_thresh':.5,'poselandmarkbyroicpu__tensorstoposelandmarksandsegmentation__ThresholdingCalculator.threshold':.5},
            outputs=['pose_landmarks','pose_world_landmarks'])
    finally: solution_base.resource_util.set_resource_dir=original

def points(values,visibility=False):
    if values is None:return None
    return [[round(p.x,6),round(p.y,6),round(p.z,6),round(p.visibility,4)] if visibility else [round(p.x,6),round(p.y,6),round(p.z,6)] for p in values.landmark]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('record_id');parser.add_argument('--sign-id',default='csl.thanks');args=parser.parse_args()
    catalog=json.loads((ROOT/'shared/sign-motion-catalog.json').read_text(encoding='utf8'))
    entry=next((item for item in catalog['entries'] if item['id']==args.sign_id),None)
    if entry is None:raise ValueError('Add a stable sign ID to shared/sign-motion-catalog.json before extracting its motion')
    connection=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);connection.row_factory=sqlite3.Row
    row=connection.execute("SELECT id,media_file,kind FROM records WHERE id=?",(args.record_id,)).fetchone();connection.close()
    if row is None or row['kind']!='video':raise ValueError('Video record not found')
    path=(ROOT/'data/media'/row['media_file']).resolve()
    if path.parent!=(ROOT/'data/media').resolve():raise ValueError('Invalid media path')
    capture=cv2.VideoCapture(str(path.relative_to(ROOT)));frames=[];decoded=0;next_sample=0.;last_time=-1.
    width=int(capture.get(cv2.CAP_PROP_FRAME_WIDTH));height=int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT));fps=capture.get(cv2.CAP_PROP_FPS)
    if not capture.isOpened() or not 0<width*height<=3840*2160:raise ValueError('Video decode or dimensions invalid')
    try:
        with graph('hands') as hands,graph('pose') as pose:
            while True:
                ok,bgr=capture.read()
                if not ok:break
                timestamp=capture.get(cv2.CAP_PROP_POS_MSEC)/1000
                if not np.isfinite(timestamp) or (decoded and timestamp<=last_time):
                    if not np.isfinite(fps) or not 1<=fps<=120:raise ValueError('Invalid timestamps')
                    timestamp=decoded/fps
                last_time=timestamp;decoded+=1
                if timestamp>10.25:raise ValueError('Reference must be at most 10 seconds')
                if timestamp+1e-5<next_sample:continue
                next_sample+=1/30
                scale=min(1,960/max(height,width));bgr=cv2.resize(bgr,(round(width*scale),round(height*scale)))
                # Keep original orientation. Assign anatomy by pose wrists; no
                # classifier selfie flip is carried into animation extraction.
                rgb=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB);p=pose.process({'image':rgb});h=hands.process({'image':rgb})
                p_image=points(p.pose_landmarks,True);p_world=points(p.pose_world_landmarks,True)
                found=[]
                for i,hand in enumerate(h.multi_hand_landmarks or []):
                    normalized=points(hand);world=points(h.multi_hand_world_landmarks[i]);classification=h.multi_handedness[i].classification[0]
                    side='R' if classification.label=='Left' else 'L'
                    distance=None
                    if p_image:
                        distances={s:float(np.linalg.norm(np.array(normalized[0][:2])-np.array(p_image[j][:2]))) for s,j in [('L',15),('R',16)]}
                        side=min(distances,key=distances.get);distance=distances[side]
                    found.append({'side':side,'score':round(classification.score,4),'wristDistance':distance,'image':normalized,'world':world})
                slots={}
                for hand in sorted(found,key=lambda value:value['score'],reverse=True):
                    if hand['side'] not in slots:slots[hand['side']]=hand
                frames.append({'t':round(timestamp,4),'pose':p_image,'poseWorld':p_world,'hands':slots})
    finally:capture.release()
    active=[f for f in frames if f['hands'] and f['poseWorld']]
    if len(active)<8:raise ValueError('Not enough hand+body observations for a motion reference')
    start,end=active[0]['t'],active[-1]['t'];interval=[f for f in frames if start<=f['t']<=end]
    side_counts={s:sum(s in f['hands'] for f in interval) for s in ['L','R']}
    result={'schemaVersion':1,'id':entry['id'],'label':entry['label'],'rig':'anny-makehuman','status':'authored_unverified','review':'not_reviewed','verifiedBy':None,
        'labelSource':'user_selected_catalog_entry','coordinateSystem':'mediapipe-unmirrored-camera',
        'source':{'recordId':row['id'],'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'mirror':False,'method':'MediaPipe Hands world landmarks + Pose world landmarks'},
        'duration':round(last_time+1/fps,4),'activeSpan':[start,end],'sampleRate':30,
        'quality':{'decodedFrames':decoded,'sampledFrames':len(frames),'activeFrames':len(interval),'handFrames':side_counts,'poseFrames':sum(f['poseWorld'] is not None for f in interval)},
        'limitations':['单目深度与手指遮挡可能有误差，需对照原视频核对','缺失关节不冒充实际捕获动作','本轮不提取眉眼或口型，保持中性表情','仅独立预览，未经标准手语校验'],
        'frames':frames}
    directory=ROOT/'data/sign-motions';directory.mkdir(exist_ok=True)
    output=directory/(row['id']+'.json');output.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    print(json.dumps({'quality':result['quality'],'activeSpan':result['activeSpan'],'duration':result['duration'],'file':str(output.relative_to(ROOT))},ensure_ascii=False))
if __name__=='__main__':main()
