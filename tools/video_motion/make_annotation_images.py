"""Step 4: gridded crops, detector overlays and context strips for keyframe annotation.
Usage: python make_annotation_images.py <work dir> <comma list of frames>. Writes <work dir>/anno/img/ and anno/meta.json.
"""
import sys, json, cv2, numpy as np
S = sys.argv[1]; frames = [int(x) for x in sys.argv[2].split(',')]
cands = json.load(open(f'{S}/track/candidates.json'))
EDGES = [(5,7),(7,9),(6,8),(8,10),(5,6),(5,11),(6,12),(11,12),(11,13),(13,15),(12,14),(14,16),(0,1),(0,2),(1,3),(2,4)]
def crop_box(f):
    """Tight box around the two athletes: confident keypoints of confident skeletons only
    (the screen also reflects the person holding the phone, which a detector may call a person)."""
    pts = []
    for c in cands[str(f)]:
        k = np.array(c['kp'])
        if k[:, 2].mean() < 0.45: continue
        pts.append(k[k[:, 2] > 0.4, :2])
    if not pts:
        for c in cands[str(f)]:
            k = np.array(c['kp']); pts.append(k[k[:, 2] > 0.2, :2])
    p = np.concatenate(pts)
    x0, y0 = np.percentile(p, 1, axis=0); x1, y1 = np.percentile(p, 99, axis=0)
    pad = 0.18 * max(x1 - x0, y1 - y0) + 90
    x0, y0, x1, y1 = x0 - pad, y0 - pad * 1.3, x1 + pad, y1 + pad
    w, h = max(x1 - x0, 620), max(y1 - y0, 620)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    x0, x1 = cx - w / 2, cx + w / 2
    y0, y1 = cy - h / 2, cy + h / 2
    if x0 < 0: x1 -= x0; x0 = 0
    if x1 > 1080: x0 -= x1 - 1080; x1 = 1080
    if y0 < 0: y1 -= y0; y0 = 0
    if y1 > 1920: y0 -= y1 - 1920; y1 = 1920
    return int(max(0, x0)), int(max(0, y0)), int(min(1080, x1)), int(min(1920, y1))
def grid_img(img, box, draw_auto=None):
    x0, y0, x1, y1 = box
    c = img[y0:y1, x0:x1].copy()
    if draw_auto is not None:
        for kind, k in draw_auto:
            col = {'P': (0, 140, 255), 'R': (255, 255, 0), '?': (180, 180, 180)}[kind]
            k = np.array(k)
            for a, b in EDGES:
                if k[a, 2] > 0.3 and k[b, 2] > 0.3:
                    cv2.line(c, (int(k[a,0]-x0), int(k[a,1]-y0)), (int(k[b,0]-x0), int(k[b,1]-y0)), col, 3)
            for i, (x, y, s) in enumerate(k):
                if s > 0.3:
                    cv2.circle(c, (int(x-x0), int(y-y0)), 6 if i not in (5, 11, 13, 15, 7, 9) else 9, col, -1 if i % 2 == 1 or i == 0 else 2)
    s = 1000.0 / max(c.shape[:2])
    c = cv2.resize(c, (int(c.shape[1] * s), int(c.shape[0] * s)), interpolation=cv2.INTER_CUBIC)
    M = 70
    canvas = np.full((c.shape[0] + 2 * M, c.shape[1] + 2 * M, 3), 255, np.uint8)
    canvas[M:M + c.shape[0], M:M + c.shape[1]] = c
    ov = canvas.copy()
    for gx in range((x0 // 50 + 1) * 50, x1, 50):
        X = int(M + (gx - x0) * s)
        cv2.line(ov, (X, M), (X, M + c.shape[0]), (0, 0, 0) if gx % 100 == 0 else (90, 90, 90), 2 if gx % 100 == 0 else 1)
        if gx % 100 == 0:
            for Y in (M - 25, M + c.shape[0] + 45):
                cv2.putText(canvas, str(gx), (X - 28, Y), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 0, 200), 2)
    for gy in range((y0 // 50 + 1) * 50, y1, 50):
        Y = int(M + (gy - y0) * s)
        cv2.line(ov, (M, Y), (M + c.shape[1], Y), (0, 0, 0) if gy % 100 == 0 else (90, 90, 90), 2 if gy % 100 == 0 else 1)
        if gy % 100 == 0:
            cv2.putText(canvas, str(gy), (2, Y + 8), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (0, 0, 200), 2)
            cv2.putText(canvas, str(gy), (M + c.shape[1] + 4, Y + 8), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (0, 0, 200), 2)
    canvas = cv2.addWeighted(ov, 0.35, canvas, 0.65, 0)
    # re-draw labels crisp
    for gx in range((x0 // 100 + 1) * 100, x1, 100):
        X = int(M + (gx - x0) * s)
        for Y in (M - 25, M + c.shape[0] + 45):
            cv2.putText(canvas, str(gx), (X - 28, Y), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 0, 200), 2)
    for gy in range((y0 // 100 + 1) * 100, y1, 100):
        Y = int(M + (gy - y0) * s)
        cv2.putText(canvas, str(gy), (2, Y + 8), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (0, 0, 200), 2)
        cv2.putText(canvas, str(gy), (M + c.shape[1] + 4, Y + 8), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (0, 0, 200), 2)
    return canvas
meta = {}
for f in frames:
    img = cv2.imread(f'{S}/mov/frames/{f:04d}.jpg')
    box = crop_box(f)
    cv2.imwrite(f'{S}/anno/img/{f:04d}_grid.jpg', grid_img(img, box), [cv2.IMWRITE_JPEG_QUALITY, 92])
    auto = []
    for c in cands[str(f)]:
        k = np.array(c['kp'])
        if k[:, 2].mean() < 0.25: continue
        kind = 'P' if (c['blue'] or 0) > 0.3 and (c['blue'] or 0) > (c['white'] or 0) else ('R' if (c['white'] or 0) > 0.5 else '?')
        auto.append((kind, c['kp']))
    cv2.imwrite(f'{S}/anno/img/{f:04d}_auto.jpg', grid_img(img, box, auto), [cv2.IMWRITE_JPEG_QUALITY, 88])
    strip = []
    for g in (f - 6, f - 3, f, f + 3, f + 6):
        g = min(max(g, 0), 382)
        im = cv2.imread(f'{S}/mov/frames/{g:04d}.jpg')[box[1]:box[3], box[0]:box[2]]
        im = cv2.resize(im, (300, int(300 * im.shape[0] / im.shape[1])))
        cv2.putText(im, f'{g}' + (' (this)' if g == f else ''), (8, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
        strip.append(im)
    cv2.imwrite(f'{S}/anno/img/{f:04d}_ctx.jpg', np.concatenate(strip, 1), [cv2.IMWRITE_JPEG_QUALITY, 85])
    meta[f] = {'box': box, 'auto': [{'role_guess': k, 'coco17': [[round(x, 1), round(y, 1), round(s, 2)] for x, y, s in kp]} for k, kp in auto]}
json.dump(meta, open(f'{S}/anno/meta.json', 'w'))
print('made', len(frames))
