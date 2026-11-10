"""Checks for grouped splits and causal body-relative inputs."""
import sys,unittest
from pathlib import Path
from types import SimpleNamespace as NS
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from me_training_data import split_me_development
from me_training_features import body_training_frame
from me_tcn_inference import MeTCN,SHAPES

def observation(offset=0,scale=1):
    points=[NS(x=(.3+i*.006)*scale+offset,y=(.3+(i%4)*.02)*scale+offset,z=i*.001*scale) for i in range(21)]
    h=NS(multi_hand_landmarks=[NS(landmark=points)],multi_handedness=[NS(classification=[NS(label='Right',score=.95)])])
    body=[NS(x=.5,y=.2,visibility=1) for _ in range(33)]
    body[11]=NS(x=.3*scale+offset,y=.2*scale+offset,visibility=1)
    body[12]=NS(x=.7*scale+offset,y=.2*scale+offset,visibility=1)
    return h,NS(pose_landmarks=NS(landmark=body))

def items():
    return [dict(sampleNumber=str(i),category=category,group=group,groupSource='declared_capture_round' if group=='new' else 'record_date_coarse',createdAt=i,sourceHash=str(i),complete=True,reviewed=True) for i,(category,group) in enumerate([('me','old')]*3+[('other','old')]*2+[('me','new')]*3+[('other','new')]*2)]

class Checks(unittest.TestCase):
    def test_whole_capture_group_validation(self):
        r=split_me_development(items());self.assertTrue(r['readyForDevelopmentTraining'])
        self.assertEqual(r['splits']['validation']['samples'],['5','6','7','8','9'])
        self.assertFalse(set(r['splits']['train']['groups'])&set(r['splits']['validation']['groups']))
        self.assertEqual(r['independentTestSamples'],0)

    def test_duplicate_source_rejected(self):
        rows=items();rows[-1]['sourceHash']=rows[0]['sourceHash']
        self.assertIn('duplicate_source',split_me_development(rows)['reasons'])

    def test_no_invented_round(self):
        rows=items()
        for r in rows:r['groupSource']='record_date_coarse'
        self.assertIn('validation_round_not_confirmed',split_me_development(rows)['reasons'])
        for r in rows:r['group']='same'
        self.assertFalse(split_me_development(rows)['readyForDevelopmentTraining'])

    def test_excluded_and_incomplete_not_training_truth(self):
        rows=items();rows[0]['complete']=False;rows[-1]['category']='uncertain'
        r=split_me_development(rows);self.assertEqual(r['eligibleSamples'],8);self.assertFalse(r['readyForDevelopmentTraining'])

    def test_feature_shape_and_presence(self):
        h,p=observation();v=body_training_frame(h,p,1/30,1)
        self.assertEqual(v.shape,(178,));self.assertTrue(np.isfinite(v).all());self.assertEqual(v[-1],1)
        self.assertTrue(np.all(v[153:165]==0));self.assertEqual(v[176],1)

    def test_body_features_relative_to_torso(self):
        h,p=observation();a=body_training_frame(h,p,1/30,1)
        h,p=observation(.1,.8);b=body_training_frame(h,p,1/30,1)
        np.testing.assert_allclose(a[153:],b[153:],atol=1e-6)

    def test_missing_reference_never_imputed(self):
        h,p=observation();p.pose_landmarks=None
        self.assertTrue(np.all(body_training_frame(h,p,1/30,1)[153:]==0))
        h,p=observation();p.pose_landmarks.landmark[11].visibility=.1
        self.assertTrue(np.all(body_training_frame(h,p,1/30,1)[153:]==0))

    def test_missing_hand_retains_only_body_flag(self):
        h,p=observation();h.multi_hand_landmarks=[];h.multi_handedness=[]
        v=body_training_frame(h,p,1/30,1);self.assertTrue(np.all(v[153:177]==0));self.assertEqual(v[-1],1)
        with self.assertRaises(ValueError):body_training_frame(h,p,1/30,float('nan'))

    def test_numpy_runtime_rejects_bad_arrays_and_input(self):
        arrays={k:np.zeros(shape,np.float32) for k,shape in SHAPES.items()};arrays['std'][:]=1
        model=MeTCN(arrays);self.assertEqual(model.probability(np.zeros((6,178))),.5)
        for x in (np.zeros((1,178)),np.zeros((6,153)),np.full((6,178),np.nan)):
            with self.assertRaises(ValueError):model.probability(x)
        with self.assertRaises(ValueError):MeTCN({**arrays,'extra':np.array(1)})
        arrays['std'][0]=0
        with self.assertRaises(ValueError):MeTCN(arrays)

if __name__=='__main__':unittest.main()
