"""Export only allowlisted inference assets; never inspect data/media or the database."""
from pathlib import Path
import sys,json,hashlib,struct,shutil
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from help_tcn_inference import HelpTCN
from need_tcn_inference import NeedTCN
from me_tcn_inference import MeTCN
DEST=ROOT/'.runtime-logs/android-assets/models'
ORDER=['mean','std','first.weight','first.bias','second.weight','second.bias','classifier.weight','classifier.bias']

def export():
    DEST.mkdir(parents=True,exist_ok=True)
    entries=[]
    for category,label,folder,cls,dim in [
        ('help','帮助','help-video-tcn/v1',HelpTCN,153),
        ('need','需要','need-video-tcn/experimental-v1',NeedTCN,171),
        ('me','我','me-video-tcn/experimental-v1',MeTCN,178)]:
        source=ROOT/'models'/folder
        model=cls(directory=source) # Validates original artifact hash and feature protocol.
        name=category+'.bin'
        blob=b'YQTCN001'+struct.pack('<i',dim)+b''.join(model.w[k].astype('<f4').tobytes() for k in ORDER)
        (DEST/name).write_bytes(blob)
        tests=[]
        for length in [2,12,48,140]:
            # Synthetic features for numerical parity, not recorded or training examples.
            x=(model.w['mean']+model.w['std']*np.sin(np.arange(length*dim,dtype=np.float32).reshape(length,dim)*.137)*.7).astype(np.float32)
            file=f'{category}-synthetic-{length}.bin';data=x.astype('<f4').tobytes();(DEST/file).write_bytes(data)
            tests.append({'file':file,'frames':length,'expected':model.probability(x),'sha256':hashlib.sha256(data).hexdigest()})
        entries.append({'category':category,'label':label,'file':name,'dimensions':dim,'version':model.manifest['version'],'featureProtocol':model.manifest['featureProtocol'],'sourceSha256':model.manifest['artifactSha256'],'sha256':hashlib.sha256(blob).hexdigest(),'bytes':len(blob),'runtime':'java-tcn','cameraReady':False,'syntheticTests':tests})
    source=ROOT/'models/sign-word-baseline/dynamic_gesture_classifier.tflite'
    data=source.read_bytes();(DEST/'thanks.tflite').write_bytes(data)
    shutil.copyfile(ROOT/'models/sign-word-baseline/dynamic_gesture_label.csv',DEST/'thanks-labels.csv')
    shutil.copyfile(ROOT/'models/sign-word-baseline/LICENSE',DEST/'thanks-LICENSE.txt')
    shutil.copyfile(ROOT/'shared/realtime-targets.json',DEST/'realtime-targets.json')
    shutil.copyfile(ROOT/'shared/realtime-sign.json',DEST/'realtime-sign.json')
    entries.append({'category':'thanks','label':'谢谢','file':'thanks.tflite','sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'runtime':'tflite-pending','cameraReady':False,'note':'Requires original label mapping, landmark feature extraction and thumb-motion gate; classifier alone is insufficient.'})
    manifest={'schemaVersion':1,'bundleId':'yuqiao-android-preview-1','containsTrainingVideos':False,'containsPrivateRecords':False,'containsCredentials':False,'cameraRecognitionReady':False,'numericalTolerance':2e-5,'entries':entries}
    (DEST/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    allowed={p.name for p in DEST.iterdir() if p.is_file()}
    assert all(p.endswith(('.bin','.tflite','.csv','.txt','.json')) for p in allowed)
    print(json.dumps({'models':len(entries),'modelBytes':sum(e['bytes'] for e in entries),'assetBytes':sum(p.stat().st_size for p in DEST.iterdir()),'syntheticCases':12,'trainingVideos':0,'credentials':0}))
if __name__=='__main__':export()
