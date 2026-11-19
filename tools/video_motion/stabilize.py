"""Step 3: register frames to one reference frame on the static background.
Usage: python stabilize.py <work dir> <first> <last> <reference frame>. Writes <work dir>/track/stabilize.json.
"""
import sys, json, cv2, numpy as np
S = sys.argv[1]; first, last, ref = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
raw = json.load(open(f'{S}/track/raw_0_382.json'))
sift = cv2.SIFT_create(nfeatures=4000)
def mask_for(fi, shape):
    H, W = shape[:2]
    m = np.full((H, W), 255, np.uint8)
    for b in raw[str(fi)]['yolo_box']:
        x0, y0, x1, y1 = b[:4]
        cx, cy, w, h = (x0+x1)/2, (y0+y1)/2, (x1-x0)*1.35, (y1-y0)*1.25
        cv2.rectangle(m, (int(cx-w/2), int(cy-h/2)), (int(cx+w/2), int(cy+h/2)), 0, -1)
    for p in raw[str(fi)]['mp_img']:
        pts = np.array([[q[0], q[1]] for q in p])
        x0, y0 = pts.min(0); x1, y1 = pts.max(0)
        cv2.rectangle(m, (int(x0-120), int(y0-150)), (int(x1+120), int(y1+120)), 0, -1)
    return m
feats = {}
def get(fi):
    if fi not in feats:
        img = cv2.imread(f'{S}/mov/frames/{fi:04d}.jpg', cv2.IMREAD_GRAYSCALE)
        img = cv2.createCLAHE(2.0, (8, 8)).apply(img)
        k, d = sift.detectAndCompute(img, mask_for(fi, img.shape))
        feats[fi] = (k, d)
    return feats[fi]
bf = cv2.BFMatcher(cv2.NORM_L2)
def pair(a, b):
    ka, da = get(a); kb, db = get(b)
    if da is None or db is None or len(ka) < 8 or len(kb) < 8:
        return None, 0
    ms = [m for m, n in bf.knnMatch(da, db, k=2) if m.distance < 0.75 * n.distance]
    if len(ms) < 12:
        return None, len(ms)
    pa = np.float32([ka[m.queryIdx].pt for m in ms]); pb = np.float32([kb[m.trainIdx].pt for m in ms])
    Hm, inl = cv2.findHomography(pa, pb, cv2.USAC_MAGSAC, 3.0, maxIters=5000, confidence=0.999)
    return Hm, int(inl.sum()) if inl is not None else 0
# chain consecutive frames outward from the reference; re-anchor directly to ref every 10 frames when possible
H_to_ref = {ref: np.eye(3)}; info = {ref: {'inliers': -1, 'via': 'ref'}}
for direction in (+1, -1):
    prev = ref
    fi = ref + direction
    while first <= fi <= last:
        Hd, nd = pair(fi, ref) if abs(fi - ref) % 10 == 0 else (None, 0)
        Hc, nc = pair(fi, prev)
        if Hd is not None and nd >= 60:
            H_to_ref[fi] = Hd; info[fi] = {'inliers': nd, 'via': 'direct'}
        elif Hc is not None:
            H_to_ref[fi] = H_to_ref[prev] @ Hc; info[fi] = {'inliers': nc, 'via': 'chain'}
        else:
            H_to_ref[fi] = H_to_ref[prev].copy(); info[fi] = {'inliers': nc, 'via': 'FAILED-copy'}
        prev = fi; fi += direction
out = {str(k): {'H': H_to_ref[k].tolist(), **info[k]} for k in sorted(H_to_ref)}
json.dump({'reference': ref, 'frames': out}, open(f'{S}/track/stabilize.json', 'w'))
weak = [k for k in sorted(info) if info[k]['inliers'] != -1 and info[k]['inliers'] < 40]
print('frames', len(out), 'weak(<40 inliers)', weak[:40], len(weak))
# displacement of the image centre over time, to see the camera motion
c = np.array([540, 960, 1.0])
for k in range(first, last + 1, 20):
    p = H_to_ref[k] @ c; p = p[:2] / p[2]
    print(k, info[k]['via'], info[k]['inliers'], np.round(p - c[:2], 1))
