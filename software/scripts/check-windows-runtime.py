"""No camera, videos or labels: validate imports and existing inference weights only."""
from pathlib import Path
import sys
import json
import hashlib
import cv2
import mediapipe
import numpy

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'server'))
from help_tcn_inference import HelpTCN
from need_tcn_inference import NeedTCN
from me_tcn_inference import MeTCN
from sign_worker import classifier

HelpTCN()
NeedTCN()
MeTCN()
classifier()
print('Four model loads and Python imports passed; this is not accuracy validation.')
