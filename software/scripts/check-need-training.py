import json,sys,subprocess,unittest
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from need_training_data import split_need_development,CONFIG

def rows():
    values=[]
    for group,cats in enumerate([['need','need','other','other'],['help','thanks'],['need','need']]):
        for i,category in enumerate(cats):values.append({'category':category,'reviewed':True,'complete':True,'createdAt':group*10+i,'sampleNumber':f'{group}.{i}','sourceHash':f'{group}-{i}','group':str(group)})
    return values

class NeedTrainingTests(unittest.TestCase):
    def test_actual_groups_never_split_sources(self):
        r=split_need_development(rows());self.assertTrue(r['readyForDevelopmentTraining']);self.assertEqual(r['splits']['train']['groups'],['0']);self.assertEqual(r['splits']['validation']['groups'],['1','2']);self.assertEqual(r['independentTestSamples'],0);self.assertFalse(r['productionEligible'])
    def test_one_group_incomplete_unreviewed_duplicates_reject(self):
        a=rows()
        for r in a:
            if r['category']=='need':r['group']='0'
        self.assertFalse(split_need_development(a)['readyForDevelopmentTraining'])
        for field in ['complete','reviewed']:
            a=rows()
            for r in a:
                if r['group']=='2':r[field]=False
            self.assertFalse(split_need_development(a)['readyForDevelopmentTraining'])
        a=rows();a[-1]['sourceHash']=a[0]['sourceHash'];self.assertIn('duplicate_source',split_need_development(a)['reasons'])
    def test_uncertain_excluded(self):
        a=rows()+[{'category':'uncertain','reviewed':True,'complete':True}];self.assertEqual(split_need_development(a)['eligibleSamples'],8)
    def test_worker_fit_no_export_and_leakage(self):
        random=np.random.default_rng(40);splits={}
        for split in ['train','validation']:
            samples=[]
            for i in range(4):
                frames=random.normal(0,.01,(30,153)).astype(np.float32)
                if i%2:frames[6:20,65]+=.7
                samples.append({'sampleNumber':f'{split}.{i}','sourceHash':f'{split}-{i}','group':split,'label':i%2,'frames':frames.tolist()})
            splits[split]=samples
        payload={'protocol':CONFIG['id'],'splits':splits};command=[str(ROOT/'.venv-anny/Scripts/python.exe'),'-B',str(ROOT/'scripts/help-training-worker.py')]
        def run():return subprocess.run(command,input=json.dumps(payload).encode(),capture_output=True,timeout=120)
        out=run();self.assertEqual(out.returncode,0,out.stderr.decode(errors='replace'));report=json.loads(out.stdout);self.assertFalse(report['modelPersisted']);self.assertLess(report['finalTrainLoss'],report['initialTrainLoss']);self.assertIn('needProbability',report['evaluations']['validation']['samples'][0]);self.assertFalse(report['productionChanged'])
        payload['exportModel']=True;self.assertNotEqual(run().returncode,0);payload.pop('exportModel');splits['validation'][0]['group']='train';self.assertNotEqual(run().returncode,0)

if __name__=='__main__':unittest.main()
