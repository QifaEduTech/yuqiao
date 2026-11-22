"""Local, read-only-video demonstration: select, extract and compare.

Reuses the production observation function; never registers data, trains a model,
reads a database or changes active weights. Run with .venv-sign Python.
"""
import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def write_new(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)


def timeline(path):
    import cv2
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError('无法打开视频，请核对路径或用Windows相机录制MP4。')
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not math.isfinite(fps) or not 1 <= fps <= 120:
        cap.release()
        raise ValueError('视频帧率无效，需要有效帧率的视频。')
    times = []
    fallback = False
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if frame.size > 4096 * 2160 * 3:
                raise ValueError('请使用1080p或720p视频。')
            t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
            if not math.isfinite(t) or t < 0 or times and t <= times[-1]:
                t = len(times) / fps
                fallback = True
            if times and t <= times[-1]:
                raise ValueError('视频时间戳异常，请重新录制。')
            if t > 30.25 or len(times) >= 3690:
                raise ValueError('演示视频请控制在30秒以内。')
            times.append(t)
    finally:
        cap.release()
    if len(times) < 2:
        raise ValueError('视频有效帧不足，可能没有正确结束录制。')
    return fps, times, fallback


def scaled(frame):
    import cv2
    height, width = frame.shape[:2]
    factor = min(1, 640 / max(height, width))
    return cv2.resize(frame, (max(2, round(width * factor)), max(2, round(height * factor))))


def mark(path, target, start, end):
    path = Path(path).resolve()
    fps, times, fallback = timeline(path)
    if not 0 <= start < end <= times[-1]:
        raise ValueError(f'范围需满足 0 <= 开始 < 结束 <= {times[-1]:.3f} 秒。')
    first = next(i for i, t in enumerate(times) if t >= start)
    last = max(i for i, t in enumerate(times) if t <= end)
    if last <= first or times[last] - times[first] < .5:
        raise ValueError('请至少保留0.5秒和完整动作。')
    value = {'schema': 'mediapipe-demo-selection-v1', 'source': str(path),
             'sourceSha256': digest(path), 'startFrame': first, 'endFrameInclusive': last,
             'startSeconds': times[first], 'endSecondsInclusive': times[last],
             'sourceFps': fps, 'timestampFallbackUsed': fallback,
             'note': '仅演示选段，未登记标签、训练用途或真实拍摄组。'}
    write_new(target, value)
    print(f'已保存选段：{Path(target).resolve()}')
    print(f'原片 {times[first]:.3f}s 至 {times[last]:.3f}s，包含 {last-first+1} 帧。')


