"""Read-only inventory/splitting rules. Never split frames of the same source."""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
from datetime import datetime,timezone,timedelta
import hashlib
import json
from pathlib import Path
import re
import sqlite3

ROOT=Path(__file__).resolve().parents[1]
CONFIG=json.loads((ROOT/'shared/sign-training.json').read_text(encoding='utf8'))
CAPTURE_GROUP=re.compile(r'^capture:\d{8}:\d{6}:[a-f0-9]{6}$')

def group_key(user_id,performer,batch,created_at):
    if CAPTURE_GROUP.fullmatch(batch or ''):
        source='declared_capture_round';value=batch
    else:
        source='record_date_coarse'
        value=datetime.fromtimestamp(created_at/1000,timezone(timedelta(hours=8))).date().isoformat()
    key=hashlib.sha256(f'{user_id}|{performer}|{value}'.encode()).hexdigest()[:16]
    return key,source

def split_inventory(items):
    eligible=[r for r in items if r['category'] in ('thanks','background','other') and r['reviewed'] and (r['category']!='thanks' or r['complete'])]
    ordered=sorted(eligible,key=lambda r:(r['createdAt'],r['sampleNumber']))
    groups=list(dict.fromkeys(r['group'] for r in ordered))
    counts={'thanks':sum(r['category']=='thanks' for r in eligible),'not_thanks':sum(r['category']!='thanks' for r in eligible)}
    reasons=[];splits={}
    if len(eligible)>CONFIG['maxSamples']:reasons.append('pilot_sample_capacity_exceeded')
    sources={}
    for row in eligible:
        old=sources.get(row['sourceHash'])
        if old is not None:reasons.append('duplicate_source')
        sources[row['sourceHash']]=row['group']
    seen_groups={r['group'] for r in ordered if r.get('developmentSeen')}
    unseen_groups=[g for g in groups if g not in seen_groups]
    if seen_groups:
        assignments={g:'train' for g in groups}
        if len(unseen_groups)<2:reasons.append('need_new_validation_and_test_capture_groups')
        else:
            assignments[unseen_groups[-2]]='validation';assignments[unseen_groups[-1]]='test'
    else:assignments={g:('test' if i==len(groups)-1 else 'validation' if i==len(groups)-2 else 'train') for i,g in enumerate(groups)}
    if len(groups)<CONFIG['minGroups']:reasons.append('need_separate_capture_groups')
    if len(groups)>=CONFIG['minGroups'] or seen_groups:
        for name in ['train','validation','test']:
            rows=[r for r in ordered if assignments[r['group']]==name]
            positives=sum(r['category']=='thanks' for r in rows);negatives=len(rows)-positives
            splits[name]={'groups':sorted({r['group'] for r in rows}),'samples':[r['sampleNumber'] for r in rows], 'thanks':positives,'not_thanks':negatives}
            if min(positives,negatives)<CONFIG['minimumPerClass'][name]:reasons.append('insufficient_classes_'+name)
    return {'schema':CONFIG['id'],'sampleCount':len(items),'eligibleSamples':len(eligible),'counts':counts,'groupCount':len(groups),
            'readyForPilotTraining':not reasons,'reasons':sorted(set(reasons)),'splits':splits,'productionEligible':False}

def inventory(root=ROOT):
    db=_project_db_connect((root/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    try:
        owner=db.execute('SELECT user_id FROM sign_samples WHERE active=1 ORDER BY updated_at DESC LIMIT 1').fetchone()
        if not owner:return []
        rows=db.execute("SELECT s.*,r.created_at,r.media_file,n.category,n.sequence FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id JOIN sample_numbers n ON n.record_id=s.record_id AND n.user_id=s.user_id AND n.category=json_extract(s.payload,'$.category') WHERE s.active=1 AND s.user_id=? ORDER BY r.created_at",(owner['user_id'],)).fetchall()
        prefixes=json.loads((ROOT/'shared/sample-numbering.json').read_text(encoding='utf8'));items=[]
        for row in rows:
            payload=json.loads(row['payload']);group,source=group_key(row['user_id'],payload['performer'],payload['batch'],row['created_at'])
            items.append({'sampleNumber':f"{prefixes[row['category']]}.{row['sequence']}",'category':row['category'],
                          'recordId':row['record_id'],'ownerId':row['user_id'],'revision':row['revision'],
                          'sourceHash':row['source_sha256'],'group':group,'groupSource':source,'createdAt':row['created_at'],
                          'developmentSeen':row['media_file'].replace('\\','/').startswith('training/train/'),
                          'reviewed':payload['reviewed'],'complete':payload['complete']})
        return items
    finally:db.close()
