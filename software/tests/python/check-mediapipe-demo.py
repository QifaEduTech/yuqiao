"""Exercise CLI selection/export on generated non-person footage only."""
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT/'scripts/mediapipe-demo.py'


def run(*args, success=True):
    result = subprocess.run([sys.executable,'-B',str(SCRIPT),*map(str,args)],cwd=ROOT,capture_output=True,encoding='utf-8')
    assert (result.returncode == 0) == success, result.stdout+'\n'+result.stderr
    return result.stdout+result.stderr


def main():
    (ROOT/'data').mkdir(exist_ok=True)
    spec=importlib.util.spec_from_file_location('mediapipe_demo',SCRIPT)
    demo=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(demo)
    # Drawing converts mirrored detector coordinates back to source pixels.
    canvas=np.zeros((100,100,3),np.uint8)
    lm=SimpleNamespace(landmark=[SimpleNamespace(x=.2,y=.4),SimpleNamespace(x=.3,y=.4)])
    demo.draw_points(canvas,lm,[(0,1)],(0,255,0))
    assert canvas[40,79,1] > 0 and canvas[40,20,1] == 0
    with tempfile.TemporaryDirectory(prefix='骨架导出检查-',dir=ROOT/'data') as temp:
        directory=Path(temp)
        source=directory/'原片.avi'
        writer=cv2.VideoWriter(str(source),cv2.VideoWriter_fourcc(*'MJPG'),30,(320,240))
        assert writer.isOpened()
        for i in range(90):
            frame=np.zeros((240,320,3),np.uint8)
            cv2.rectangle(frame,(i,100),(i+20,120),(80,80,80),-1)
            writer.write(frame)
        writer.release()
        original=hashlib.sha256(source.read_bytes()).hexdigest()
        selection=directory/'selection.json'
        run('mark','--video',source,'--start',.5,'--end',2.0,'--selection',selection)
        picked=json.loads(selection.read_text(encoding='utf-8'))
        assert picked['startFrame']==15 and picked['endFrameInclusive']==60
        run('mark','--video',source,'--start',2,'--end',1,'--selection',directory/'bad.json',success=False)
        run('mark','--video',source,'--start',0,'--end',4,'--selection',directory/'bad.json',success=False)
        run('mark','--video',source,'--start',.5,'--end',2,'--selection',selection,success=False)
        out=directory/'result'
        run('extract','--selection',selection,'--out',out)
        rows=np.load(out/'features.npy',allow_pickle=False)
        summary=json.loads((out/'summary.json').read_text(encoding='utf-8'))
        landmarks=json.loads((out/'landmarks.json').read_text(encoding='utf-8'))
        assert rows.shape==(46,178) and np.isfinite(rows).all()
        assert summary['handsDetectedFrames']==0 and not summary['quality']['passed']
        assert len(landmarks['frames'])==46 and landmarks['frames'][0]['sourceFrame']==15
        assert abs(landmarks['frames'][-1]['sourceSeconds']-2)<.0001
        for name,width in [('original.avi',320),('skeleton.avi',320),('comparison.avi',640)]:
            cap=cv2.VideoCapture(str(out/name));count=0
            while True:
                ok,frame=cap.read()
                if not ok:break
                assert frame.shape==(240,width,3)
                count+=1
            cap.release()
            assert count==46,(name,count)
        assert all((out/(name+'.png')).is_file() for name in ('start','middle','end'))
        assert hashlib.sha256(source.read_bytes()).hexdigest()==original
        run('extract','--selection',selection,'--out',out,success=False)
        with source.open('ab') as stream:stream.write(b'changed')
        run('extract','--selection',selection,'--out',directory/'changed',success=False)
    print('PASS: 选段边界、无效范围、拒绝覆盖、源哈希保护、178维导出、空画面拒识、三路同步视频、截图、镜像坐标转换。')
    print('仅程序生成的非人物视频；未验证真人骨架质量或识别准确率。')


if __name__=='__main__':main()
