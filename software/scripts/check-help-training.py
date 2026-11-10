import json,sys,subprocess,unittest
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from help_training_data import split_help_development,CONFIG

def inventory():
    rows=[]
    for g,categories in enumerate([['thanks','background'],['help','help','other','other'],['thanks','other'],['help','help']]):
        for i,category in enumerate(categories):rows.append({'category':category,'reviewed':True,'complete':True,'createdAt':g*10+i,'sampleNumber':f'{g}.{i}','sourceHash':f'{g}-{i}','group':str(g)})
    return rows
class HelpTrainingTests(unittest.TestCase):
    def test_complete_groups_and_both_classes(self):
        r=split_help_development(inventory());self.assertTrue(r['readyForDevelopmentTraining'])
        self.assertEqual(r['splits']['train']['groups'],['0','1']);self.assertEqual(r['splits']['validation']['groups'],['2','3']);self.assertEqual(r['independentTestSamples'],0)
    def test_duplicates_and_incomplete_help_stop_training(self):
        rows=inventory();rows[-1]['sourceHash']=rows[0]['sourceHash'];self.assertIn('duplicate_source',split_help_development(rows)['reasons'])
        rows=inventory()
        for r in rows:
            if r['group']=='3':r['complete']=False
        self.assertFalse(split_help_development(rows)['readyForDevelopmentTraining'])
    def test_uncertain_and_unreviewed_not_used(self):
        rows=inventory();rows += [{'category':'uncertain','reviewed':True,'complete':True},{'category':'help','reviewed':False,'complete':True}]
        self.assertEqual(split_help_development(rows)['eligibleSamples'],10)
    def test_worker_supervised_fit_and_leakage_rejection(self):
        generator=np.random.default_rng(10);splits={}
        for split in ['train','validation']:
            values=[]
            for i in range(4):
                frames=generator.normal(0,.01,(30,153)).astype(np.float32)
                if i%2:frames[8:18,3]+=.8
                values.append({'sampleNumber':f'30.{i+1}','sourceHash':f'{split}-{i}','group':split,'label':i%2,'frames':frames.tolist()})
            splits[split]=values
        payload={'protocol':CONFIG['id'],'splits':splits};command=[str(ROOT/'.venv-anny/Scripts/python.exe'),'-B',str(ROOT/'scripts/help-training-worker.py')]
        result=subprocess.run(command,input=json.dumps(payload).encode(),capture_output=True,timeout=120)
        self.assertEqual(result.returncode,0,result.stderr.decode(errors='replace'));report=json.loads(result.stdout)
        self.assertTrue(report['trainingStarted']);self.assertFalse(report['modelPersisted']);self.assertLess(report['finalTrainLoss'],report['initialTrainLoss'])
        for split in ['train','validation']:
            counts=report['evaluations'][split];self.assertEqual(sum(counts[k] for k in ['tp','fn','fp','tn']),4)
        splits['validation'][0]['group']='train'
        result=subprocess.run(command,input=json.dumps(payload).encode(),capture_output=True,timeout=30);self.assertNotEqual(result.returncode,0);self.assertIn('group_leakage',result.stderr.decode(errors='replace'))

if __name__=='__main__':unittest.main()
