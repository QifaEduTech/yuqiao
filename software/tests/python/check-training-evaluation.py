"""Synthetic counts: current-word exams do not depend on old-word recordings."""
from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server'))
from training_evaluation import summarize_test_counts

class ExamChecks(unittest.TestCase):
    def test_current_word_passes_without_regression(self):
        self.assertTrue(summarize_test_counts({'tp':19,'fn':1,'fp':1,'tn':19})['passed'])
    def test_small_sample_does_not_pass(self):
        self.assertFalse(summarize_test_counts({'tp':3,'fn':0,'fp':0,'tn':3})['passed'])
    def test_false_positives_still_fail(self):
        self.assertFalse(summarize_test_counts({'tp':20,'fn':0,'fp':2,'tn':18})['passed'])
    def test_no_output_does_not_pass(self):
        self.assertFalse(summarize_test_counts({'tp':0,'fn':20,'fp':0,'tn':20})['passed'])
    def test_invalid_counts_rejected(self):
        with self.assertRaises(ValueError):summarize_test_counts({'tp':20.5,'fn':0,'fp':0,'tn':20})

if __name__=='__main__':unittest.main()
