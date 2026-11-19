"""Debug views of a fit: the reprojected skeletons over the stabilised video frame, beside a
top view and a side view of both athletes rebuilt from motion.npz with rig.fk (so the
conversion to the GLB contract is checked too).

python debug_views.py --fit <fit dir> --frames-dir <dir of NNNN.jpg> --stabilize stabilize.json \
    --obs obs.npz --template public/animations/bjj/double_leg.glb --out sheet.jpg --sample 0,10,20
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rig import load_rig, read_glb  # noqa: E402

BONES = [('pelvis', 'spine_02'), ('spine_02', 'neck_01'), ('neck_01', 'Head'), ('spine_03', 'upperarm_l'),
         ('upperarm_l', 'lowerarm_l'), ('lowerarm_l', 'hand_l'), ('spine_03', 'upperarm_r'), ('upperarm_r', 'lowerarm_r'),
         ('lowerarm_r', 'hand_r'), ('pelvis', 'thigh_l'), ('thigh_l', 'calf_l'), ('calf_l', 'foot_l'), ('foot_l', 'ball_l'),
         ('pelvis', 'thigh_r'), ('thigh_r', 'calf_r'), ('calf_r', 'foot_r'), ('foot_r', 'ball_r')]
MK_EDGES = [(3, 5), (5, 7), (4, 6), (6, 8), (3, 4), (3, 9), (4, 10), (9, 10), (9, 11), (11, 13), (10, 12), (12, 14),
            (13, 15), (13, 17), (14, 16), (14, 18), (0, 1), (0, 2)]
COL = [(0, 140, 255), (255, 220, 0)]   # performer orange, receiver cyan (BGR)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fit', required=True)
    ap.add_argument('--frames-dir', required=True)
    ap.add_argument('--stabilize', required=True)
    ap.add_argument('--obs', required=True)
    ap.add_argument('--template', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--sample', default=None, help='comma list of indices into the fitted frames')
    args = ap.parse_args()
    fit = json.load(open(os.path.join(args.fit, 'fit.json')))
    frames = fit['frames']
    uv = np.load(os.path.join(args.fit, 'reprojected_uv.npy'))     # (F,2,19,2) stabilised px
    obs = np.load(args.obs)
    mot = np.load(os.path.join(args.fit, 'motion.npz'))
    g, b = read_glb(args.template)
    world = []
    for role in ('JQ_Attacker', 'JQ_Defender'):
        r = load_rig(g, b, role)
        Gt, _ = r.fk(mot[f'{role}__node_translation'], mot[f'{role}__node_rotation'], mot[f'{role}__joint_rotation'])
        world.append({n: Gt[:, r.index(n)] for n in r.joint_names})
    stab = json.load(open(args.stabilize))['frames']
    idxs = [int(x) for x in args.sample.split(',')] if args.sample else list(range(0, len(frames), max(1, len(frames) // 8)))
    tiles = []
    allpts = np.concatenate([np.stack([w[n] for n in w], 1).reshape(-1, 3) for w in world])
    lo, hi = allpts.min(0) - 0.3, allpts.max(0) + 0.3
    for i in idxs:
        f = frames[i]
        img = cv2.imread(os.path.join(args.frames_dir, f'{f:04d}.jpg'))
        H = np.array(stab[str(f)]['H'])
        T = np.array([[1, 0, 200], [0, 1, 200], [0, 0, 1.0]])
        im = cv2.warpPerspective(img, T @ H, (1080 + 400, 1920 + 400))
        for p in range(2):
            # observations as small crosses, fit as lines
            for j in range(19):
                if np.isfinite(obs['sigma'][i, p, j]):
                    x, y = obs['xy'][i, p, j] + 200
                    cv2.drawMarker(im, (int(x), int(y)), COL[p], cv2.MARKER_TILTED_CROSS, 18, 3)
            q = uv[i, p] + 200
            for a, c in MK_EDGES:
                cv2.line(im, (int(q[a, 0]), int(q[a, 1])), (int(q[c, 0]), int(q[c, 1])), COL[p], 4)
            cv2.circle(im, (int(q[1, 0]), int(q[1, 1])), 7, (0, 0, 255), -1)   # left ear red
        # crop around the athletes
        pts = uv[i].reshape(-1, 2) + 200
        x0, y0 = np.maximum(pts.min(0) - 150, 0).astype(int)
        x1, y1 = (pts.max(0) + 150).astype(int)
        crop = im[y0:y1, x0:x1]
        crop = cv2.resize(crop, (int(600 * crop.shape[1] / max(crop.shape[0], 1)), 600))
        cv2.putText(crop, f'src {f}', (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)

        def panel(ax_u, ax_v, flip_v, label):
            P = np.full((600, 600, 3), 30, np.uint8)
            span = max(hi[ax_u] - lo[ax_u], hi[ax_v] - lo[ax_v])
            def to(px):
                u = (px[ax_u] - lo[ax_u]) / span * 560 + 20
                v = (px[ax_v] - lo[ax_v]) / span * 560 + 20
                return int(u), int(600 - v if flip_v else v)
            if ax_v == 1:
                cv2.line(P, (0, to(np.array([0, 0, 0.0]))[1]), (600, to(np.array([0, 0, 0.0]))[1]), (90, 90, 90), 1)
            for p in range(2):
                for a, c in BONES:
                    cv2.line(P, to(world[p][a][i]), to(world[p][c][i]), COL[p], 3)
                cv2.circle(P, to(world[p]['Head'][i]), 9, COL[p], 2)
                cv2.circle(P, to(world[p]['thigh_l'][i]), 6, (0, 0, 255), -1)
            cv2.putText(P, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (220, 220, 220), 2)
            return P
        top = panel(0, 2, False, 'top (x right, z down)')
        side = panel(2, 1, True, 'side (z right, y up)')
        tiles.append(np.concatenate([crop, top, side], 1))
    wmax = max(t.shape[1] for t in tiles)
    tiles = [np.pad(t, ((0, 0), (0, wmax - t.shape[1]), (0, 0))) for t in tiles]
    cv2.imwrite(args.out, np.concatenate(tiles, 0), [cv2.IMWRITE_JPEG_QUALITY, 85])
    print('wrote', args.out)


if __name__ == '__main__':
    main()
