"""Registered development replay of automatic two-action arbitration."""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import hashlib,importlib.util,json,sqlite3,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory
from sign_training_features import training_frame
from help_tcn_inference import HelpTCN
from realtime_multi import MultiLiveRecognizer
from realtime_events import LiveRecognizer
from sign_worker import classifier,predict,features
spec=importlib.util.spec_from_file_location('quality',ROOT/'scripts/audit-sample-quality.py');quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)

def main():
    if '--latest-owner' not in sys.argv[1:] or any(x not in ['--latest-owner','--passive-peer','--include-need','--switch-only'] for x in sys.argv[1:]):raise ValueError('explicit_owner_required')
    composite='--passive-peer' in sys.argv
    include_need='--include-need' in sys.argv
    switch_only='--switch-only' in sys.argv
    model=classifier();help_model=HelpTCN();db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row;reports=[];cache={};schedule=['26.1','30.1','28.9','26.2','30.4','26.1']
    if include_need:
        from need_tcn_inference import NeedTCN
        from need_live import NeedLiveRecognizer
        need_model=NeedTCN();schedule=['26.1','31.1','30.1','28.11','28.12','31.4','26.2','31.3','30.4','31.6']
    def new():return MultiLiveRecognizer(lambda x:predict(*model,x),help_model,need_detector=NeedLiveRecognizer(need_model) if include_need else None)
    if switch_only:schedule=['26.1','30.1','26.2']+(['31.1'] if include_need else [])
    try:
        for item in inventory():
            if item['category']=='uncertain':continue
            if switch_only and item['sampleNumber'] not in schedule:continue
            row=db.execute('SELECT s.payload,r.media_file,r.byte_length FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.record_id=? AND s.user_id=?',(item['recordId'],item['ownerId'])).fetchone();path=(ROOT/'data/media'/row['media_file']).resolve();label=json.loads(row['payload'])
            if not path.is_relative_to((ROOT/'data/media').resolve()) or path.stat().st_size!=row['byte_length'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_changed')
            frames=[];last=None
            def observe(t,obs):
                nonlocal last
                frames.append((t,features(obs),training_frame(obs,t-last if last is not None else 1/30)));last=t
            measured=quality.inspect_video(path,label,sample_interval_ms=30,on_observation=observe);aspect=measured['dimensions'][1]/measured['dimensions'][0];live=new();outputs=[]
            for t,value,vector in frames:outputs.append(live.push(t,value,vector,aspect))
            for i in range(10):outputs.append(live.push(frames[-1][0]+(i+1)*.1,None,np.zeros(153),aspect))
            current=db.execute('SELECT active,revision,source_sha256 FROM sign_samples WHERE record_id=?',(item['recordId'],)).fetchone()
            if not current['active'] or current['revision']!=item['revision'] or current['source_sha256']!=item['sourceHash'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('registration_changed')
            reports.append({'sampleNumber':item['sampleNumber'],'category':item['category'],'candidates':sorted({x['candidate'] for x in outputs if x['candidate']}),'events':[x['event']['text'] for x in outputs if x['event']],'conflictFrames':sum(x['reason']=='ambiguous_actions' for x in outputs)})
            if item['sampleNumber'] in schedule or composite and item['category']=='thanks':cache[item['sampleNumber']]=(frames,aspect)
        live=new();clock=0.;mixed=[]
        for number in schedule:
            frames,aspect=cache[number];origin=frames[0][0];out=[]
            for t,value,vector in frames:out.append(live.push(clock+t-origin,value,vector,aspect))
            end=clock+frames[-1][0]-origin
            for i in range(10):out.append(live.push(end+(i+1)*.1,None,np.zeros(153),aspect))
            clock=end+1.1;mixed.extend(x['event'] for x in out if x['event'])
        composites=[]
        switches=[]
        # Synthetic clip splices retain hands at the join. They exercise state
        # transitions, not real continuous-sign accuracy or source annotations.
        for order in [['26.1','30.1'],['30.1','26.1'],['26.1','30.1','26.2']]+([['26.1','31.1','30.1']] if include_need else []):
            if any(number not in cache for number in order):continue
            live=new();clock=0.;out=[]
            for number in order:
                rows,aspect=cache[number];present=[i for i,(_,value,_) in enumerate(rows) if value is not None]
                rows=rows[present[0]:present[-1]+1];origin=rows[0][0]
                for t,value,vector in rows:out.append(live.push(clock+t-origin,value,vector,aspect))
                clock+=rows[-1][0]-origin+.04
            for i in range(10):out.append(live.push(clock+i*.1,None,np.zeros(153),aspect))
            trace=[];prior=None
            for x in out:
                state=(x['candidate'],x['eventState'],x['reason'])
                if state!=prior:trace.append({'candidate':x['candidate'],'state':x['eventState'],'reason':x['reason'],'event':x['event']});prior=state
            switches.append({'schedule':order,'events':[x['event'] for x in out if x['event']],'conflictFrames':sum(x['reason']=='ambiguous_actions' for x in out),'syntheticSplice':True,'trace':trace})
        if composite:
            static=next(f for _,_,f in cache['28.9'][0] if f[74]>0 and f[150]>0)
            for number,(frames,aspect) in cache.items():
                if not number.startswith('26.'):continue
                side=int(sum(f[150]>0 for _,_,f in frames)>sum(f[74]>0 for _,_,f in frames));peer=1-side
                old=LiveRecognizer(lambda x:predict(*model,x));live=new();before=[];after=[]
                for t,value,vector in frames:
                    # Diagnostic feature composition only: retain the recorded
                    # active side; add a fixed peer. Never alter source videos.
                    f=vector.copy();f[peer*76:(peer+1)*76]=static[peer*76:(peer+1)*76]
                    v=np.zeros(126) if value is None else value.copy();v[peer*63:(peer+1)*63]=f[peer*76:peer*76+63]
                    before.append(old.push(t,v));after.append(live.push(t,v,f,aspect))
                for i in range(10):
                    t=frames[-1][0]+(i+1)*.1;f=np.zeros(153);f[peer*76:(peer+1)*76]=static[peer*76:(peer+1)*76]
                    v=np.zeros(126);v[peer*63:(peer+1)*63]=f[peer*76:peer*76+63]
                    before.append(old.push(t,v));after.append(live.push(t,v,f,aspect))
                composites.append({'sampleNumber':number,'activeSide':side,'oldCandidate':any(x['candidate'] for x in before),'oldEvents':[x['event']['text'] for x in before if x['event']],'newCandidate':any(x['candidate'] for x in after),'newEvents':[x['event']['text'] for x in after if x['event']]})
        print(json.dumps({'scope':'development_replay_with_synthetic_boundaries_not_independent_accuracy','reports':reports,'mixedSchedule':schedule,'mixedEvents':mixed,'switchReplays':switches,'passivePeerComposites':composites,'compositeScope':'synthetic_feature_composition_not_real_two_hand_video','rawFramesPersisted':False}))
    finally:db.close()

if __name__=='__main__':main()
