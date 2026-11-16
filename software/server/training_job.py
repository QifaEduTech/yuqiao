"""Explicit user job; source videos are decoded read-only and never relabelled."""
from pathlib import Path
import sys,json,hashlib,subprocess,time,os
from process_lifetime import link_parent
link_parent(int(sys.argv[2]))
import cv2,numpy as np
from sign_worker import hand_graph,classifier,predict
from body_tracking import pose_graph
from realtime_observation import observe_bgr
from realtime_multi import MultiLiveRecognizer
from need_live import NeedLiveRecognizer
from me_live import MeLiveRecognizer
from trained_runtime import TrainedRuntime
from training_evaluation import summarize_test_counts
ROOT=Path(__file__).resolve().parents[1]
def emit(value):print(json.dumps(value,ensure_ascii=False),flush=True)
def progress(n,message):emit({'type':'progress','progress':n,'message':message})
def decode(sample):
    path=Path(sample['path'])
    if hashlib.sha256(path.read_bytes()).hexdigest()!=sample['sourceHash']:raise ValueError('录像内容已改变，请重新核对。')
    cap=cv2.VideoCapture(str(path));fps=cap.get(cv2.CAP_PROP_FPS);rows=[];decoded=0;last=-1;previous=-1
    if not cap.isOpened():raise ValueError('录像无法解码。')
    fallback=fps if np.isfinite(fps) and 1<=fps<=120 else None
    try:
      with hand_graph() as hands,pose_graph() as pose:
        while True:
          ok,frame=cap.read()
          if not ok:break
          pts=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
          if np.isfinite(pts) and pts>=0 and (decoded==0 or pts>previous):t=float(pts)
          elif fallback:t=decoded/fallback
          else:raise ValueError('无法确定录像时间顺序，请重新录制。')
          if t<=previous:raise ValueError('录像时间戳不连续，未补帧训练。')
          previous=t;decoded+=1
          if decoded>3690 or t>30.25:raise ValueError('录像过长，请使用30秒以内原片。')
          if t>sample['end']+.02:break
          if t<sample['start'] or t-last<.03:continue
          h,w=frame.shape[:2]
          if max(h,w)>4096 or h*w>8294400:raise ValueError('视频尺寸过大。')
          scale=min(1,640/max(h,w));frame=cv2.resize(frame,(round(w*scale),round(h*scale)))
          obs,value,vec,payload,aspect=observe_bgr(frame,hands,pose,1/30 if last<0 else t-last)
          rows.append({'t':t-sample['start'],'value':value,'vector':vec,'payload':payload,'aspect':aspect});last=t
    finally:cap.release()
    if len(rows)<12 or rows[-1]['t']<sample['end']-sample['start']-.15:raise ValueError('有效片段不足或动作范围超出实际录像，请检查后再试。')
    return rows
def observe(rows,entries,engine,inp,out):
    base=MultiLiveRecognizer(lambda seq:predict(engine,inp,out,seq),need_detector=NeedLiveRecognizer(),me_detector=MeLiveRecognizer());custom=TrainedRuntime(entries);words=set();conflict=False;events=[]
    for r in rows:
        result=base.push(r['t'],r['value'],r['vector'],aspect_ratio=r['aspect'],me_input=r['payload']);result=custom.merge(r['t'],r['payload'],result)
        if result['candidate']:words.add(result['candidate'])
        if result.get('event'):words.add(result['event']['text']);events.append(result['event']['text'])
        if result['reason']=='ambiguous_actions':conflict=True
    return words,conflict,events