def select(args):
    import cv2
    path = Path(args.video).resolve()
    if Path(args.selection).exists():
        raise ValueError('选段文件已存在；请换成need-02.json等新文件名。')
    fps, times, _ = timeline(path)
    cap = cv2.VideoCapture(str(path))
    name = 'MediaPipe Demo - Select'
    cv2.namedWindow(name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(name, 1000, 680)
    cv2.createTrackbar('Frame', name, 0, len(times)-1, lambda _: None)
    position, first, last, playing = 0, None, None, False
    message = 'Mark A, mark B, then S to save. Q cancels.'
    try:
        while True:
            position = cv2.getTrackbarPos('Frame', name)
            cap.set(cv2.CAP_PROP_POS_FRAMES, position)
            ok, frame = cap.read()
            if not ok:
                raise ValueError('此帧无法回放，请使用新录制的视频。')
            canvas = cv2.copyMakeBorder(scaled(frame), 0, 114, 0, 0, cv2.BORDER_CONSTANT)
            y = canvas.shape[0]-92
            labels = [f'Time {times[position]:.3f}s | Frame {position}/{len(times)-1}',
                      f'A: {times[first]:.3f}s' if first is not None else 'A: not set']
            labels[1] += f' | B: {times[last]:.3f}s' if last is not None else ' | B: not set'
            labels += ['SPACE play/pause | J previous | K next | A start | B end', message]
            for line in labels:
                cv2.putText(canvas, line, (8, y), cv2.FONT_HERSHEY_SIMPLEX, .43, (255,255,255), 1, cv2.LINE_AA)
                y += 24
            cv2.imshow(name, canvas)
            wait = max(1, round((times[min(position+1,len(times)-1)]-times[position])*1000)) if playing else 35
            key = cv2.waitKey(wait) & 255
            if cv2.getWindowProperty(name, cv2.WND_PROP_VISIBLE) < 1 or key in (27, ord('q')):
                print('已退出；本次没有保存选段。')
                return
            if key == ord(' '):
                playing = not playing
            elif key in (ord('j'), ord('k')):
                playing = False
                position = max(0, min(len(times)-1, position + (1 if key == ord('k') else -1)))
                cv2.setTrackbarPos('Frame', name, position)
            elif key == ord('a'):
                first, playing = position, False
            elif key == ord('b'):
                last, playing = position, False
            elif key == ord('s'):
                if first is None or last is None or last <= first or times[last]-times[first] < .5:
                    message = 'Set A before B; include at least 0.5 seconds.'
                else:
                    mark(path, args.selection, times[first], times[last])
                    return
            if playing:
                if position >= len(times)-1:
                    playing = False
                else:
                    cv2.setTrackbarPos('Frame', name, position+1)
    finally:
        cap.release()
        cv2.destroyAllWindows()


class ObservePose:
    """Expose the same pose result already used by production observation."""
    def __init__(self, graph):
        self.graph = graph
        self.last = None

    def process(self, values):
        self.last = self.graph.process(values)
        return self.last


def draw_points(canvas, landmarks, edges, color, visibility=False):
    import cv2
    height, width = canvas.shape[:2]
    points = landmarks.landmark
    def valid(index):
        p = points[index]
        return (not visibility or p.visibility >= .5) and math.isfinite(p.x) and math.isfinite(p.y) and 0 <= p.x <= 1 and 0 <= p.y <= 1
    def xy(index):
        # The production observation mirrors once; convert back to source view.
        return (round((1-points[index].x)*(width-1)), round(points[index].y*(height-1)))
    for a, b in edges:
        if valid(a) and valid(b):
            cv2.line(canvas, xy(a), xy(b), color, 2, cv2.LINE_AA)
    for index in {i for edge in edges for i in edge}:
        if valid(index):
            cv2.circle(canvas, xy(index), 3, color, -1, cv2.LINE_AA)


def extract(args):
    import cv2
    import numpy as np
    import mediapipe as mp
    from sign_worker import hand_graph
    from body_tracking import pose_graph
    from unified_observation import observe_unified_bgr
    from me_training_features import FEATURE_ID
    from unified_runtime import quality
    selection = json.loads(Path(args.selection).read_text(encoding='utf-8'))
    if selection.get('schema') != 'mediapipe-demo-selection-v1':
        raise ValueError('不支持的选段文件。')
    source = Path(selection['source'])
    if digest(source) != selection['sourceSha256']:
        raise ValueError('原视频已变化，请重新选段。')
    fps, times, fallback = timeline(source)
    first, last = selection['startFrame'], selection['endFrameInclusive']
    if not (isinstance(first, int) and isinstance(last, int) and 0 <= first < last < len(times)):
        raise ValueError('选段帧范围无效。')
    if last-first+1 > 1024:
        raise ValueError('选段超过1024帧，请使用30fps录制或缩短为完整单动作。')
    directory = Path(args.out).resolve()
    directory.mkdir(parents=True, exist_ok=False)
    write_new(directory/'selection.json', selection)
    cap = cv2.VideoCapture(str(source))
    writers = []
    vectors, observed = [], []
    previous = None
    try:
        with hand_graph() as hands, pose_graph() as body:
            pose = ObservePose(body)
            for index in range(last+1):
                ok, frame = cap.read()
                if not ok:
                    raise ValueError('选段未能完整解码。')
                if index < first:
                    continue
                frame = scaled(frame)
                # AVI dimensions should be even for portable MJPG decoding.
                frame = frame[:frame.shape[0]//2*2, :frame.shape[1]//2*2]
                delta = 1/30 if previous is None else times[index]-previous
                hand_result, payload = observe_unified_bgr(frame, hands, pose, delta)
                previous = times[index]
                vector = payload['frame']
                if vector.shape != (178,) or not np.isfinite(vector).all():
                    raise ValueError('特征维度或数值异常。')
                vectors.append(vector)
                overlay = frame.copy()
                for lm in hand_result.multi_hand_landmarks or []:
                    draw_points(overlay, lm, mp.solutions.hands.HAND_CONNECTIONS, (70,230,90))
                if pose.last.pose_landmarks:
                    draw_points(overlay, pose.last.pose_landmarks, ((11,12),(11,13),(13,15),(12,14),(14,16)), (255,180,50), True)
                # Raw landmark export preserves detector coordinates (mirrored).
                def points(lm):
                    return [[float(p.x),float(p.y),float(p.z)] for p in lm.landmark]
                observed.append({'sourceFrame': index, 'sourceSeconds': times[index],
                                 'clipSeconds': times[index]-times[first],
                                 'hands': [points(lm) for lm in hand_result.multi_hand_landmarks or []],
                                 'handedness': [side.classification[0].label for side in hand_result.multi_handedness or []],
                                 'pose': points(pose.last.pose_landmarks) if pose.last.pose_landmarks else None})
                original = frame.copy()
                for image, label in ((original,'ORIGINAL'),(overlay,'MEDIAPIPE')):
                    cv2.rectangle(image,(0,0),(image.shape[1],30),(0,0,0),-1)
                    cv2.putText(image,f'{label} | source {times[index]:.3f}s',(8,21),cv2.FONT_HERSHEY_SIMPLEX,.48,(255,255,255),1,cv2.LINE_AA)
                comparison = np.hstack((original,overlay))
                if not writers:
                    for filename, image in (('original.avi',frame),('skeleton.avi',overlay),('comparison.avi',comparison)):
                        writer = cv2.VideoWriter(str(directory/filename),cv2.VideoWriter_fourcc(*'MJPG'),fps,(image.shape[1],image.shape[0]))
                        writers.append(writer)
                        if not writer.isOpened():
                            raise ValueError('AVI写入失败，请检查目录权限和磁盘空间。')
                for writer, image in zip(writers,(frame,overlay,comparison)):
                    writer.write(image)
                if index in {first,(first+last)//2,last}:
                    name = 'start' if index == first else 'end' if index == last else 'middle'
                    ok, png = cv2.imencode('.png',comparison)
                    if not ok:
                        raise ValueError('对照截图编码失败。')
                    png.tofile(str(directory/f'{name}.png'))
                if len(vectors) == 1 or len(vectors) % 30 == 0 or index == last:
                    print(f'处理 {len(vectors)}/{last-first+1} 帧 | 原片时间 {times[index]:.3f}s',flush=True)
        array = np.asarray(vectors,dtype=np.float32)
        np.save(directory/'features.npy',array,allow_pickle=False)
        write_new(directory/'landmarks.json',{'coordinateSpace':'production mirrored normalized coordinates; display unmirrored back to source','frames':observed})
        result = {'status':'completed','sourceSha256':digest(source),'featureId':FEATURE_ID,
                  'featureShape':list(array.shape),'sourceFps':fps,'timestampFallbackUsed':fallback,
                  'quality':quality(array),'handsDetectedFrames':sum(bool(r['hands']) for r in observed),
                  'sourceTimeRange':[times[first],times[last]],'mediapipe':mp.__version__,
                  'note':'仅骨架与特征提取。无训练、无识别词义、无自动资料登记。AVI为等帧率无声预览，实际时间见landmarks.json。'}
        if result['sourceSha256'] != selection['sourceSha256']:
            raise ValueError('处理期间源视频变化，结果不可使用。')
    finally:
        cap.release()
        for writer in writers:
            writer.release()
    # Completion is published only after every video writer has closed.
    write_new(directory/'summary.json',result)
    print(f'完成：{directory}\n特征形状：{list(array.shape)}；检测到手的帧数：{result["handsDetectedFrames"]}')
    print('骨架质量通过：'+str(result['quality']['passed'])+'（不是动作识别准确率）')


def play(args):
    import cv2
    cap = cv2.VideoCapture(str(Path(args.video).resolve()))
    if not cap.isOpened():
        raise ValueError('视频打不开，请先确认导出成功。')
    name = 'MediaPipe Demo - Compare'
    cv2.namedWindow(name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(name,1200,600)
    fps = cap.get(cv2.CAP_PROP_FPS)
    fps = fps if math.isfinite(fps) and fps > 0 else 30
    paused, image = False, None
    try:
        while True:
            if not paused or image is None:
                ok, next_image = cap.read()
                if not ok:
                    paused = True
                    print('播放结束。R重播，Q退出。')
                else:
                    image = next_image
            if image is None:
                raise ValueError('没有可播放的帧。')
            cv2.imshow(name,image)
            key = cv2.waitKey(35 if paused else max(1,round(1000/fps))) & 255
            if key in (27,ord('q')) or cv2.getWindowProperty(name,cv2.WND_PROP_VISIBLE) < 1:
                return
            if key == ord(' '):
                paused = not paused
            elif key == ord('r'):
                cap.set(cv2.CAP_PROP_POS_FRAMES,0)
                paused = False
    finally:
        cap.release()
        cv2.destroyAllWindows()


def check(_):
    import cv2
    import mediapipe as mp
    import numpy as np
    from sign_worker import hand_graph
    from body_tracking import pose_graph
    from unified_observation import observe_unified_bgr
    with hand_graph() as hands, pose_graph() as pose:
        _, payload = observe_unified_bgr(np.zeros((240,320,3),np.uint8),hands,pose,1/30)
        if payload['frame'].shape != (178,):
            raise ValueError('特征检查失败。')
    print(f'环境检查通过：OpenCV {cv2.__version__} / MediaPipe {mp.__version__} / 178维特征。')
    print('仅用空白画面检查；没有开启摄像头、读取私人视频或训练。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command',required=True)
    commands.add_parser('check',help='检查环境与内置跟踪图').set_defaults(run=check)
    selection = commands.add_parser('select',help='回放原片并用A/B标记起止')
    selection.add_argument('--video',required=True)
    selection.add_argument('--selection',required=True)
    selection.set_defaults(run=select)
    marking = commands.add_parser('mark',help='已知秒数时直接保存范围')
    marking.add_argument('--video',required=True)
    marking.add_argument('--start',type=float,required=True)
    marking.add_argument('--end',type=float,required=True)
    marking.add_argument('--selection',required=True)
    marking.set_defaults(run=lambda a:mark(a.video,a.selection,a.start,a.end))
    extraction = commands.add_parser('extract',help='导出骨架、特征和同步对照视频')
    extraction.add_argument('--selection',required=True)
    extraction.add_argument('--out',required=True)
    extraction.set_defaults(run=extract)
    playback = commands.add_parser('play',help='播放导出视频；空格暂停、R重播、Q退出')
    playback.add_argument('--video',required=True)
    playback.set_defaults(run=play)
    args = parser.parse_args()
    # MediaPipe graph assets in a Chinese Windows workspace require this cwd.
    # Resolve all user paths first, so invocation from any cwd is unambiguous.
    for key in ('video','selection','out'):
        if hasattr(args,key):
            setattr(args,key,str(Path(getattr(args,key)).resolve()))
    os.chdir(ROOT)
    try:
        args.run(args)
    except KeyboardInterrupt:
        print('已停止。若导出中断，使用新的输出目录重试。',file=sys.stderr)
        return 130
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        print(f'操作失败：{error}',file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
