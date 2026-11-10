"""Remove local illustration references while preserving words, definitions and source URLs."""
from pathlib import Path
from datetime import datetime,timezone
import json,sqlite3
ROOT=Path(__file__).resolve().parents[1]
now=datetime.now(timezone.utc).isoformat(timespec='seconds')

def save(path,data):
    temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');temp.replace(path)

def strip_images(entry):
    urls=list(entry.get('referenceImageUrls',[]))
    for image in entry.pop('gestureImages',[]):
        if image.get('sourceUrl') and image['sourceUrl'] not in urls:urls.append(image['sourceUrl'])
    if urls and not entry.get('imageUrls'):entry['referenceImageUrls']=urls
    entry.pop('sourceImagePending',None);entry.pop('imagePending',None)

path=ROOT/'shared/sign-dictionary.json';dictionary=json.loads(path.read_text(encoding='utf-8'))
for entry in dictionary['entries']:
    strip_images(entry)
    if entry.get('sourceId'):
        entry['source']='便民查询网 · 原站动作解释'
        entry['note']='动作解释供查阅，内容待专业核对；制作动作时按需打开原站参考图。'
    elif entry['id']=='csl.yes':entry['note']='用户提供动作解释与原图链接；制作动作时按需查看原图。尚无独立动画或识别能力。'
dictionary['scope']='查阅词语、动作解释和来源，已有数字人动作可直接预览。参考图不在本机保存或展示，后续制作动作时按需浏览原站。收录词条不等于模型已支持识别。'
save(path,dictionary)
for relative,key in [('shared/sign-dictionary-content.json','entries'),('shared/sign-dictionary-full-source.json','terms')]:
    path=ROOT/relative
    if not path.exists():continue
    data=json.loads(path.read_text(encoding='utf-8'))
    for entry in data[key]:strip_images(entry)
    data['localImageStorage']='removed_by_user';save(path,data)
db_path=ROOT/'.runtime-logs/dictionary-full/state.sqlite'
if db_path.exists():
    db=sqlite3.connect(db_path);db.execute("update media set status='omitted_by_user',asset=null,error=null,retry_at=0")
    db.execute('insert or replace into meta(key,value) values(?,?)',('imagePolicy',json.dumps('on_demand_source_reference')));db.commit();db.execute('pragma wal_checkpoint(TRUNCATE)');db.execute('vacuum');db.close()
for relative in ['.runtime-logs/dictionary-full/status.json','web/public/dictionary-crawl-status.json']:
    path=ROOT/relative
    if not path.exists():continue
    status=json.loads(path.read_text(encoding='utf-8'));status.update({'stage':'stopped_by_user','updatedAt':now,'detail':'用户已取消配图下载；保留文字与来源，制作动作时按需查看原站。','imageCollectionCancelled':True,'localImagesRetained':False,'imagesDone':0,'retrying':0})
    status.pop('retryAfterSeconds',None);status.pop('imageIntervalSeconds',None);status['publication'].pop('illustrated',None);save(path,status)
print(json.dumps({'entries':len(dictionary['entries']),'imageReferencesRemoved':True,'wordsAndDefinitionsPreserved':True}))
