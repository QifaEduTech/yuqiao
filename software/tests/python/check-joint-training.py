import sys,unittest,tempfile,json,subprocess,os
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'server'))
from joint_model import JointTCN
from unified_runtime import UnifiedStream

class Checks(unittest.TestCase):
    def test_variable_class_model_preserves_common_refusal(self):
        for c in [2,5,35,65]:
            arrays={'first.weight':np.zeros((32,178,3),np.float32),'first.bias':np.zeros(32,np.float32),'second.weight':np.zeros((32,32,3),np.float32),'second.bias':np.zeros(32,np.float32),'classifier.weight':np.zeros((c,64),np.float32),'classifier.bias':np.zeros(c,np.float32),'mean':np.zeros(178,np.float32),'std':np.ones(178,np.float32)}
            arrays['classifier.bias'][1]=9;model=JointTCN(arrays=arrays,classes=c)
            x=np.zeros((30,178),np.float32);self.assertEqual(model.classify(x),0);x[:,74]=x[:,177]=1;self.assertEqual(model.classify(x),1)
            stream=UnifiedStream(model);events=[]
            for i in range(90):
                r=stream.push(i/30,x[0] if i<45 else np.zeros(178,np.float32))
                if r['event']:events.append(r['event'])
            self.assertEqual(len(events),1)
            # An anonymous reject row must not become an output word or allow
            # the strongest remaining word to inherit its probability.
            if c<=63:
                arrays['reject.weight']=np.zeros((2,64),np.float32)
                arrays['reject.bias']=np.array([12,8],np.float32)
                retired=JointTCN(arrays=arrays,classes=c)
                self.assertEqual(retired.classify(x),0)
                self.assertEqual(len(retired.probabilities(x)),c)
                self.assertAlmostEqual(float(retired.probabilities(x).sum()),1,places=5)
    def test_real_scratch_fit_export_with_no_test_input(self):
        parent=ROOT/'.runtime-logs/joint-fit-tests';parent.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as tmp:
            d=Path(tmp);labels=[{'signId':'synthetic.a','text':'合成甲'},{'signId':'synthetic.b','text':'合成乙'}]
            (d/'plan.json').write_text(json.dumps({'labels':labels,'seed':1701,'maxEpochs':4,'fitSeconds':60}),encoding='utf8')
            rows=[]
            for split in ['train','validation']:
                for label in range(3):
                    for i in range(3):
                        frames=np.zeros((20+i,178),np.float32);frames[:,0]=label;frames[:,74]=frames[:,177]=int(label>0)
                        rows.append({'frames':frames.tolist(),'label':label,'split':split})
            (d/'fit-features.json').write_text(json.dumps(rows),encoding='utf8')
            run=subprocess.run([str(ROOT/'.venv-anny/Scripts/python.exe'),'-B',str(ROOT/'server/joint_fit.py'),str(d),str(os.getpid())],capture_output=True,cwd=ROOT,timeout=90)
            self.assertEqual(run.returncode,0,run.stderr.decode(errors='replace'));result=json.loads(run.stdout);self.assertEqual(result['initialization'],'random')
            model=JointTCN(d);self.assertEqual(model.w['classifier.weight'].shape,(3,64));self.assertLess(json.loads((d/'model.json').read_text(encoding='utf8'))['parityMaxError'],1e-5)

if __name__=='__main__':unittest.main()
