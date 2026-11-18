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
from unified_live import load_model
load_model()
print('One unified model load and Python imports passed; this is not accuracy validation.')
