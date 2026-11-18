"""Joint scratch-training job. Source footage stays read-only."""
import sys,json,time,hashlib,subprocess,os
from pathlib import Path
from process_lifetime import link_parent
link_parent(int(sys.argv[2]))
import cv2,numpy as np
from sign_worker import hand_graph
from body_tracking import pose_graph
from unified_observation import observe_unified_bgr
from unified_runtime import quality,UnifiedStream
from joint_model import JointTCN
ROOT=Path(__file__).resolve().parents[1]
def emit(v):print(json.dumps(v,ensure_ascii=False),flush=True)
def decode(sample):
    path=Path(sample['path'])
    if hashlib.sha256(path.read_bytes()).hexdigest()!=sample['sourceHash']:raise ValueError('录像已变化，请重新确认资料。')
    cap=cv2.VideoCapture(str(path));rows=[];times=[];previous=-1;selected=None;decoded=0
    if not cap.isOpened():raise ValueError('录像无法解码。')
    fps=cap.get(cv2.CAP_PROP_FPS);fallback=fps if np.isfinite(fps) and 1<=fps<=120 else None
    try:
        with hand_graph() as hands,pose_graph() as pose:
            while True:
                ok,frame=cap.read()
                if not ok:break
                t=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
                if not np.isfinite(t) or t<0 or decoded and t<=previous:
                    if fallback:t=decoded/fallback
                    else:raise ValueError('录像时间戳无效。')
                if t<=previous:raise ValueError('录像时间顺序无效。')
                previous=t;decoded+=1
                if decoded>3690 or t>30.25:raise ValueError('录像不能超过30秒。')
                if t>sample['end']+.02:break
                if t<sample['start'] or selected is not None and t-selected<.03:continue
                h,w=frame.shape[:2]
                if min(h,w)<16 or max(h,w)>4096 or h*w>8294400:raise ValueError('录像尺寸过大。')
                scale=min(1,640/max(h,w));frame=cv2.resize(frame,(round(w*scale),round(h*scale)))
                _,payload=observe_unified_bgr(frame,hands,pose,1/30 if selected is None else t-selected)
                rows.append(payload['frame'].tolist());times.append(t-sample['start']);selected=t
                if len(rows)>1024:raise ValueError('单条视频采样帧过多，请使用较短完整动作。')
    finally:cap.release()
    if len(rows)<2 or selected is None or selected<sample['end']-.15:raise ValueError('录像范围无法完整读取。')
    return {'frames':rows,'times':times}

def main():
    path=Path(sys.argv[1]);plan=json.loads(path.read_text(encoding='utf8'));directory=path.parent;rows=[];frames=0;quality_report=[];began=time.monotonic()
    for i,sample in enumerate(plan['samples']):
        if time.monotonic()-began>1500:raise ValueError('本轮检查达到时间上限，资料已保留。')
        emit({'type':'progress','progress':int(45*i/len(plan['samples'])),'message':f'检查视频 {i+1}/{len(plan["samples"])}'})
        data=decode(sample);frames+=len(data['frames'])
        if frames>plan['policy']['maxTotalFrames']:raise ValueError('本轮总帧数超过上限，请分批整理资料。')
        q=quality(data['frames']);quality_report.append({'recordId':sample['recordId'],'passed':bool(q['passed'] or not sample['label']),'reason':'通过' if q['passed'] or not sample['label'] else '双手或身体参照不足，请补录清晰动作。'})
        rows.append({**sample,**data})
    if any(not q['passed'] for q in quality_report):
        emit({'type':'result','ok':True,'report':{'trained':False,'passed':False,'quality':quality_report,'testEvaluated':False},'message':'部分目标视频质量不足，任务保留，请补录后继续。'});return
    fitrows=[{k:r[k] for k in ['frames','label','split']} for r in rows if r['split'] in ('train','validation')]
    (directory/'fit-features.json').write_text(json.dumps(fitrows),encoding='utf8')
    emit({'type':'progress','progress':50,'message':'从随机参数训练一个统一模型…'})
    child=subprocess.Popen([str(ROOT/'.venv-anny/Scripts/python.exe'),'-B','-u',str(ROOT/'server/joint_fit.py'),str(directory),str(os.getpid())],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,cwd=ROOT)
    try:
        output=child.stdout.read();code=child.wait()
        if code:raise ValueError('本轮训练未完成，任务和视频已保留。')
        fit=json.loads(output)
    finally:
        if child.poll() is None:child.kill()
        child.stdin.close()
    emit({'type':'progress','progress':85,'message':'用最后测试视频检查召回率…'})
    model=JointTCN(directory);counts=[{'tp':0,'fn':0,'fp':0,'tn':0} for _ in plan['labels']];details=[];tests=[r for r in rows if r['split']=='test']
    for row in tests:
        live=UnifiedStream(model);events=[];seen=set();conflict=False
        for t,frame in zip(row['times'],row['frames']):
            r=live.push(t,frame);conflict|=r['conflict']
            if r['candidate']:seen.add(r['candidate'])
            if r['event']:events.append(r['event']['label']);seen.add(r['event']['label'])
        for i,c in enumerate(counts,1):
            correct=events==[i] and seen=={i} and not conflict if row['label']==i else i not in seen and not conflict
            c['tp' if row['label']==i and correct else 'fn' if row['label']==i else 'tn' if correct else 'fp']+=1
        details.append({'recordId':row['recordId'],'correct':events==[row['label']] and not conflict if row['label'] else not seen and not conflict,'reason':'需要检查动作完成/收手边界' if row['label'] and events!=[row['label']] else '已检查'})
    per=[]
    for label,c in zip(plan['labels'],counts):
        recall=c['tp']/max(1,c['tp']+c['fn']);precision=c['tp']/max(1,c['tp']+c['fp']);fpr=c['fp']/max(1,c['fp']+c['tn'])
        policy=plan['policy']
        per.append({**label,'counts':c,'recall':recall,'precision':precision,'falsePositiveRate':fpr,'passed':c['tp']+c['fn']>=policy['minTestPositive'] and c['fp']+c['tn']>=policy['minTestNegative'] and recall>=policy['recallTarget'] and precision>=policy['precisionTarget'] and fpr<=policy['maxFalsePositiveRate']})
    passed=bool(per) and all(c['passed'] for c in per)
    emit({'type':'result','ok':True,'message':'全部动作检查达标，正在保存并归档资料。' if passed else '本轮未全部达标，任务保留，请补充失败动作后继续。','report':{'trained':True,'passed':passed,'testEvaluated':bool(tests),'perClass':per,'quality':quality_report,'details':details,'modelSha256':fit['sha256'],'epochs':fit['epochs'],'seconds':fit['seconds'],'initialization':'random','testedHashes':[r['sourceHash'] for r in tests]}})

if __name__=='__main__':
    try:main()
    except Exception as e:emit({'type':'result','ok':False,'message':str(e)[:250] if isinstance(e,ValueError) else '本轮任务中断，视频与已保存模型保留。'})