def main():
    plan_path=Path(sys.argv[1]);plan=json.loads(plan_path.read_text(encoding='utf-8'));samples=[s for s in plan['samples'] if s['split']!='regression'];a=plan['action'];directory=Path(plan['output']);features=[];observations=[];quality=[]
    for i,s in enumerate(samples):
        progress(round(i/max(1,len(samples))*45),f'检查录像 {i+1}/{len(samples)}')
        rows=decode(s);indices=[i for i,r in enumerate(rows) if r['payload'] is not None and len(r['payload']['hands'])>=a['hands'] and int(r['payload']['frame'][74]>0)+int(r['payload']['frame'][150]>0)>=a['hands'] and len(r['payload']['shoulders'])==2 and all(x[2]>=.5 for x in r['payload']['shoulders'])]
        coverage=len(indices)/(indices[-1]-indices[0]+1) if indices else 0;passed=bool(len(indices)>=12 and coverage>=.75) if s['label']==1 else True
        quality.append({'recordId':s['recordId'],'passed':passed,'coverage':round(coverage,3),'reason':'通过' if passed else '目标动作的双手/身体参照跟踪不足，请保持入画并补录。'})
        features.append({**{k:s[k] for k in ['recordId','label','split','group','sourceHash']},'durationSeconds':s['end']-s['start'],'frames':[r['payload']['frame'].tolist() if r['payload'] else [0.]*178 for r in rows]});observations.append(rows)
    if plan['kind']=='quality' or not all(q['passed'] for q in quality):
        emit({'type':'result','ok':True,'message':'质量检查完成。' if all(q['passed'] for q in quality) else '部分目标样本需补录，未启动训练。','report':{'quality':quality,'passed':False,'trained':False}});return
    (directory/'features.json').write_text(json.dumps(features),encoding='utf-8');progress(50,'正在训练CPU时序模型，请耐心等待。')
    child=None
    try:
      child=subprocess.Popen([str(ROOT/'.venv-anny/Scripts/python.exe'),'-B','-u',str(ROOT/'server/training_fit.py'),str(plan_path),str(os.getpid())],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,cwd=ROOT)
      output=child.stdout.read();code=child.wait()
      if code:raise ValueError('模型训练失败，请检查CPU训练环境与样本；旧模型未改变。')
      trained=json.loads(output)
    finally:
      if child:
        if child.poll() is None:child.kill()
        child.stdin.close()
    progress(75,'正在检查这个词的考试结果。');meta=json.loads((directory/'model.json').read_text(encoding='utf-8'));entries=[x for x in plan['customModels'] if x['signId']!=a['signId']]+[{'text':a['text'],'signId':a['signId'],'path':str(directory/'model.json'),'sha256':meta['sha256']}]
    engine,inp,out=classifier();details=[];counts={'tp':0,'fn':0,'fp':0,'tn':0}
    for s,rows in zip(samples,observations):
        if s['split']!='test':continue
        words,conflict,events=observe(rows,entries,engine,inp,out)
        if s['split']=='test':
            predicted=words=={a['text']} and events==[a['text']] and not conflict;correct=predicted if s['label']==1 else a['text'] not in words and not conflict
            counts['tp' if s['label'] and correct else 'fn' if s['label'] else 'tn' if correct else 'fp']+=1
            details.append({'recordId':s['recordId'],'correct':correct,'observed':sorted(words),'reason':'证据冲突' if conflict else '未确认完整动作；检查收手边界或补录' if s['label'] and not correct else '误报' if not correct else '通过'})
    metrics=summarize_test_counts(counts);sufficient=metrics['testSufficient'];passed=metrics['passed']
    report={**metrics,'quality':quality,'trained':True,'epochs':trained['epochs'],'testEvaluated':bool(details),'details':details,'regression':[],'regressionRequired':False,'regressionPassed':None,'evaluationPolicy':'current-word-exam-v2','captureGroupsVerified':not any(s.get('groupSource')=='automatic' for s in samples),'modelSha256':meta['sha256'],'recommendations':(['最后考试至少需要20条这个词和20条不是这个词的录像，不能使用已参与学习或调试的资料。'] if not sufficient else [])+(['查看错误样本，补充对应视角/方向/相似反例；调试后另留新考试资料。'] if sufficient and not passed else [])}
    emit({'type':'result','ok':True,'message':'测试达标，已加入全项目共用的模型；其他账号重新开启识别即可使用。' if passed else '训练已完成，尚未达到启用条件，请查看补充建议。','report':report})
if __name__=='__main__':
    try:main()
    except ValueError as e:emit({'type':'result','ok':False,'message':str(e)[:300]})
    except Exception:emit({'type':'result','ok':False,'message':'处理未能完成，请检查录像、模型及本机训练环境。原片和旧模型保留。'})
