"""Joint scratch-training job. Source footage stays read-only."""
import sys,json,time,hashlib,subprocess,os
from pathlib import Path
from process_lifetime import link_parent
link_parent(int(sys.argv[2]))
import cv2,numpy as np
from sign_worker import hand_graph
from body_tracking import pose_graph
from unified_observation import observe_unified_bgr
from unified_runtime import quality,quality_feedback
from joint_model import JointTCN
from joint_evaluation import evaluate_joint,select_end_policy
from joint_iteration import compare,load_reference
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
        identity={k:sample[k] for k in ('recordId','sourceHash','start','end')}
        try:data=decode(sample)
        except ValueError as error:
            quality_report.append({**identity,'passed':False,'reason':str(error)[:250]});continue
        frames+=len(data['frames'])
        if frames>plan['policy']['maxTotalFrames']:raise ValueError('本轮总帧数超过上限，请分批整理资料。')
        q=quality(data['frames']);quality_report.append({**identity,'passed':bool(q['passed'] or not sample['label']),'reason':'通过' if not sample['label'] else quality_feedback(q),'metrics':q})
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
    model=JointTCN(directory);tests=[r for r in rows if r['split']=='test']
    emit({'type':'progress','progress':80,'message':'用训练集内部检查比较动作收尾方式…'})
    metadata_path=directory/'model.json'
    metadata=json.loads(metadata_path.read_text(encoding='utf8'))
    reference=plan.get('iterationReference')
    prior=None
    if reference and not reference.get('unavailable'):
        prior=load_reference(reference['directory'],reference['referenceHash'])
        if getattr(prior,'cadence_alignment',False):
            model.cadence_alignment=True
            metadata['cadenceAlignment']='within-tracked-run-v1'
        if getattr(prior,'confirmed_evidence',False):
            model.confirmed_evidence=True
            metadata['streamConfirmation']='confirmed-evidence-v1'
    boundary=select_end_policy(rows,model,plan['labels'],plan['policy'])
    metadata['endPolicy']=boundary['selected']
    metadata['endValidation']=boundary
    metadata_path.write_text(json.dumps(metadata,ensure_ascii=False),encoding='utf8')
    emit({'type':'progress','progress':85,'message':'用留出的测试视频检查识别和收尾…'})
    model=JointTCN(directory)
    comparison=None
    if prior is not None:
        comparison=compare(rows,model,plan['labels'],prior,reference['labels'],plan['policy'],set(reference['excluded']))
        comparison.update(referenceHash=reference['referenceHash'],candidateHash=fit['sha256'])
    evaluation=evaluate_joint(tests,model,plan['labels'],plan['policy'])
    passed=bool(evaluation['perClass']) and all(c['passed'] for c in evaluation['perClass'])
    emit({'type':'result','ok':True,'message':'全部动作检查达标，正在保存并归档资料。' if passed else '本轮未全部达标，请分别查看录像识别与自动收尾结果。','report':{'trained':True,'passed':passed,'iterationComparison':comparison,'testEvaluated':bool(tests),**evaluation,'quality':quality_report,'modelSha256':fit['sha256'],'epochs':fit['epochs'],'seconds':fit['seconds'],'initialization':'random','testedHashes':[r['sourceHash'] for r in tests]}})


if __name__=='__main__':
    try:main()
    except Exception as e:emit({'type':'result','ok':False,'message':str(e)[:250] if isinstance(e,ValueError) else '本轮任务中断，视频与已保存模型保留。'})
