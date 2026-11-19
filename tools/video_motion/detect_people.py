"""Step 1: pose detections on every frame.

Usage: python detect_people.py <work dir> <first> <last>
<work dir>/mov/frames/NNNN.jpg are the decoded frames (ffmpeg -i clip.MOV -vf fps=30000/1001 frames/%04d.jpg);
<work dir>/models/ holds yolo11x-pose.pt (Ultralytics, AGPL-3.0, used as a local analysis tool) and
pose_landmarker_heavy.task (MediaPipe, Apache-2.0). Writes <work dir>/track/raw_<first>_<last>.json.
"""
import sys, json, time, cv2, numpy as np
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
from ultralytics import YOLO
S = sys.argv[1]; first, last = int(sys.argv[2]), int(sys.argv[3])
yolo = YOLO(f'{S}/models/yolo11x-pose.pt')
opts = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=f'{S}/models/pose_landmarker_heavy.task'),
        running_mode=vision.RunningMode.IMAGE, num_poses=3, min_pose_detection_confidence=0.2,
        min_pose_presence_confidence=0.2, min_tracking_confidence=0.2)
lm = vision.PoseLandmarker.create_from_options(opts)
out = {}
t0 = time.time()
for fi in range(first, last + 1):
    img = cv2.imread(f'{S}/mov/frames/{fi:04d}.jpg'); H, W = img.shape[:2]
    r = yolo(img, verbose=False, imgsz=1280, conf=0.15)[0]
    yk = r.keypoints.data.cpu().numpy().tolist() if r.keypoints is not None else []
    yb = r.boxes.data.cpu().numpy().tolist() if r.boxes is not None else []
    res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))
    mpl = [[[l.x * W, l.y * H, l.z * W, l.visibility, l.presence] for l in p] for p in res.pose_landmarks]
    mpw = [[[l.x, l.y, l.z, l.visibility] for l in p] for p in res.pose_world_landmarks]
    out[fi] = {'yolo_kp': yk, 'yolo_box': yb, 'mp_img': mpl, 'mp_world': mpw}
    if fi % 25 == 0:
        print(fi, len(yk), len(mpl), f'{time.time()-t0:.0f}s', flush=True)
        json.dump(out, open(f'{S}/track/raw_{first}_{last}.json', 'w'))
json.dump(out, open(f'{S}/track/raw_{first}_{last}.json', 'w'))
print('done', time.time() - t0, flush=True)
