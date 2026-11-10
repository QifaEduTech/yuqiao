"""Session-local pose graph using already installed assets, no downloads."""
import os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def pose_graph():
    import mediapipe as mp
    from mediapipe.framework import calculator_pb2
    from mediapipe.python import solution_base
    package=Path(mp.__file__).resolve().parent.parent
    config=calculator_pb2.CalculatorGraphConfig()
    config.ParseFromString((package/'mediapipe/modules/pose_landmark/pose_landmark_cpu.binarypb').read_bytes())
    original=solution_base.resource_util.set_resource_dir
    solution_base.resource_util.set_resource_dir=lambda path:original(os.path.relpath(path,ROOT))
    try:
        return solution_base.SolutionBase(graph_config=config,side_inputs={'model_complexity':1,'smooth_landmarks':True,'enable_segmentation':False,'smooth_segmentation':False,'use_prev_landmarks':True},calculator_params={'posedetectioncpu__TensorsToDetectionsCalculator.min_score_thresh':.5,'poselandmarkbyroicpu__tensorstoposelandmarksandsegmentation__ThresholdingCalculator.threshold':.5},outputs=['pose_landmarks','pose_world_landmarks'])
    finally:solution_base.resource_util.set_resource_dir=original
