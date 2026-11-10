"""Only synthetic training here; no account data is opened or used."""
import json
from pathlib import Path
import sys
import unittest
import subprocess
import numpy as np
import torch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from sign_binary_tcn import BinaryTCN,train_candidate
from sign_training_data import split_inventory,group_key

class TrainingTests(unittest.TestCase):
    def test_previously_debugged_capture_groups_are_never_recycled_as_test(self):
        rows=[]
        for g in range(5):
            for i in range(4):rows.append({'category':'thanks' if i<2 else 'other','reviewed':True,'complete':True,'createdAt':g*10+i,'sampleNumber':f'{g}.{i}','sourceHash':f'{g}-{i}','group':str(g),'developmentSeen':g<3})
        old=split_inventory(rows[:12]);self.assertFalse(old['readyForPilotTraining']);self.assertEqual(old['splits']['test']['samples'],[]);self.assertEqual(len(old['splits']['train']['samples']),12)
        new=split_inventory(rows);self.assertTrue(new['readyForPilotTraining']);self.assertEqual(new['splits']['test']['groups'],['4']);self.assertEqual(new['splits']['validation']['groups'],['3'])
    def test_help_is_not_silently_relabelled_into_thanks_training(self):
        row={'category':'help','reviewed':True,'complete':True,'createdAt':1,'sampleNumber':'30.1','sourceHash':'help-source','group':'help-group'}
        report=split_inventory([row]);self.assertEqual(report['eligibleSamples'],0);self.assertEqual(report['counts'],{'thanks':0,'not_thanks':0})
    def test_padding_does_not_change_prediction(self):
        torch.manual_seed(1);model=BinaryTCN();model.eval();x=torch.randn(2,20,153);lengths=torch.tensor([20,11])
        longer=torch.cat([x,torch.randn(2,12,153)*100],1)
        with torch.no_grad():torch.testing.assert_close(model(x,lengths),model(longer,lengths),atol=1e-5,rtol=1e-5)
    def test_legacy_serials_are_not_independent_capture_groups(self):
        a,_=group_key('owner','person','26.1',1792100000000);b,_=group_key('owner','person','27.2',1792100000500)
        self.assertEqual(a,b)
        c,origin=group_key('owner','person','capture:20261016:130000:abcdef',1792100000000)
        self.assertNotEqual(a,c);self.assertEqual(origin,'declared_capture_round')
    def test_group_partition_and_duplicate_rejection(self):
        rows=[]
        for g in range(3):
            for i in range(4):rows.append({'category':'thanks' if i<2 else 'other','reviewed':True,'complete':True,'createdAt':g*10+i,'sampleNumber':f'{g}.{i}','sourceHash':f'source-{g}-{i}','group':str(g)})
        result=split_inventory(rows);self.assertTrue(result['readyForPilotTraining'])
        self.assertEqual(result['splits']['test']['groups'],['2']);self.assertEqual(result['splits']['train']['groups'],['0'])
        self.assertFalse(split_inventory(rows[:4])['readyForPilotTraining'])
        rows[-1]['sourceHash']=rows[0]['sourceHash'];self.assertIn('duplicate_source',split_inventory(rows)['reasons'])
    def test_synthetic_training_updates_parameters_and_reduces_loss(self):
        generator=torch.Generator().manual_seed(7)
        x=torch.randn((16,32,153),generator=generator)*.02;y=torch.tensor([0.,1.]*8)
        x[y==1,10:15,0]+=2;lengths=torch.full((16,),32)
        model,mean,std,history=train_candidate(x[:12],lengths[:12],y[:12],x[12:],lengths[12:],y[12:],epochs=50,patience=10)
        self.assertLess(history[-1]['trainLoss'],history[0]['trainLoss'])
        with torch.no_grad():output=model((x[12:]-mean)/std,lengths[12:])
        self.assertTrue(torch.isfinite(output).all())
        print(json.dumps({'syntheticOnly':True,'epochs':len(history),'initialLoss':history[0]['trainLoss'],'finalLoss':history[-1]['trainLoss']}))
    def test_isolated_worker_protocol_and_group_leakage_guard(self):
        generator=np.random.default_rng(9);splits={}
        for name in ['train','validation','test']:
            rows=[]
            for i in range(4):
                frames=generator.normal(0,.01,(24,153)).astype(np.float32)
                if i%2:frames[8:12,0]+=1
                rows.append({'group':name,'sourceHash':name+str(i),'label':i%2,'frames':frames.tolist()})
            splits[name]=rows
        payload={'featureProtocol':'hands-local-absolute-motion-153-v1','epochs':15,'patience':4,'seed':9,'splits':splits}
        command=[sys.executable,'-B',str(Path(__file__).with_name('sign-training-worker.py'))]
        result=subprocess.run(command,input=json.dumps(payload).encode(),capture_output=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stderr.decode(errors='replace'));report=json.loads(result.stdout)
        self.assertTrue(report['trainingStarted']);self.assertFalse(report['modelPersisted']);self.assertEqual(report['testSamples'],4)
        best=float('inf');selected=None
        for entry in report['history']:
            if entry['validationLoss']<best-1e-5:best=entry['validationLoss'];selected=entry['epoch']
        self.assertEqual(report['selectedEpoch'],selected)
        for evaluation in report['evaluations'].values():
            rows=evaluation['samples'];self.assertEqual(len(rows),4)
            self.assertEqual(sum(evaluation[k] for k in ['truePositive','falsePositive','falseNegative','trueNegative']),len(rows))
            for row in rows:self.assertEqual(row['prediction'],int(row['thanksProbability']>=.5))
        self.assertNotIn('sourceHash',json.dumps(report));self.assertNotIn('"frames": [',json.dumps(report))
        splits['validation'][0]['group']='train'
        invalid=subprocess.run(command,input=json.dumps(payload).encode(),capture_output=True,timeout=60)
        self.assertNotEqual(invalid.returncode,0);self.assertIn('capture_group_leakage',invalid.stderr.decode(errors='replace'))

if __name__=='__main__':unittest.main()
