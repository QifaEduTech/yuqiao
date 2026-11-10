"""Inspect registered pilot inventory; no inference, training, or media export."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from sign_training_data import inventory,split_inventory

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--latest-owner',action='store_true',required=True)
parser.parse_args()
items=inventory();result=split_inventory(items)
result['groupingSources']=sorted({r['groupSource'] for r in items})
result['trainingStarted']=False
print(json.dumps(result,ensure_ascii=True))
