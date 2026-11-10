"""Private video replay of four-action windows; no labels sent to recognizers."""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse,hashlib,json,sqlite3,sys,time
from pathlib import Path
import cv2
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory
from sign_worker import classifier,predict,features,hand_graph
from body_tracking import pose_graph
from me_live import MeLiveRecognizer,me_observation
from me_tcn_inference import MeTCN
from help_tcn_inference import HelpTCN
from need_tcn_inference import NeedTCN
from need_live import NeedLiveRecognizer
from realtime_multi import MultiLiveRecognizer

def main():
    p=argparse.ArgumentParser();p.add_argument('--latest-owner',required=True,action='store_true');p.add_argument('--sample',action='append');p.add_argument('--interval-ms',type=int,default=30);a=p.parse_args()
    if not 0<=a.interval_ms<=200:raise ValueError('interval_out_of_range')
    rows=[x for x in inventory() if x['category']!='uncertain' and (not a.sample or x['sampleNumber'] in a.sample)]
    if a.sample and len(rows)!=len(set(a.sample)):raise ValueError('sample_missing')
    legacy=classifier();hm=HelpTCN();nm=NeedTCN();mm=MeTCN()
    def new(include=True):return MultiLiveRecognizer(lambda x:predict(*legacy,x),help_model=hm,need_detector=NeedLiveRecognizer(nm),me_detector=MeLiveRecognizer(mm) if include else None)
    db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row;reports=[];cache={}
    for item in rows:
        row=db.execute('SELECT s.payload,r.media_file FROM sign_samples s JOIN records r ON s.record_id=r.id AND s.user_id=r.user_id WHERE s.record_id=? AND s.user_id=?',(item['recordId'],item['ownerId'])).fetchone();label=json.loads(row['payload']);path=(ROOT/'data/media'/row['media_file']).resolve()
        if not path.is_relative_to(ROOT/'data/media') or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_changed')
        cap=cv2.VideoCapture(str(path.relative_to(ROOT)));live=new();old=new(False);trace=[];before=[];frames=[];cost=[];me_trace=[];last_state=None;diagnostics=[];next_t=label['startSeconds'];last=-1.;count=0;origin=None;previous_sample=None
        try:
            with hand_graph() as hands,pose_graph() as pose:
                fps=cap.get(cv2.CAP_PROP_FPS)
                while True:
                    ok,frame=cap.read()
                    if not ok:break
                    pts=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
                    if origin is None:origin=pts
                    t=pts-origin
                    if not np.isfinite(t) or t<=last:
                        if not np.isfinite(fps) or not 1<=fps<=120:raise ValueError('bad_timestamps')
                        t=max(count/fps,last+1/fps)
                    last=t;count+=1
                    if t>32 or count>4000:raise ValueError('video_limit')
                    if t<label['startSeconds'] or t>=label['endSeconds'] or t+1e-6<next_t:continue
                    next_t=t+a.interval_ms/1000;started=time.perf_counter();height,width=frame.shape[:2];scale=min(1,640/max(height,width));rgb=cv2.cvtColor(cv2.resize(cv2.flip(frame,1),(round(width*scale),round(height*scale))),cv2.COLOR_BGR2RGB)
                    h=hands.process({'image':rgb});b=pose.process({'image':rgb});value=features(h);payload=me_observation(h,b,t-previous_sample if previous_sample is not None else 1/30,height/width);vector=payload['frame'][:153]
                    result=live.push(t,value,vector,height/width,me_input=payload);cost.append((time.perf_counter()-started)*1000);trace.append(result)
                    if live.me.latest_check is not None:diagnostics.append(live.me.latest_check)
                    state=(live.me.candidate,live.me.qualified,live.me.blocked,live.active['word'] if live.active else None)
                    if item['category']=='me' and state!=last_state:me_trace.append({'t':t,'state':state,'lastSupport':live.me.last_support,'lastEvidence':live.me.last_evidence,'score':live.me.score});last_state=state
                    before.append(old.push(t,value,vector,height/width));frames.append((t,value,vector,height/width,payload));previous_sample=t
        finally:cap.release()
        if not frames:raise ValueError('no_frames')
        for i in range(12):
            t=frames[-1][0]+(i+1)*.1;trace.append(live.push(t,None,np.zeros(153)));before.append(old.push(t,None,np.zeros(153)))
        current=db.execute('SELECT active,revision,source_sha256 FROM sign_samples WHERE record_id=? AND user_id=?',(item['recordId'],item['ownerId'])).fetchone()
        if not current['active'] or current['revision']!=item['revision'] or current['source_sha256']!=item['sourceHash'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('registration_changed')
        def summary(outputs):return {'candidates':sorted({x['candidate'] for x in outputs if x['candidate']}),'events':[x['event']['text'] for x in outputs if x['event']],'conflictFrames':sum(x['reason']=='ambiguous_actions' for x in outputs)}
        reports.append({'sampleNumber':item['sampleNumber'],'category':item['category'],'revision':item['revision'],'sourceHash':item['sourceHash'],'before':summary(before),'after':summary(trace),'meTrace':me_trace,'diagnostics':{'frames':len(diagnostics),'bodyFrames':sum(x['bodyVisible'] for x in diagnostics),'stableFrames':sum(x['stableSupported'] for x in diagnostics),'handChecks':{k:sum(h[k] for x in diagnostics for h in x['hands']) for k in ['indexExtended','otherFingersFolded','towardChest','nearBody']},'modelScoreMedian':float(np.median([x['modelScore'] for x in diagnostics if x['modelScore'] is not None])) if any(x['modelScore'] is not None for x in diagnostics) else None},'medianProcessingMs':float(np.median(cost)),'p95ProcessingMs':float(np.percentile(cost,95))})
        if item['sampleNumber'] in ('32.1','32.4','26.1','30.1','31.1'):cache[item['sampleNumber']]=frames
        print('Replayed '+item['sampleNumber'],file=sys.stderr,flush=True)
    mixed=[]
    for order in [('我需要帮助',['32.1','31.1','30.1']),('谢谢我谢谢',['26.1','32.4','26.1'])]:
        if any(n not in cache for n in order[1]):continue
        for boundary in (False,True):
            live=new();clock=0.;outputs=[]
            for n in order[1]:
                source=cache[n];present=[i for i,(_,v,_,_,_) in enumerate(source) if v is not None];source=source[present[0]:present[-1]+1] if not boundary else source;start=source[0][0]
                for t,value,vector,aspect,payload in source:outputs.append(live.push(clock+t-start,value,vector,aspect,me_input=payload))
                clock+=source[-1][0]-start+.04
                if boundary:
                    for i in range(12):outputs.append(live.push(clock+i*.1,None,np.zeros(153)))
                    clock+=1.2
            for i in range(12):outputs.append(live.push(clock+i*.1,None,np.zeros(153)))
            mixed.append({'schedule':order[1],'events':[x['event'] for x in outputs if x['event']],'conflictFrames':sum(x['reason']=='ambiguous_actions' for x in outputs),'syntheticSplice':True,'explicitNoHandsBoundaries':boundary})
    print(json.dumps({'scope':'development_replay_synthetic_end_boundaries_not_independent_accuracy','intervalMs':a.interval_ms,'reports':reports,'mixed':mixed,'rawFramesPersisted':False}));db.close()

if __name__=='__main__':main()
