"""Generate private, authenticated playback diagnostics for registered 28.9 only."""
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
from help_tcn_live import HelpTCNLive,GUARD
from hand_overlay import hand_overlay
spec=importlib.util.spec_from_file_location('quality',ROOT/'scripts/audit-sample-quality.py');quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)

def main():
    if sys.argv[1:]!=['--latest-owner']:raise ValueError('explicit_owner_required')
    item=next(x for x in inventory() if x['sampleNumber']=='28.9');model=HelpTCN();live=HelpTCNLive(model);raw_live=HelpTCNLive(model,motion_check=False)
    db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    try:
        row=db.execute('SELECT s.*,r.media_file FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.record_id=? AND s.user_id=?',(item['recordId'],item['ownerId'])).fetchone();label=json.loads(row['payload']);path=(ROOT/'data/media'/row['media_file']).resolve()
        if not path.is_relative_to((ROOT/'data/media').resolve()) or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_changed')
        if label['category']!='other' or label['detail'] not in ('静止双掌','静置双掌'):raise ValueError('label_changed')
        vectors=[];timeline=[];last=None
        def observe(t,result):
            nonlocal last
            vector=training_frame(result,t-last if last is not None else 1/30);last=t;vectors.append(vector)
            score=live.push_features(t,vector)
            raw=raw_live.push_features(t,vector)
            timeline.append({'t':round(t,4),'score':score['helpScore'],'candidate':score['candidate'],'rawCandidate':raw['candidate'],'motionSupported':score['motionSupported'],'eventState':score['eventState'],'tracking':hand_overlay(result,640,360)})
        measured=quality.inspect_video(path,label,sample_interval_ms=0,on_observation=observe)
        width,height=measured['dimensions'];target_width=min(640,width);target_height=round(height*target_width/width)
        for frame in timeline:frame['tracking']['width']=target_width;frame['tracking']['height']=target_height
        middle_candidates=[i for i,v in enumerate(vectors) if v[74]>0 and v[150]>0];middle=middle_candidates[len(middle_candidates)//2]
        frozen=np.repeat(np.asarray(vectors[middle])[None,:],len(vectors),axis=0);frozen[:,152]=1
        shuffled=np.asarray(vectors).copy();np.random.default_rng(20261020).shuffle(shuffled)
        report={'schemaVersion':1,'recordId':item['recordId'],'ownerId':item['ownerId'],'sampleNumber':'28.9','sourceSha256':item['sourceHash'],'revision':item['revision'],'modelArtifactSha256':model.manifest['artifactSha256'],'modelVersion':'v1',
                'label':label['detail'],'annotatedRange':[label['startSeconds'],label['endSeconds']],'duration':measured['decodedDurationSeconds'],'threshold':.5,'fullClipScore':model.probability(vectors),'frozenFrameScore':model.probability(frozen),'frozenFrameTime':timeline[middle]['t'],'shuffledScore':model.probability(shuffled),'counterfactualNote':'冻结与乱序仅为人工构造诊断，不是另一个真人测试视频。','frames':timeline,'trainingHelpClips':3,'trainingStaticPalmsClips':1,'validationStaticPalmsClips':0}
        report.update(motionGuard=GUARD['id'],rawCandidateSeen=any(f['rawCandidate'] for f in timeline),guardedCandidateSeen=any(f['candidate'] for f in timeline),motionGuardSourceHash=hashlib.sha256((ROOT/'server/help_tcn_live.py').read_bytes()).hexdigest())
        current=db.execute('SELECT revision,active,source_sha256 FROM sign_samples WHERE record_id=?',(item['recordId'],)).fetchone()
        if not current['active'] or current['revision']!=item['revision'] or current['source_sha256']!=item['sourceHash'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_or_label_changed')
        directory=ROOT/'data/model-diagnostics';directory.mkdir(exist_ok=True);(directory/'static-palms-v1.json').write_text(json.dumps(report,ensure_ascii=False)+'\n',encoding='utf8')
        print(json.dumps({k:report[k] for k in ['sampleNumber','fullClipScore','frozenFrameScore','frozenFrameTime','shuffledScore','threshold','rawCandidateSeen','guardedCandidateSeen','motionGuard']}))
    finally:db.close()

if __name__=='__main__':main()
