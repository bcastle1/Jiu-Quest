"""Step 2: tell the two athletes apart by trouser colour (performer = blue, receiver = white in the
reference video). Usage: python identify_people.py <work dir>. Writes <work dir>/track/candidates.json.
"""
import sys, json, cv2, numpy as np
S = sys.argv[1]
raw = json.load(open(f'{S}/track/raw_0_382.json'))
MP2COCO = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]  # MediaPipe -> COCO-17
def pants_score(img_hsv, kp):
    """fraction of trouser samples that are saturated blue, and of those that are white-ish"""
    H, W = img_hsv.shape[:2]
    segs = [(11, 13), (13, 15), (12, 14), (14, 16)]
    samples = []
    for a, b in segs:
        if kp[a][2] < 0.25 or kp[b][2] < 0.25:
            continue
        for t in np.linspace(0.15, 0.85, 9):
            x = kp[a][0] * (1 - t) + kp[b][0] * t; y = kp[a][1] * (1 - t) + kp[b][1] * t
            xi, yi = int(round(x)), int(round(y))
            if 3 <= xi < W - 3 and 3 <= yi < H - 3:
                samples.append(np.median(img_hsv[yi-3:yi+4, xi-3:xi+4].reshape(-1, 3), axis=0))
    if len(samples) < 4:
        return None, None, len(samples)
    s = np.array(samples)
    blue = ((s[:, 0] >= 100) & (s[:, 0] <= 128) & (s[:, 1] >= 110)).mean()
    white = ((s[:, 1] < 85) & (s[:, 2] > 150)).mean()
    return float(blue), float(white), len(samples)
cands = {}
for fi in range(0, 383):
    d = raw[str(fi)]
    img = cv2.imread(f'{S}/mov/frames/{fi:04d}.jpg'); hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    cs = []
    for k in d['yolo_kp']:
        b, w, n = pants_score(hsv, k)
        cs.append({'src': 'yolo', 'kp': k, 'blue': b, 'white': w, 'n': n})
    for p in d['mp_img']:
        k = [[p[i][0], p[i][1], p[i][3]] for i in MP2COCO]
        b, w, n = pants_score(hsv, k)
        cs.append({'src': 'mp', 'kp': k, 'blue': b, 'white': w, 'n': n,
                   'feet': [[p[i][0], p[i][1], p[i][3]] for i in (29, 30, 31, 32)]})  # heels, foot index
    cands[fi] = cs
json.dump(cands, open(f'{S}/track/candidates.json', 'w'))
# summary: per frame, how many candidates look blue / white
rows = []
for fi in range(0, 383, 10):
    s = [(c['src'], None if c['blue'] is None else round(c['blue'], 2), None if c['white'] is None else round(c['white'], 2),
          round(float(np.mean([q[2] for q in c['kp']])), 2)) for c in cands[fi]]
    print(fi, s)
