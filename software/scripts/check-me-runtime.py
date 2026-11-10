"""Replay one authorized registered clip through the actual JPEG worker."""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse,base64,hashlib,json,os,sqlite3,subprocess,sys,time
from pathlib import Path
import cv2
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory

def main():
    p=argparse.ArgumentParser();p.add_argument('--latest-owner',required=True,action='store_true');p.add_argument('--sample',required=True);p.add_argument('--expect',choices=['me','none'],default='me');a=p.parse_args()
    item=next(i for i in inventory() if i['sampleNumber']==a.sample)
    db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    row=db.execute('SELECT r.media_file,s.payload FROM records r JOIN sign_samples s ON r.id=s.record_id AND r.user_id=s.user_id WHERE r.id=? AND r.user_id=?',(item['recordId'],item['ownerId'])).fetchone();label=json.loads(row['payload']);path=(ROOT/'data/media'/row['media_file']).resolve()
    if not path.is_relative_to(ROOT/'data/media') or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_changed')
    worker=subprocess.Popen([sys.executable,'-B','-u',str(ROOT/'server/realtime_worker.py'),'--target','auto'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',env={**os.environ,'PYTHONIOENCODING':'utf-8'},creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    cap=cv2.VideoCapture(str(path.relative_to(ROOT)));seq=0;outputs=[];latencies=[];next_time=label['startSeconds'];last=0;origin=None
    try:
        ready=json.loads(worker.stdout.readline());assert ready['type']=='ready'
        def send(frame,t):
            nonlocal seq
            ok,jpeg=cv2.imencode('.jpg',frame,[cv2.IMWRITE_JPEG_QUALITY,80]);assert ok
            seq+=1;started=time.perf_counter();worker.stdin.write(json.dumps({'seq':seq,'timestampMs':t*1000,'jpeg':base64.b64encode(jpeg).decode()})+'\n');worker.stdin.flush();r=json.loads(worker.stdout.readline());latencies.append((time.perf_counter()-started)*1000)
            assert r['type']=='frame' and r['seq']==seq
            outputs.append(r)
        while True:
            ok,frame=cap.read()
            if not ok:break
            t=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
            if origin is None:origin=t
            t-=origin
            if t<label['startSeconds'] or t>=label['endSeconds'] or t<next_time:continue
            next_time=t+.06;last=t;h,w=frame.shape[:2];scale=min(1,640/max(h,w));send(cv2.resize(frame,(round(w*scale),round(h*scale))),t)
        for i in range(12):send(np.zeros((360,640,3),np.uint8),last+(i+1)*.1)
        current=db.execute('SELECT revision,source_sha256 FROM sign_samples WHERE record_id=?',(item['recordId'],)).fetchone();assert current['revision']==item['revision'] and current['source_sha256']==item['sourceHash'] and hashlib.sha256(path.read_bytes()).hexdigest()==item['sourceHash']
        candidates=sorted({r['candidate'] for r in outputs if r['candidate']});events=[r['event'] for r in outputs if r['event']]
        expected=['我'] if a.expect=='me' else []
        assert candidates==expected and [e['text'] for e in events]==expected
        print(json.dumps({'sampleNumber':a.sample,'actualWorker':True,'jpegQuality':80,'intervalMs':60,'candidates':candidates,'events':events,'medianRoundTripMs':float(np.median(latencies)),'p95RoundTripMs':float(np.percentile(latencies,95)),'frames':seq,'rawFramesPersisted':False,'syntheticEndBoundary':True}))
    finally:
        cap.release();db.close();worker.terminate();worker.wait(timeout=10)

if __name__=='__main__':main()
